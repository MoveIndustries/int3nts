//! Unit tests for Move VM transaction extraction and validation logic
//!
//! These tests verify that transaction parameters can be correctly extracted
//! from Move VM transactions for outflow fulfillment validation.

use serde_json::json;
use trusted_gmp::monitor::IntentEvent;
use trusted_gmp::mvm_client::MvmTransaction;
use trusted_gmp::validator::CrossChainValidator;
use trusted_gmp::validator::{
    extract_mvm_fulfillment_params, validate_outflow_fulfillment, FulfillmentTransactionParams,
};
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};
#[path = "../mod.rs"]
mod test_helpers;
use test_helpers::{
    build_test_config_with_mvm, create_default_fulfillment_transaction_params_mvm,
    create_default_mvm_transaction, create_default_intent_mvm, setup_mock_server_with_registry_mvm,
    DUMMY_INTENT_ID, DUMMY_METADATA_ADDR_MVM, DUMMY_REQUESTER_ADDR_MVMCON, DUMMY_SOLVER_ADDR_HUB, DUMMY_SOLVER_ADDR_MVMCON,
    DUMMY_SOLVER_REGISTRY_ADDR,
};

// ============================================================================
// MOVE VM TRANSACTION EXTRACTION TESTS
// ============================================================================

/// 1. Test: Extract MVM Fulfillment Params Success
/// Verifies that extract_mvm_fulfillment_params correctly extracts intent_id, recipient, amount, solver, and token_metadata from a valid Move VM transaction.
/// Why: The extraction function must correctly parse Move VM transaction payloads to extract all required parameters for validation.
#[test]
fn test_extract_mvm_fulfillment_params_success() {
    let tx = MvmTransaction {
        payload: Some(serde_json::json!({
            "function": "0x123::utils::transfer_with_intent_id",
            "arguments": [
                DUMMY_REQUESTER_ADDR_MVMCON, // recipient
                DUMMY_METADATA_ADDR_MVM, // metadata object address
                "0x17d7840", // amount
                DUMMY_INTENT_ID // intent_id
            ]
        })),
        ..create_default_mvm_transaction()
    };

    let result = extract_mvm_fulfillment_params(&tx);

    assert!(
        result.is_ok(),
        "Extraction should succeed for valid transaction"
    );
    let params = result.unwrap();
    assert_eq!(
        params.recipient_addr,
        DUMMY_REQUESTER_ADDR_MVMCON
    );
    assert_eq!(params.amount, 25000000); // 0x17d7840 in decimal
    assert_eq!(
        params.intent_id,
        DUMMY_INTENT_ID
    );
    assert_eq!(
        params.solver_addr,
        DUMMY_SOLVER_ADDR_MVMCON
    );
    assert_eq!(
        params.token_metadata,
        DUMMY_METADATA_ADDR_MVM
    );
}

/// 2. Test: Extract MVM Fulfillment Params Amount As Number
/// Verifies that extract_mvm_fulfillment_params correctly handles amount when Aptos serializes it as a JSON number.
/// Why: Aptos CLI accepts decimal format (u64:100000000) but serializes it as a JSON number in the transaction payload.
#[test]
fn test_extract_mvm_fulfillment_params_amount_as_number() {
    let tx = MvmTransaction {
        payload: Some(serde_json::json!({
            "function": "0x123::utils::transfer_with_intent_id",
            "arguments": [
                DUMMY_REQUESTER_ADDR_MVMCON, // recipient
                DUMMY_METADATA_ADDR_MVM, // metadata object address
                100000000u64, // Amount as JSON number (when passed as u64:100000000 to aptos CLI)
                DUMMY_INTENT_ID // intent_id
            ]
        })),
        ..create_default_mvm_transaction()
    };

    let result = extract_mvm_fulfillment_params(&tx);

    assert!(
        result.is_ok(),
        "Extraction should succeed when amount is a JSON number"
    );
    let params = result.unwrap();
    assert_eq!(params.amount, 100000000);
}

/// 3. Test: Extract MVM Fulfillment Params Amount As Decimal String
/// Verifies that extract_mvm_fulfillment_params correctly handles amount when Aptos serializes it as a decimal string without 0x prefix.
/// Why: Aptos may serialize u64 values as decimal strings instead of hex strings or JSON numbers.
#[test]
fn test_extract_mvm_fulfillment_params_amount_as_decimal_string() {
    let tx = MvmTransaction {
        payload: Some(serde_json::json!({
            "function": "0x123::utils::transfer_with_intent_id",
            "arguments": [
                DUMMY_REQUESTER_ADDR_MVMCON, // recipient
                DUMMY_METADATA_ADDR_MVM, // metadata object address
                "100000000", // Amount as decimal string (without 0x prefix)
                DUMMY_INTENT_ID // intent_id
            ]
        })),
        ..create_default_mvm_transaction()
    };

    let result = extract_mvm_fulfillment_params(&tx);

    assert!(
        result.is_ok(),
        "Extraction should succeed when amount is a decimal string"
    );
    let params = result.unwrap();
    assert_eq!(params.amount, 100000000);
}

/// 4. Test: Extract MVM Fulfillment Params Wrong Function
/// Verifies that extract_mvm_fulfillment_params fails when the transaction does not call utils::transfer_with_intent_id().
/// Why: The extraction function must correctly identify and reject transactions that are not the expected fulfillment transaction type.
#[test]
fn test_extract_mvm_fulfillment_params_wrong_function() {
    let tx = MvmTransaction {
        payload: Some(serde_json::json!({
            "function": "0x123::utils::transfer",
            "arguments": ["0xrecipient", "0xmetadata", "0x100"]
        })),
        ..create_default_mvm_transaction()
    };

    let result = extract_mvm_fulfillment_params(&tx);

    assert!(result.is_err(), "Extraction should fail for wrong function");
    let error_msg = result.unwrap_err().to_string();
    assert!(
        error_msg.contains("transfer_with_intent_id")
            || error_msg.contains("not a transfer_with_intent_id")
    );
}

/// 5. Test: Extract MVM Fulfillment Params Missing Payload
/// Verifies that extract_mvm_fulfillment_params fails when the transaction payload is missing.
/// Why: The extraction function must error explicitly when the payload is absent rather than silently proceeding.
#[test]
fn test_extract_mvm_fulfillment_params_missing_payload() {
    let tx = MvmTransaction {
        payload: None,
        ..create_default_mvm_transaction()
    };

    let result = extract_mvm_fulfillment_params(&tx);

    assert!(
        result.is_err(),
        "Extraction should fail when payload is missing"
    );
    assert!(result.unwrap_err().to_string().contains("payload"));
}

/// 6. Test: Extract MVM Fulfillment Params Address Normalization
/// Verifies that extract_mvm_fulfillment_params normalizes addresses with missing leading zeros to 64 hex characters.
/// Why: Move VM addresses can be serialized without leading zeros, but validation requires exactly 64 hex characters.
#[test]
fn test_extract_mvm_fulfillment_params_address_normalization() {
    // Address without leading zeros: eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee (62 chars)
    // Should be normalized to: 00eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee (64 chars)
    let recipient_short: &str = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";

    let tx = MvmTransaction {
        payload: Some(serde_json::json!({
            "function": "0x123::utils::transfer_with_intent_id",
            "arguments": [
                recipient_short,
                DUMMY_METADATA_ADDR_MVM, // metadata object address
                "100000000",
                DUMMY_INTENT_ID // intent_id
            ]
        })),
        sender: Some(
            DUMMY_SOLVER_ADDR_HUB.to_string(), // solver
        ),
        ..create_default_mvm_transaction()
    };

    let result = extract_mvm_fulfillment_params(&tx);

    assert!(
        result.is_ok(),
        "Extraction should succeed and normalize addresses"
    );
    let params = result.unwrap();

    // Recipient should be normalized to 64 hex chars with leading zeros
    assert_eq!(
        params.recipient_addr, "0x00eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
        "Recipient address should be padded to 64 hex characters"
    );

    // Intent ID is already 64 hex chars, so should remain unchanged
    assert_eq!(
        params.intent_id, DUMMY_INTENT_ID,
        "Intent ID should remain 64 hex characters (already correct length)"
    );
    assert_eq!(
        params.intent_id.len(),
        66, // 0x + 64 hex chars
        "Intent ID should be 66 characters (0x + 64 hex)"
    );

    // Solver should also be normalized (already 64 chars in test, but should still work)
    assert_eq!(
        params.solver_addr.len(),
        66, // 0x + 64 hex chars
        "Solver address should be 66 characters (0x + 64 hex)"
    );
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

// ============================================================================
// OUTFLOW FULFILLMENT VALIDATION TESTS
// ============================================================================

/// 14. Test: Validate Outflow Fulfillment Success
/// Verifies that validate_outflow_fulfillment succeeds when the transaction is successful, intent_id matches, recipient matches, amount matches, and solver is registered.
/// Why: The validation function must correctly accept fulfillments where all parameters satisfy the outflow requirements.
#[tokio::test]
async fn test_validate_outflow_fulfillment_success() {
    let solver_addr = DUMMY_SOLVER_ADDR_HUB;
    let solver_connected_chain_mvm_addr = DUMMY_SOLVER_ADDR_MVMCON;
    let solver_registry_addr = DUMMY_SOLVER_REGISTRY_ADDR;

    let (_mock_server, validator) = setup_mock_server_with_registry_mvm(
        solver_registry_addr,
        solver_addr,
        Some(solver_connected_chain_mvm_addr),
    )
    .await;

    let intent = IntentEvent {
        desired_amount: 25000000, // For outflow intents, validation uses desired_amount (amount desired on connected chain)
        reserved_solver_addr: Some(solver_addr.to_string()),
        ..create_default_intent_mvm()
    };

    let tx_params = FulfillmentTransactionParams {
        amount: 25000000,
        solver_addr: solver_connected_chain_mvm_addr.to_string(),
        ..create_default_fulfillment_transaction_params_mvm()
    };

    let result = validate_outflow_fulfillment(&validator, &intent, &tx_params, true).await;

    assert!(result.is_ok(), "Validation should complete without error");
    let validation_result = result.unwrap();
    assert!(
        validation_result.valid,
        "Validation should pass when all parameters match and solver is registered"
    );
}

/// 16. Test: Validate Outflow Fulfillment Fails On Unsuccessful Tx
/// Verifies that validate_outflow_fulfillment rejects a fulfillment when the underlying transaction failed.
/// Why: Only successful transactions can fulfill intents; failed transactions must never be accepted as valid fulfillments.
#[tokio::test]
async fn test_validate_outflow_fulfillment_fails_on_unsuccessful_tx() {
    let config = build_test_config_with_mvm();
    let validator = CrossChainValidator::new(&config)
        .await
        .expect("Failed to create validator");

    let intent = create_default_intent_mvm();
    let tx_params = FulfillmentTransactionParams {
        intent_id: intent.intent_id.clone(),
        amount: intent.desired_amount,
        ..create_default_fulfillment_transaction_params_mvm()
    };

    let result = validate_outflow_fulfillment(&validator, &intent, &tx_params, false).await;

    assert!(result.is_ok(), "Validation should complete without error");
    let validation_result = result.unwrap();
    assert!(
        !validation_result.valid,
        "Validation should fail when transaction was not successful"
    );
    assert!(
        validation_result.message.contains("not successful")
            || validation_result.message.contains("successful")
    );
}

/// 17. Test: Validate Outflow Fulfillment Fails On Intent ID Mismatch
/// Verifies that validate_outflow_fulfillment rejects a fulfillment when the transaction's intent_id does not match the intent's intent_id.
/// Why: Transactions must only fulfill the specific intent they reference to prevent cross-intent fulfillment attacks.
#[tokio::test]
async fn test_validate_outflow_fulfillment_fails_on_intent_id_mismatch() {
    let config = build_test_config_with_mvm();
    let validator = CrossChainValidator::new(&config)
        .await
        .expect("Failed to create validator");

    let intent = create_default_intent_mvm();
    let tx_params = FulfillmentTransactionParams {
        intent_id: "0xwrong_intent_id".to_string(), // Different intent_id
        amount: intent.desired_amount,
        ..create_default_fulfillment_transaction_params_mvm()
    };

    let result = validate_outflow_fulfillment(&validator, &intent, &tx_params, true).await;

    assert!(result.is_ok(), "Validation should complete without error");
    let validation_result = result.unwrap();
    assert!(
        !validation_result.valid,
        "Validation should fail when intent_id doesn't match"
    );
    assert!(
        validation_result.message.contains("intent_id")
            || validation_result.message.contains("match")
    );
}

/// 18. Test: Validate Outflow Fulfillment Fails On Recipient Mismatch
/// Verifies that validate_outflow_fulfillment rejects a fulfillment when the transaction's recipient does not match the intent's requester_addr_connected_chain.
/// Why: Tokens must be sent to the correct recipient address on the connected chain to prevent misdirected transfers.
#[tokio::test]
async fn test_validate_outflow_fulfillment_fails_on_recipient_mismatch() {
    let config = build_test_config_with_mvm();
    let validator = CrossChainValidator::new(&config)
        .await
        .expect("Failed to create validator");

    let intent = create_default_intent_mvm();

    let tx_params = FulfillmentTransactionParams {
        recipient_addr: "0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd".to_string(), // Different recipient (Move VM address format)
        amount: intent.desired_amount,
        ..create_default_fulfillment_transaction_params_mvm()
    };

    let result = validate_outflow_fulfillment(&validator, &intent, &tx_params, true).await;

    assert!(result.is_ok(), "Validation should complete without error");
    let validation_result = result.unwrap();
    assert!(
        !validation_result.valid,
        "Validation should fail when recipient doesn't match"
    );
    assert!(
        validation_result.message.contains("recipient")
            || validation_result.message.contains("requester")
    );
}

/// 19. Test: Validate Outflow Fulfillment Fails On Amount Mismatch
/// Verifies that validate_outflow_fulfillment rejects a fulfillment when the transaction's amount does not match the intent's desired_amount.
/// Why: The correct amount of tokens must be transferred to satisfy the intent; partial or excess amounts are invalid.
#[tokio::test]
async fn test_validate_outflow_fulfillment_fails_on_amount_mismatch() {
    let config = build_test_config_with_mvm();
    let validator = CrossChainValidator::new(&config)
        .await
        .expect("Failed to create validator");

    let intent = IntentEvent {
        desired_amount: 1000,
        ..create_default_intent_mvm()
    };

    let tx_params = FulfillmentTransactionParams {
        amount: 500, // Different amount
        ..create_default_fulfillment_transaction_params_mvm()
    };

    let result = validate_outflow_fulfillment(&validator, &intent, &tx_params, true).await;

    assert!(result.is_ok(), "Validation should complete without error");
    let validation_result = result.unwrap();
    assert!(
        !validation_result.valid,
        "Validation should fail when amount doesn't match"
    );
    assert!(
        validation_result.message.contains("amount")
            || validation_result.message.contains("Amount")
            || validation_result.message.contains("Transaction amount")
            || validation_result.message.contains("does not match")
            || validation_result.message.contains("desired amount")
    );
}

/// 20. Test: Validate Outflow Fulfillment Fails On Solver Not Registered
/// Verifies that validate_outflow_fulfillment rejects a fulfillment when the reserved solver is not registered in the hub chain solver registry.
/// Why: Only registered solvers can fulfill intents; unregistered solvers must be rejected to maintain system integrity.
#[tokio::test]
async fn test_validate_outflow_fulfillment_fails_on_solver_not_registered() {
    let unregistered_solver = DUMMY_SOLVER_ADDR_HUB;
    let solver_registry_addr = DUMMY_SOLVER_REGISTRY_ADDR;

    // Setup mock server with empty registry (solver not registered)
    let mock_server = MockServer::start().await;

    Mock::given(method("GET"))
        .and(path(format!("/v1/accounts/{}/resources", solver_registry_addr)))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!([]))) // Empty resources
        .mount(&mock_server)
        .await;

    let mut config = build_test_config_with_mvm();
    config.hub_chain.rpc_url = mock_server.uri();
    let validator = CrossChainValidator::new(&config)
        .await
        .expect("Failed to create validator");

    let intent = IntentEvent {
        desired_amount: 1000, // Set desired_amount to avoid validation failure on amount check
        reserved_solver_addr: Some(unregistered_solver.to_string()),
        ..create_default_intent_mvm()
    };

    let tx_params = FulfillmentTransactionParams {
        amount: intent.desired_amount,
        ..create_default_fulfillment_transaction_params_mvm()
    };

    let result = validate_outflow_fulfillment(&validator, &intent, &tx_params, true).await;

    assert!(result.is_ok(), "Validation should complete without error");
    let validation_result = result.unwrap();
    // The validation will fail because the reserved solver is not registered in the hub registry
    assert!(
        !validation_result.valid,
        "Validation should fail when reserved solver is not registered"
    );
    assert!(
        validation_result.message.contains("not registered")
            || validation_result.message.contains("registry")
            || validation_result.message.contains("solver")
            || validation_result.message.contains("Solver")
    );
}
