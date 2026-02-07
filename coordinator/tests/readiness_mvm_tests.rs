//! MVM-specific readiness tracking tests
//!
//! These tests verify that the coordinator correctly monitors IntentRequirementsReceived
//! events from MVM connected chains and marks intents as ready.

use coordinator::monitor::{EventMonitor, poll_mvm_requirements_received};
use serde_json::json;
use wiremock::matchers::{method, path_regex};
use wiremock::{Mock, MockServer, ResponseTemplate};

#[path = "mod.rs"]
mod test_helpers;
use test_helpers::{build_test_config_with_mvm, create_default_intent_mvm, DUMMY_INTENT_ID};

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/// Create a mock transaction response with IntentRequirementsReceived event
fn create_transaction_with_requirements_received(intent_id: &str) -> serde_json::Value {
    json!([{
        "version": "100",
        "hash": "0xabc123",
        "events": [{
            "version": "100",
            "guid": {
                "creation_number": "0",
                "account_address": "0x3"
            },
            "sequence_number": "0",
            "type": "0x3::intent_outflow_validator::IntentRequirementsReceived",
            "data": {
                "intent_id": intent_id,
                "src_chain_id": "1",
                "requester_addr": "0xabc",
                "amount_required": "1000",
                "token_addr": "0xtoken",
                "solver_addr": "0xsolver",
                "expiry": "9999999999"
            }
        }]
    }])
}

// ============================================================================
// TESTS
// ============================================================================

// 1. Test: poll_mvm_requirements_received parses IntentRequirementsReceived events
/// Test that poll_mvm_requirements_received parses IntentRequirementsReceived events
/// What is tested: Event parsing and intent_id extraction from MVM events
/// Why: Coordinator must correctly parse MVM event format to mark intents as ready
#[tokio::test]
async fn test_poll_mvm_requirements_received_parses_event() {
    let mock_server = MockServer::start().await;

    // Mock the get_account_events endpoint
    Mock::given(method("GET"))
        .and(path_regex(r"/v1/accounts/.*/transactions"))
        .respond_with(ResponseTemplate::new(200).set_body_json(
            create_transaction_with_requirements_received(DUMMY_INTENT_ID),
        ))
        .mount(&mock_server)
        .await;

    // Create config with mock server URL
    let mut config = build_test_config_with_mvm();
    config.connected_chain_mvm.as_mut().unwrap().rpc_url = mock_server.uri();

    let monitor = EventMonitor::new(&config).await.unwrap();

    // Add a test intent to the cache
    let intent = create_default_intent_mvm();
    {
        let mut cache = monitor.event_cache.write().await;
        cache.push(intent);
    }

    // Poll for requirements received events
    let result = poll_mvm_requirements_received(&monitor).await;
    assert!(result.is_ok(), "Polling should succeed");

    let count = result.unwrap();
    assert_eq!(count, 1, "Should process one event");

    // Verify intent is marked as ready
    let cached = monitor.get_cached_events().await;
    assert_eq!(cached.len(), 1);
    assert_eq!(cached[0].ready_on_connected_chain, true);
}

// 2. Test: poll_mvm_requirements_received handles empty event list
/// Test that poll_mvm_requirements_received handles empty event list
/// What is tested: Handling of no new events
/// Why: Polling should succeed even when no events are found
#[tokio::test]
async fn test_poll_mvm_requirements_received_handles_empty_events() {
    let mock_server = MockServer::start().await;

    // Mock empty event response
    Mock::given(method("GET"))
        .and(path_regex(r"/v1/accounts/.*/transactions"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!([])))
        .mount(&mock_server)
        .await;

    let mut config = build_test_config_with_mvm();
    config.connected_chain_mvm.as_mut().unwrap().rpc_url = mock_server.uri();

    let monitor = EventMonitor::new(&config).await.unwrap();

    let result = poll_mvm_requirements_received(&monitor).await;
    assert!(result.is_ok());
    assert_eq!(result.unwrap(), 0, "Should process zero events");
}

// 3. Test: poll_mvm_requirements_received handles multiple events
/// Test that poll_mvm_requirements_received handles multiple events
/// What is tested: Processing multiple IntentRequirementsReceived events in one poll
/// Why: Coordinator should handle batch event processing
#[tokio::test]
async fn test_poll_mvm_requirements_received_handles_multiple_events() {
    let mock_server = MockServer::start().await;

    let intent_id_1 = "0x0000000000000000000000000000000000000000000000000000000000000001";
    let intent_id_2 = "0x0000000000000000000000000000000000000000000000000000000000000002";

    // Mock multiple transactions with events
    Mock::given(method("GET"))
        .and(path_regex(r"/v1/accounts/.*/transactions"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!([
            {
                "version": "100",
                "hash": "0xabc123",
                "events": [{
                    "version": "100",
                    "type": "0x3::intent_outflow_validator::IntentRequirementsReceived",
                    "data": {
                        "intent_id": intent_id_1,
                        "src_chain_id": "1",
                        "requester_addr": "0xabc",
                        "amount_required": "1000",
                        "token_addr": "0xtoken",
                        "solver_addr": "0xsolver",
                        "expiry": "9999999999"
                    }
                }]
            },
            {
                "version": "101",
                "hash": "0xdef456",
                "events": [{
                    "version": "101",
                    "type": "0x3::intent_outflow_validator::IntentRequirementsReceived",
                    "data": {
                        "intent_id": intent_id_2,
                        "src_chain_id": "1",
                        "requester_addr": "0xabc",
                        "amount_required": "2000",
                        "token_addr": "0xtoken",
                        "solver_addr": "0xsolver",
                        "expiry": "9999999999"
                    }
                }]
            }
        ])))
        .mount(&mock_server)
        .await;

    let mut config = build_test_config_with_mvm();
    config.connected_chain_mvm.as_mut().unwrap().rpc_url = mock_server.uri();

    let monitor = EventMonitor::new(&config).await.unwrap();

    // Add two test intents to cache
    {
        let mut cache = monitor.event_cache.write().await;
        let mut intent1 = create_default_intent_mvm();
        intent1.intent_id = intent_id_1.to_string();
        cache.push(intent1);

        let mut intent2 = create_default_intent_mvm();
        intent2.intent_id = intent_id_2.to_string();
        cache.push(intent2);
    }

    let result = poll_mvm_requirements_received(&monitor).await;
    assert!(result.is_ok());
    assert_eq!(result.unwrap(), 2, "Should process two events");

    // Verify both intents are marked as ready
    let cached = monitor.get_cached_events().await;
    assert_eq!(cached.len(), 2);
    assert!(cached.iter().all(|i| i.ready_on_connected_chain));
}

// 4. Test: poll_mvm_requirements_received handles intent ID normalization
/// Test that poll_mvm_requirements_received handles intent ID normalization
/// What is tested: Intent ID normalization (leading zeros)
/// Why: Intent IDs from events may have different leading zero formats
#[tokio::test]
async fn test_poll_mvm_requirements_received_normalizes_intent_id() {
    let mock_server = MockServer::start().await;

    // Event has intent ID with leading zeros
    let event_intent_id = "0x00000001";
    // Cached intent has normalized ID (no leading zeros)
    let cache_intent_id = "0x1";

    Mock::given(method("GET"))
        .and(path_regex(r"/v1/accounts/.*/transactions"))
        .respond_with(ResponseTemplate::new(200).set_body_json(
            create_transaction_with_requirements_received(event_intent_id),
        ))
        .mount(&mock_server)
        .await;

    let mut config = build_test_config_with_mvm();
    config.connected_chain_mvm.as_mut().unwrap().rpc_url = mock_server.uri();

    let monitor = EventMonitor::new(&config).await.unwrap();

    // Add intent with normalized ID
    {
        let mut cache = monitor.event_cache.write().await;
        let mut intent = create_default_intent_mvm();
        intent.intent_id = cache_intent_id.to_string();
        cache.push(intent);
    }

    let result = poll_mvm_requirements_received(&monitor).await;
    assert!(result.is_ok());
    assert_eq!(result.unwrap(), 1);

    // Verify intent is marked as ready despite different ID format
    let cached = monitor.get_cached_events().await;
    assert_eq!(cached.len(), 1);
    assert_eq!(cached[0].ready_on_connected_chain, true);
}
