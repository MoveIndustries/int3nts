//! SVM-specific readiness tracking tests
//!
//! These tests verify that the coordinator correctly monitors IntentRequirementsReceived
//! logs from SVM connected chains and marks intents as ready.

use coordinator::monitor::{EventMonitor, poll_svm_requirements_received};
use serde_json::json;
use wiremock::matchers::{body_json_string, method};
use wiremock::{Mock, MockServer, ResponseTemplate};

#[path = "mod.rs"]
mod test_helpers;
use test_helpers::{build_test_config_with_svm, create_default_intent_svm, DUMMY_INTENT_ID};

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/// Create a mock getSignaturesForAddress response
fn create_get_signatures_response() -> serde_json::Value {
    json!({
        "jsonrpc": "2.0",
        "id": 1,
        "result": [{
            "signature": "5VxZjZQKbEyqVvBN8r8V8r8V8r8V8r8V8r8V8r8V8r8V8r8V8r8V8r8V8r8V8r8V8r8V",
            "slot": 100,
            "err": null,
            "blockTime": 1234567890
        }]
    })
}

/// Create a mock getTransaction response with IntentRequirementsReceived log
fn create_transaction_with_requirements_log(intent_id: &str) -> serde_json::Value {
    // Strip 0x prefix if present
    let intent_id_hex = intent_id.strip_prefix("0x").unwrap_or(intent_id);

    json!({
        "jsonrpc": "2.0",
        "id": 1,
        "result": {
            "slot": 100,
            "transaction": {
                "message": {
                    "accountKeys": ["11111111111111111111111111111111"],
                    "instructions": []
                },
                "signatures": ["5VxZjZQKbEyqVvBN8r8V8r8V8r8V8r8V8r8V8r8V8r8V8r8V8r8V8r8V8r8V8r8V8r8V"]
            },
            "meta": {
                "err": null,
                "logMessages": [
                    "Program 11111111111111111111111111111111 invoke [1]",
                    format!("IntentRequirementsReceived: intent_id={}, src_chain_id=1", intent_id_hex),
                    "Program 11111111111111111111111111111111 success"
                ]
            }
        }
    })
}

// ============================================================================
// TESTS
// ============================================================================

// 1. Test: poll_svm_requirements_received parses IntentRequirementsReceived logs
/// Test that poll_svm_requirements_received parses IntentRequirementsReceived logs
/// What is tested: Log parsing and intent_id extraction from SVM logs
/// Why: Coordinator must correctly parse SVM log format to mark intents as ready
#[tokio::test]
async fn test_poll_svm_requirements_received_parses_log() {
    let mock_server = MockServer::start().await;

    // Mock getSignaturesForAddress
    let get_signatures_body = json!({
        "jsonrpc": "2.0",
        "method": "getSignaturesForAddress",
        "params": ["11111111111111111111111111111111", {"limit": 100}],
        "id": 1
    });

    Mock::given(method("POST"))
        .and(body_json_string(get_signatures_body.to_string()))
        .respond_with(ResponseTemplate::new(200).set_body_json(
            create_get_signatures_response(),
        ))
        .mount(&mock_server)
        .await;

    // Mock getTransaction
    let get_transaction_body = json!({
        "jsonrpc": "2.0",
        "method": "getTransaction",
        "params": ["5VxZjZQKbEyqVvBN8r8V8r8V8r8V8r8V8r8V8r8V8r8V8r8V8r8V8r8V8r8V8r8V8r8V", {"encoding": "json"}],
        "id": 1
    });

    Mock::given(method("POST"))
        .and(body_json_string(get_transaction_body.to_string()))
        .respond_with(ResponseTemplate::new(200).set_body_json(
            create_transaction_with_requirements_log(DUMMY_INTENT_ID),
        ))
        .mount(&mock_server)
        .await;

    // Create config with mock server URL
    let mut config = build_test_config_with_svm();
    config.connected_chain_svm.as_mut().unwrap().rpc_url = mock_server.uri();

    let monitor = EventMonitor::new(&config).await.unwrap();

    // Add a test intent to the cache
    let intent = create_default_intent_svm();
    {
        let mut cache = monitor.event_cache.write().await;
        cache.push(intent);
    }

    // Poll for requirements received logs
    let result = poll_svm_requirements_received(&monitor).await;
    assert!(result.is_ok(), "Polling should succeed");

    let count = result.unwrap();
    assert_eq!(count, 1, "Should process one log");

    // Verify intent is marked as ready
    let cached = monitor.get_cached_events().await;
    assert_eq!(cached.len(), 1);
    assert_eq!(cached[0].ready_on_connected_chain, true);
}

// 2. Test: poll_svm_requirements_received handles empty log list
/// Test that poll_svm_requirements_received handles empty log list
/// What is tested: Handling of no new logs
/// Why: Polling should succeed even when no logs are found
#[tokio::test]
async fn test_poll_svm_requirements_received_handles_empty_logs() {
    let mock_server = MockServer::start().await;

    // Mock empty signatures response
    Mock::given(method("POST"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "jsonrpc": "2.0",
            "id": 1,
            "result": []
        })))
        .mount(&mock_server)
        .await;

    let mut config = build_test_config_with_svm();
    config.connected_chain_svm.as_mut().unwrap().rpc_url = mock_server.uri();

    let monitor = EventMonitor::new(&config).await.unwrap();

    let result = poll_svm_requirements_received(&monitor).await;
    assert!(result.is_ok());
    assert_eq!(result.unwrap(), 0, "Should process zero logs");
}

// 3. Test: poll_svm_requirements_received handles multiple logs
/// Test that poll_svm_requirements_received handles multiple logs
/// What is tested: Processing multiple IntentRequirementsReceived logs in one poll
/// Why: Coordinator should handle batch log processing
#[tokio::test]
async fn test_poll_svm_requirements_received_handles_multiple_logs() {
    let mock_server = MockServer::start().await;

    let intent_id_1 = "0x0000000000000000000000000000000000000000000000000000000000000001";
    let intent_id_2 = "0x0000000000000000000000000000000000000000000000000000000000000002";

    // Mock getSignaturesForAddress with multiple signatures
    Mock::given(method("POST"))
        .and(body_json_string(json!({
            "jsonrpc": "2.0",
            "method": "getSignaturesForAddress",
            "params": ["11111111111111111111111111111111", {"limit": 100}],
            "id": 1
        }).to_string()))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "jsonrpc": "2.0",
            "id": 1,
            "result": [
                {
                    "signature": "5VxZjZQKbEyqVvBN8r8V8r8V8r8V8r8V8r8V8r8V8r8V8r8V8r8V8r8V8r8V8r8V8r8V",
                    "slot": 100,
                    "err": null,
                    "blockTime": 1234567890
                },
                {
                    "signature": "6WyAkAZRbFcY9w9Y9w9Y9w9Y9w9Y9w9Y9w9Y9w9Y9w9Y9w9Y9w9Y9w9Y9w9Y9w9Y",
                    "slot": 101,
                    "err": null,
                    "blockTime": 1234567891
                }
            ]
        })))
        .mount(&mock_server)
        .await;

    // Mock first transaction
    Mock::given(method("POST"))
        .and(body_json_string(json!({
            "jsonrpc": "2.0",
            "method": "getTransaction",
            "params": ["5VxZjZQKbEyqVvBN8r8V8r8V8r8V8r8V8r8V8r8V8r8V8r8V8r8V8r8V8r8V8r8V8r8V", {"encoding": "json"}],
            "id": 1
        }).to_string()))
        .respond_with(ResponseTemplate::new(200).set_body_json(
            create_transaction_with_requirements_log(intent_id_1),
        ))
        .mount(&mock_server)
        .await;

    // Mock second transaction
    Mock::given(method("POST"))
        .and(body_json_string(json!({
            "jsonrpc": "2.0",
            "method": "getTransaction",
            "params": ["6WyAkAZRbFcY9w9Y9w9Y9w9Y9w9Y9w9Y9w9Y9w9Y9w9Y9w9Y9w9Y9w9Y9w9Y9w9Y", {"encoding": "json"}],
            "id": 1
        }).to_string()))
        .respond_with(ResponseTemplate::new(200).set_body_json(
            create_transaction_with_requirements_log(intent_id_2),
        ))
        .mount(&mock_server)
        .await;

    let mut config = build_test_config_with_svm();
    config.connected_chain_svm.as_mut().unwrap().rpc_url = mock_server.uri();

    let monitor = EventMonitor::new(&config).await.unwrap();

    // Add two test intents to cache
    {
        let mut cache = monitor.event_cache.write().await;
        let mut intent1 = create_default_intent_svm();
        intent1.intent_id = intent_id_1.to_string();
        cache.push(intent1);

        let mut intent2 = create_default_intent_svm();
        intent2.intent_id = intent_id_2.to_string();
        cache.push(intent2);
    }

    let result = poll_svm_requirements_received(&monitor).await;
    assert!(result.is_ok());
    assert_eq!(result.unwrap(), 2, "Should process two logs");

    // Verify both intents are marked as ready
    let cached = monitor.get_cached_events().await;
    assert_eq!(cached.len(), 2);
    assert!(cached.iter().all(|i| i.ready_on_connected_chain));
}

// 4. Test: poll_svm_requirements_received handles intent ID normalization
/// Test that poll_svm_requirements_received handles intent ID normalization
/// What is tested: Intent ID normalization (leading zeros)
/// Why: Intent IDs from logs may have different leading zero formats
#[tokio::test]
async fn test_poll_svm_requirements_received_normalizes_intent_id() {
    let mock_server = MockServer::start().await;

    // Log has intent ID with leading zeros
    let log_intent_id = "0x00000001";
    // Cached intent has normalized ID (no leading zeros)
    let cache_intent_id = "0x1";

    // Mock getSignaturesForAddress
    Mock::given(method("POST"))
        .and(body_json_string(json!({
            "jsonrpc": "2.0",
            "method": "getSignaturesForAddress",
            "params": ["11111111111111111111111111111111", {"limit": 100}],
            "id": 1
        }).to_string()))
        .respond_with(ResponseTemplate::new(200).set_body_json(
            create_get_signatures_response(),
        ))
        .mount(&mock_server)
        .await;

    // Mock getTransaction
    Mock::given(method("POST"))
        .and(body_json_string(json!({
            "jsonrpc": "2.0",
            "method": "getTransaction",
            "params": ["5VxZjZQKbEyqVvBN8r8V8r8V8r8V8r8V8r8V8r8V8r8V8r8V8r8V8r8V8r8V8r8V8r8V", {"encoding": "json"}],
            "id": 1
        }).to_string()))
        .respond_with(ResponseTemplate::new(200).set_body_json(
            create_transaction_with_requirements_log(log_intent_id),
        ))
        .mount(&mock_server)
        .await;

    let mut config = build_test_config_with_svm();
    config.connected_chain_svm.as_mut().unwrap().rpc_url = mock_server.uri();

    let monitor = EventMonitor::new(&config).await.unwrap();

    // Add intent with normalized ID
    {
        let mut cache = monitor.event_cache.write().await;
        let mut intent = create_default_intent_svm();
        intent.intent_id = cache_intent_id.to_string();
        cache.push(intent);
    }

    let result = poll_svm_requirements_received(&monitor).await;
    assert!(result.is_ok());
    assert_eq!(result.unwrap(), 1, "Should process one log");

    // Verify intent is marked as ready despite different ID format
    let cached = monitor.get_cached_events().await;
    assert_eq!(cached.len(), 1);
    assert_eq!(cached[0].ready_on_connected_chain, true);
}
