//! Unit tests for EVM client functions
//!
//! These tests verify that EVM client functions work correctly,
//! including transaction queries and receipt status checks.

use serde_json::json;
use integrated_gmp::evm_client::EvmClient;
use wiremock::matchers::{body_json, method};
use wiremock::{Mock, MockServer, ResponseTemplate};

#[path = "mod.rs"]
mod test_helpers;
use test_helpers::{
    DUMMY_ESCROW_CONTRACT_ADDR_EVM, DUMMY_SOLVER_ADDR_EVM, DUMMY_TOKEN_ADDR_EVM, DUMMY_TX_HASH,
};

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/// Setup a mock server that responds to eth_getTransactionByHash
#[allow(dead_code)]
async fn setup_mock_transaction(
    transaction_hash: &str,
    calldata: &str,
) -> (MockServer, EvmClient) {
    let mock_server = MockServer::start().await;

    let tx_response = json!({
        "jsonrpc": "2.0",
        "result": {
            "hash": transaction_hash,
            "blockNumber": "0x1",
            "transactionIndex": "0x0",
            "from": DUMMY_SOLVER_ADDR_EVM,
            "to": DUMMY_TOKEN_ADDR_EVM, // Token contract address: solver calls ERC20 transfer() to fulfill intent
            "input": calldata,
            "value": "0x0",
            "gas": "0x5208",
            "gasPrice": "0x3b9aca00"
        },
        "id": 1
    });

    Mock::given(method("POST"))
        .and(body_json(json!({
            "jsonrpc": "2.0",
            "method": "eth_getTransactionByHash",
            "params": [transaction_hash],
            "id": 1
        })))
        .respond_with(ResponseTemplate::new(200).set_body_json(tx_response))
        .mount(&mock_server)
        .await;

    let client = EvmClient::new(&mock_server.uri(), DUMMY_ESCROW_CONTRACT_ADDR_EVM)
        .expect("Failed to create EvmClient");

    (mock_server, client)
}

/// Setup a mock server that responds to eth_getTransactionReceipt with status
async fn setup_mock_receipt(
    transaction_hash: &str,
    status: &str,
) -> (MockServer, EvmClient) {
    let mock_server = MockServer::start().await;

    let receipt_response = json!({
        "jsonrpc": "2.0",
        "result": {
            "status": status,
            "transactionHash": transaction_hash,
            "blockNumber": "0x1",
            "transactionIndex": "0x0"
        },
        "id": 1
    });

    Mock::given(method("POST"))
        .and(body_json(json!({
            "jsonrpc": "2.0",
            "method": "eth_getTransactionReceipt",
            "params": [transaction_hash],
            "id": 1
        })))
        .respond_with(ResponseTemplate::new(200).set_body_json(receipt_response))
        .mount(&mock_server)
        .await;

    let client = EvmClient::new(&mock_server.uri(), DUMMY_ESCROW_CONTRACT_ADDR_EVM)
        .expect("Failed to create EvmClient");

    (mock_server, client)
}

// ============================================================================
// TESTS
// ============================================================================

/// 20. Test: Transaction Receipt Status Success
/// Verifies that get_transaction_receipt_status returns "0x1" for successful transactions.
/// Why: Correct receipt status parsing is required to validate outflow fulfillment transactions.
#[tokio::test]
async fn test_get_transaction_receipt_status_success() {
    let tx_hash = DUMMY_TX_HASH;
    let (_mock_server, client) = setup_mock_receipt(tx_hash, "0x1").await;

    let status = client
        .get_transaction_receipt_status(tx_hash)
        .await
        .expect("Should successfully get receipt status");

    assert_eq!(status, Some("0x1".to_string()), "Status should be 0x1 for success");
}

/// 21. Test: Transaction Receipt Status Failure
/// Verifies that get_transaction_receipt_status returns "0x0" for failed transactions.
/// Why: Failed transactions must be correctly identified to reject invalid fulfillments.
#[tokio::test]
async fn test_get_transaction_receipt_status_failure() {
    let tx_hash = DUMMY_TX_HASH;
    let (_mock_server, client) = setup_mock_receipt(tx_hash, "0x0").await;

    let status = client
        .get_transaction_receipt_status(tx_hash)
        .await
        .expect("Should successfully get receipt status");

    assert_eq!(status, Some("0x0".to_string()), "Status should be 0x0 for failure");
}

/// 22. Test: Transaction Receipt Status Not Found
/// Verifies that get_transaction_receipt_status returns None when receipt is not found.
/// Why: Missing receipts must return None rather than an error to distinguish from failures.
#[tokio::test]
async fn test_get_transaction_receipt_status_not_found() {
    let mock_server = MockServer::start().await;
    let tx_hash = DUMMY_TX_HASH;

    let receipt_response = json!({
        "jsonrpc": "2.0",
        "result": null,
        "id": 1
    });

    Mock::given(method("POST"))
        .and(body_json(json!({
            "jsonrpc": "2.0",
            "method": "eth_getTransactionReceipt",
            "params": [tx_hash],
            "id": 1
        })))
        .respond_with(ResponseTemplate::new(200).set_body_json(receipt_response))
        .mount(&mock_server)
        .await;

    let client = EvmClient::new(&mock_server.uri(), DUMMY_ESCROW_CONTRACT_ADDR_EVM)
        .expect("Failed to create EvmClient");

    let status = client
        .get_transaction_receipt_status(tx_hash)
        .await
        .expect("Should successfully get receipt status (even if null)");

    assert_eq!(status, None, "Status should be None when receipt not found");
}


