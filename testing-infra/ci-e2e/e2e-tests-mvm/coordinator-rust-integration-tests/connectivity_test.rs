//! Tests for Aptos REST Client Connectivity
//!
//! These tests verify basic connectivity to Aptos chains.
//! They require the Aptos chains to be running.

use chain_clients_mvm::MvmClient;

// 1. Test: client can connect to hub chain
// Verifies that MvmClient::health_check succeeds against the hub chain endpoint.
// Why: Confirms baseline connectivity to the hub node before any higher-level operations are tested.
#[tokio::test]
async fn test_client_can_connect_to_chain1() {
    let client = MvmClient::new("http://127.0.0.1:1000").unwrap();
    
    // Test health check
    let result = client.health_check().await;
    assert!(result.is_ok(), "Should be able to connect to Hub");
}

// 2. Test: client can connect to connected chain
// Verifies that MvmClient::health_check succeeds against the connected chain endpoint.
// Why: Confirms the same client works across multiple chain endpoints, not just the hub.
#[tokio::test]
async fn test_client_can_connect_to_chain2() {
    let client = MvmClient::new("http://127.0.0.1:2000").unwrap();
    
    // Test health check
    let result = client.health_check().await;
    assert!(result.is_ok(), "Should be able to connect to Chain 2");
}

