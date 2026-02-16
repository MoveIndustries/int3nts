//! Generic readiness tracking tests
//!
//! These tests verify that the coordinator's core readiness tracking logic works correctly.
//! For VM-specific event monitoring tests, see readiness_*vm_tests.rs files.

use coordinator::monitor::{EventMonitor, IntentEvent};

#[path = "mod.rs"]
mod test_helpers;
use test_helpers::build_test_config_with_mvm;

/// Test that new intents are created with ready_on_connected_chain = false
/// What is tested: Default readiness state for new intents
/// Why: Intents should not be marked as ready until requirements are delivered
#[tokio::test]
async fn test_new_intent_not_ready() {
    let config = build_test_config_with_mvm();
    let monitor = EventMonitor::new(&config).await.unwrap();

    // Create a test intent
    let intent = IntentEvent {
        intent_id: "0x123".to_string(),
        offered_metadata: "{}".to_string(),
        offered_amount: 100,
        desired_metadata: "{}".to_string(),
        desired_amount: 200,
        revocable: false,
        requester_addr: "0xabc".to_string(),
        requester_addr_connected_chain: None,
        reserved_solver_addr: None,
        connected_chain_id: Some(2),
        expiry_time: 9999999999,
        timestamp: 1234567890,
        ready_on_connected_chain: false,
    };

    // Add intent to cache
    {
        let mut cache = monitor.event_cache.write().await;
        cache.push(intent.clone());
    }

    // Verify it's not ready
    let cached = monitor.get_cached_events().await;
    assert_eq!(cached.len(), 1);
    assert_eq!(cached[0].ready_on_connected_chain, false);
}

/// Test that mark_intent_ready sets ready_on_connected_chain to true
/// What is tested: mark_intent_ready() updates intent readiness state
/// Why: Coordinator must mark intents as ready when requirements are received
#[tokio::test]
async fn test_mark_intent_ready() {
    let config = build_test_config_with_mvm();
    let monitor = EventMonitor::new(&config).await.unwrap();

    // Create a test intent
    let intent = IntentEvent {
        intent_id: "0x123".to_string(),
        offered_metadata: "{}".to_string(),
        offered_amount: 100,
        desired_metadata: "{}".to_string(),
        desired_amount: 200,
        revocable: false,
        requester_addr: "0xabc".to_string(),
        requester_addr_connected_chain: None,
        reserved_solver_addr: None,
        connected_chain_id: Some(2),
        expiry_time: 9999999999,
        timestamp: 1234567890,
        ready_on_connected_chain: false,
    };

    // Add intent to cache
    {
        let mut cache = monitor.event_cache.write().await;
        cache.push(intent.clone());
    }

    // Mark as ready
    monitor.mark_intent_ready("0x123").await;

    // Verify it's now ready
    let cached = monitor.get_cached_events().await;
    assert_eq!(cached.len(), 1);
    assert_eq!(cached[0].ready_on_connected_chain, true);
}

/// Test that mark_intent_ready handles normalized intent IDs correctly
/// What is tested: Intent ID normalization (leading zeros handling)
/// Why: Event intent IDs may have different leading zero formats than cached intents
#[tokio::test]
async fn test_mark_intent_ready_normalized() {
    let config = build_test_config_with_mvm();
    let monitor = EventMonitor::new(&config).await.unwrap();

    // Create a test intent with leading zeros in ID
    let intent = IntentEvent {
        intent_id: "0x00123".to_string(),
        offered_metadata: "{}".to_string(),
        offered_amount: 100,
        desired_metadata: "{}".to_string(),
        desired_amount: 200,
        revocable: false,
        requester_addr: "0xabc".to_string(),
        requester_addr_connected_chain: None,
        reserved_solver_addr: None,
        connected_chain_id: Some(2),
        expiry_time: 9999999999,
        timestamp: 1234567890,
        ready_on_connected_chain: false,
    };

    // Add intent to cache
    {
        let mut cache = monitor.event_cache.write().await;
        cache.push(intent.clone());
    }

    // Mark as ready using ID without leading zeros
    monitor.mark_intent_ready("0x123").await;

    // Verify it's now ready (intent ID normalization should match)
    let cached = monitor.get_cached_events().await;
    assert_eq!(cached.len(), 1);
    assert_eq!(cached[0].ready_on_connected_chain, true);
}

/// Test that mark_intent_ready is idempotent
/// What is tested: Repeated calls to mark_intent_ready don't cause errors
/// Why: GMP events may be observed multiple times during polling
#[tokio::test]
async fn test_mark_intent_ready_idempotent() {
    let config = build_test_config_with_mvm();
    let monitor = EventMonitor::new(&config).await.unwrap();

    // Create a test intent
    let intent = IntentEvent {
        intent_id: "0x123".to_string(),
        offered_metadata: "{}".to_string(),
        offered_amount: 100,
        desired_metadata: "{}".to_string(),
        desired_amount: 200,
        revocable: false,
        requester_addr: "0xabc".to_string(),
        requester_addr_connected_chain: None,
        reserved_solver_addr: None,
        connected_chain_id: Some(2),
        expiry_time: 9999999999,
        timestamp: 1234567890,
        ready_on_connected_chain: false,
    };

    // Add intent to cache
    {
        let mut cache = monitor.event_cache.write().await;
        cache.push(intent.clone());
    }

    // Mark as ready multiple times
    monitor.mark_intent_ready("0x123").await;
    monitor.mark_intent_ready("0x123").await;
    monitor.mark_intent_ready("0x123").await;

    // Verify it's still ready (no errors)
    let cached = monitor.get_cached_events().await;
    assert_eq!(cached.len(), 1);
    assert_eq!(cached[0].ready_on_connected_chain, true);
}

/// Test that mark_intent_ready handles non-existent intent gracefully
/// What is tested: mark_intent_ready() doesn't panic on missing intent
/// Why: Events may arrive for intents that expired or were never cached
#[tokio::test]
async fn test_mark_intent_ready_not_found() {
    let config = build_test_config_with_mvm();
    let monitor = EventMonitor::new(&config).await.unwrap();

    // Try to mark a non-existent intent as ready (should not panic)
    monitor.mark_intent_ready("0x999").await;

    // Verify cache is empty
    let cached = monitor.get_cached_events().await;
    assert_eq!(cached.len(), 0);
}
