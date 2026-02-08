//! Unit tests for EVM transaction extraction and validation logic
//!
//! These tests verify that transaction parameters can be correctly extracted
//! from EVM transactions for outflow fulfillment validation.

use integrated_gmp::evm_client::EvmTransaction;
use integrated_gmp::monitor::{normalize_intent_id, IntentEvent};
use integrated_gmp::validator::CrossChainValidator;
use integrated_gmp::validator::{
    extract_evm_fulfillment_params, validate_outflow_fulfillment, FulfillmentTransactionParams,
};
#[path = "../mod.rs"]
mod test_helpers;
use test_helpers::{
    build_test_config_with_evm, create_default_evm_transaction,
    create_default_fulfillment_transaction_params_evm, create_default_intent_evm,
    setup_mock_server_with_registry_evm, DUMMY_INTENT_ID, DUMMY_REQUESTER_ADDR_EVM,
    DUMMY_SOLVER_ADDR_EVM, DUMMY_SOLVER_ADDR_HUB, DUMMY_SOLVER_REGISTRY_ADDR,
    DUMMY_TOKEN_ADDR_EVM,
};

// ============================================================================
// EVM TRANSACTION EXTRACTION TESTS
// ============================================================================

/// 7. Test: Extract EVM Fulfillment Params Success
/// Verifies that all parameters are correctly extracted from a valid EVM ERC20 transfer transaction with appended intent_id.
/// Why: The extraction function must correctly parse calldata to obtain intent_id, recipient, amount, solver, and token_metadata for downstream validation.
#[test]
fn test_extract_evm_fulfillment_params_success() {
    // ERC20 transfer selector: 0xa9059cbb
    // Calldata: selector (4 bytes) + to (32 bytes) + amount (32 bytes) + intent_id (32 bytes)
    // to: recipient address (padded to 32 bytes = 64 hex chars)
    // amount: 0x17d7840 = 25000000 (padded to 32 bytes = 64 hex chars)
    // intent_id: intent ID (64 hex chars)
    // Total: 8 (selector) + 64 (to) + 64 (amount) + 64 (intent_id) = 200 hex chars
    let recipient_hex = DUMMY_REQUESTER_ADDR_EVM.strip_prefix("0x").unwrap();
    let intent_id_hex = DUMMY_INTENT_ID.strip_prefix("0x").unwrap();
    let calldata = format!(
        "a9059cbb000000000000000000000000{}00000000000000000000000000000000000000000000000000000000017d7840{}",
        recipient_hex, intent_id_hex
    );

    let tx = EvmTransaction {
        input: format!("0x{}", calldata),
        ..create_default_evm_transaction()
    };

    let result = extract_evm_fulfillment_params(&tx);

    assert!(
        result.is_ok(),
        "Extraction should succeed for valid transaction"
    );
    let params = result.unwrap();
    assert_eq!(
        params.recipient_addr,
        DUMMY_REQUESTER_ADDR_EVM
    );
    assert_eq!(params.amount, 25000000); // 0x17d7840 in decimal
    assert_eq!(params.intent_id, normalize_intent_id(DUMMY_INTENT_ID));
    assert_eq!(params.solver_addr, DUMMY_SOLVER_ADDR_EVM);
    assert_eq!(
        params.token_metadata,
        DUMMY_TOKEN_ADDR_EVM
    );

    // Verify the transaction's `to` field is used for token_metadata
    assert_eq!(
        tx.to,
        Some(DUMMY_TOKEN_ADDR_EVM.to_string())
    );
}

/// 8. Test: Extract EVM Fulfillment Params Wrong Selector
/// Verifies that extraction fails with an error when the transaction does not use the ERC20 transfer() selector.
/// Why: Only ERC20 transfer calls are valid fulfillment transactions, so non-transfer selectors must be rejected.
#[test]
fn test_extract_evm_fulfillment_params_wrong_selector() {
    let tx = EvmTransaction {
        input: "0x12345678".to_string(), // Wrong selector
        ..create_default_evm_transaction()
    };

    let result = extract_evm_fulfillment_params(&tx);

    assert!(result.is_err(), "Extraction should fail for wrong selector");
    let error_msg = result.unwrap_err().to_string();
    assert!(error_msg.contains("ERC20 transfer") || error_msg.contains("not an ERC20 transfer"));
}

/// 9. Test: Extract EVM Fulfillment Params Insufficient Calldata
/// Verifies that extraction fails when the transaction calldata is too short to contain all required fields.
/// Why: Calldata length must be validated before parsing to prevent out-of-bounds reads on truncated data.
#[test]
fn test_extract_evm_fulfillment_params_insufficient_calldata() {
    let tx = EvmTransaction {
        input: "0xa9059cbb0000000000000000000000000aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
            .to_string(), // Too short - missing amount and intent_id
        ..create_default_evm_transaction()
    };

    let result = extract_evm_fulfillment_params(&tx);

    assert!(
        result.is_err(),
        "Extraction should fail when calldata is too short"
    );
    let error_msg = result.unwrap_err().to_string();
    assert!(error_msg.contains("Insufficient") || error_msg.contains("length"));
}

/// 10. Test: Extract EVM Fulfillment Params Amount Exceeds u64 Max
/// Verifies that extraction fails with a clear error when the transaction amount exceeds u64::MAX.
/// Why: Move contracts only support u64 for amounts, so EVM amounts exceeding this limit must be rejected to prevent overflow.
#[test]
fn test_extract_evm_fulfillment_params_amount_exceeds_u64_max() {
    // u64::MAX = 18446744073709551615 (0xffffffffffffffff)
    // Use u64::MAX + 1 = 18446744073709551616 (0x10000000000000000)
    // Padded to 32 bytes (64 hex chars): 0000000000000000000000000000000000000000000000010000000000000000
    let amount_exceeding_u64_max =
        "0000000000000000000000000000000000000000000000010000000000000000"; // u64::MAX + 1, padded to 32 bytes

    let intent_id_hex = DUMMY_INTENT_ID.strip_prefix("0x").unwrap();
    let calldata = format!(
        "a9059cbb000000000000000000000000aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa{}{}",
        amount_exceeding_u64_max,
        intent_id_hex
    );

    let tx = EvmTransaction {
        input: format!("0x{}", calldata),
        ..create_default_evm_transaction()
    };

    let result = extract_evm_fulfillment_params(&tx);

    assert!(
        result.is_err(),
        "Extraction should fail when amount exceeds u64::MAX"
    );
    let error_msg = result.unwrap_err().to_string();
    assert!(
        error_msg.contains("exceeds") && error_msg.contains("u64::MAX"),
        "Error message should mention exceeding u64::MAX. Got: {}",
        error_msg
    );
    assert!(
        error_msg.contains("Move contract") || error_msg.contains("Move contracts"),
        "Error message should mention Move contract limitation. Got: {}",
        error_msg
    );
}

/// 11. Test: Extract EVM Fulfillment Params Amount Equals u64 Max
/// Verifies that extraction succeeds when the transaction amount is exactly u64::MAX.
/// Why: The boundary value u64::MAX must be accepted as a valid amount since it is within the Move contract's supported range.
#[test]
fn test_extract_evm_fulfillment_params_amount_equals_u64_max() {
    // u64::MAX = 18446744073709551615 (0xffffffffffffffff)
    // Padded to 32 bytes (64 hex chars): 000000000000000000000000000000000000000000000000ffffffffffffffff
    let amount_u64_max = "000000000000000000000000000000000000000000000000ffffffffffffffff"; // u64::MAX, padded to 32 bytes

    let intent_id_hex = DUMMY_INTENT_ID.strip_prefix("0x").unwrap();
    let calldata = format!(
        "a9059cbb000000000000000000000000aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa{}{}",
        amount_u64_max,
        intent_id_hex
    );

    let tx = EvmTransaction {
        input: format!("0x{}", calldata),
        ..create_default_evm_transaction()
    };

    let result = extract_evm_fulfillment_params(&tx);

    assert!(
        result.is_ok(),
        "Extraction should succeed when amount equals u64::MAX"
    );
    let params = result.unwrap();
    assert_eq!(
        params.amount,
        u64::MAX,
        "Extracted amount should equal u64::MAX"
    );
}

/// 12. Test: Extract EVM Fulfillment Params Large Valid Amount
/// Verifies that extraction succeeds for a large but valid u64 amount such as 1 ETH in wei (10^18).
/// Why: Large amounts within the u64 range must be handled correctly without false overflow rejections.
#[test]
fn test_extract_evm_fulfillment_params_large_valid_amount() {
    // Use a large but valid u64 value: 1000000000000000000 (10^18, 1 ETH in wei)
    // This is well within u64::MAX but tests large number handling
    let large_amount = "0000000000000000000000000000000000000000000000000de0b6b3a7640000"; // 1000000000000000000, padded to 32 bytes (64 hex chars)
    let recipient_hex = DUMMY_REQUESTER_ADDR_EVM.strip_prefix("0x").unwrap();
    let intent_id_hex = DUMMY_INTENT_ID.strip_prefix("0x").unwrap();
    let calldata = format!(
        "a9059cbb000000000000000000000000{}{}{}",
        recipient_hex,
        large_amount,
        intent_id_hex
    );

    let tx = EvmTransaction {
        input: format!("0x{}", calldata),
        ..create_default_evm_transaction()
    };

    let result = extract_evm_fulfillment_params(&tx);

    assert!(
        result.is_ok(),
        "Extraction should succeed for large but valid u64 amount"
    );
    let params = result.unwrap();
    assert_eq!(
        params.amount, 1000000000000000000u64,
        "Extracted amount should match the large value"
    );
}

/// 13. Test: Extract EVM Fulfillment Params Normalizes Intent ID With Leading Zeros
/// Verifies that a padded intent_id with leading zeros is normalized by stripping those zeros during extraction.
/// Why: EVM pads intent_id to 32 bytes, but intents may store the same ID without padding, so normalization is required for matching.
#[test]
fn test_extract_evm_fulfillment_params_normalizes_intent_id_with_leading_zeros() {
    // ERC20 transfer selector: 0xa9059cbb
    // Calldata: selector (4 bytes) + to (32 bytes) + amount (32 bytes) + intent_id (32 bytes)
    // intent_id: 0x00aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa (with leading zero, padded to 64 hex chars)
    // Should normalize to: 0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
    let calldata = "a9059cbb000000000000000000000000aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa00000000000000000000000000000000000000000000000000000000017d784000aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

    let tx = EvmTransaction {
        input: format!("0x{}", calldata),
        ..create_default_evm_transaction()
    };

    let result = extract_evm_fulfillment_params(&tx);

    assert!(
        result.is_ok(),
        "Extraction should succeed for transaction with padded intent_id"
    );
    let params = result.unwrap();
    // Should be normalized (leading zero removed)
    assert_eq!(
        params.intent_id,
        "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        "Extracted intent_id should be normalized (leading zeros removed)"
    );
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

// ============================================================================
// OUTFLOW FULFILLMENT VALIDATION TESTS
// ============================================================================

/// 14. Test: Validate Outflow Fulfillment Success
/// Verifies that validation passes when all parameters match: successful tx, correct intent_id, recipient, amount, and solver.
/// Why: The happy-path must confirm that all validation requirements are correctly checked and a fully matching fulfillment is accepted.
#[tokio::test]
async fn test_validate_outflow_fulfillment_success() {
    let solver_registry_addr = DUMMY_SOLVER_REGISTRY_ADDR;

    let (_mock_server, validator) =
        setup_mock_server_with_registry_evm(solver_registry_addr, DUMMY_SOLVER_ADDR_HUB, Some(DUMMY_SOLVER_ADDR_EVM)).await;

    let intent = IntentEvent {
        desired_amount: 25000000, // For outflow intents, validation uses desired_amount (amount desired on connected chain)
        reserved_solver_addr: Some(DUMMY_SOLVER_ADDR_HUB.to_string()),
        ..create_default_intent_evm()
    };

    let tx_params = FulfillmentTransactionParams {
        amount: 25000000,
        ..create_default_fulfillment_transaction_params_evm()
    };

    let result = validate_outflow_fulfillment(&validator, &intent, &tx_params, true).await;

    assert!(result.is_ok(), "Validation should complete without error");
    let validation_result = result.unwrap();
    assert!(
        validation_result.valid,
        "Validation should pass when all parameters match and solver is registered. Message: {}",
        validation_result.message
    );
}

/// 15. Test: Validate Outflow Fulfillment Succeeds With Normalized Intent ID
/// Verifies that validation passes when the transaction's padded intent_id matches the intent's unpadded intent_id after normalization.
/// Why: EVM pads intent_id to 32 bytes while intents may omit leading zeros, so normalization must be applied before comparison.
#[tokio::test]
async fn test_validate_outflow_fulfillment_succeeds_with_normalized_intent_id() {
    let solver_registry_addr = DUMMY_SOLVER_REGISTRY_ADDR;

    let (_mock_server, validator) =
        setup_mock_server_with_registry_evm(solver_registry_addr, DUMMY_SOLVER_ADDR_HUB, Some(DUMMY_SOLVER_ADDR_EVM)).await;

    // Request-intent has intent_id without leading zeros
    let intent = IntentEvent {
        intent_id: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa".to_string(),
        desired_amount: 25000000,
        reserved_solver_addr: Some(DUMMY_SOLVER_ADDR_HUB.to_string()),
        ..create_default_intent_evm()
    };

    // Transaction has intent_id with leading zeros (padded format)
    let tx_params = FulfillmentTransactionParams {
        intent_id: "0x00aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa".to_string(),
        amount: 25000000,
        ..create_default_fulfillment_transaction_params_evm()
    };

    let result = validate_outflow_fulfillment(&validator, &intent, &tx_params, true).await;

    assert!(result.is_ok(), "Validation should complete without error");
    let validation_result = result.unwrap();
    assert!(
        validation_result.valid,
        "Validation should pass when intent_ids match after normalization. Message: {}",
        validation_result.message
    );
}

/// 16. Test: Validate Outflow Fulfillment Fails on Unsuccessful Tx
/// Verifies that validation fails when the fulfillment transaction was not successful.
/// Why: Only successful transactions can fulfill intents; failed transactions must be rejected to prevent false fulfillments.
#[tokio::test]
async fn test_validate_outflow_fulfillment_fails_on_unsuccessful_tx() {
    let config = build_test_config_with_evm();
    let validator = CrossChainValidator::new(&config)
        .await
        .expect("Failed to create validator");

    let intent = create_default_intent_evm();
    let tx_params = FulfillmentTransactionParams {
        amount: intent.desired_amount,
        ..create_default_fulfillment_transaction_params_evm()
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

/// 17. Test: Validate Outflow Fulfillment Fails on Intent ID Mismatch
/// Verifies that validation fails when the transaction's intent_id does not match the intent's intent_id.
/// Why: Transactions must only fulfill the specific intent they reference to prevent cross-intent fulfillment attacks.
#[tokio::test]
async fn test_validate_outflow_fulfillment_fails_on_intent_id_mismatch() {
    let config = build_test_config_with_evm();
    let validator = CrossChainValidator::new(&config)
        .await
        .expect("Failed to create validator");

    let intent = create_default_intent_evm();
    let tx_params = FulfillmentTransactionParams {
        intent_id: "0xwrong_intent_id".to_string(), // Different intent_id
        amount: intent.desired_amount,
        ..create_default_fulfillment_transaction_params_evm()
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

/// 18. Test: Validate Outflow Fulfillment Fails on Recipient Mismatch
/// Verifies that validation fails when the transaction's recipient does not match the intent's requester_addr_connected_chain.
/// Why: Tokens must be sent to the correct recipient on the connected chain to prevent funds being delivered to the wrong address.
#[tokio::test]
async fn test_validate_outflow_fulfillment_fails_on_recipient_mismatch() {
    let config = build_test_config_with_evm();
    let validator = CrossChainValidator::new(&config)
        .await
        .expect("Failed to create validator");

    let intent = create_default_intent_evm();

    let tx_params = FulfillmentTransactionParams {
        recipient_addr: "0xdddddddddddddddddddddddddddddddddddddddd".to_string(), // Different recipient (EVM address format)
        amount: intent.desired_amount,
        ..create_default_fulfillment_transaction_params_evm()
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

/// 19. Test: Validate Outflow Fulfillment Fails on Amount Mismatch
/// Verifies that validation fails when the transaction's amount does not match the intent's desired_amount.
/// Why: The correct amount of tokens must be transferred to satisfy the intent; partial or excess amounts must be rejected.
#[tokio::test]
async fn test_validate_outflow_fulfillment_fails_on_amount_mismatch() {
    let config = build_test_config_with_evm();
    let validator = CrossChainValidator::new(&config)
        .await
        .expect("Failed to create validator");

    let intent = IntentEvent {
        desired_amount: 1000,
        ..create_default_intent_evm()
    };

    let tx_params = FulfillmentTransactionParams {
        amount: 500, // Different amount
        ..create_default_fulfillment_transaction_params_evm()
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

/// 21. Test: Validate Outflow Fulfillment Fails on Solver Mismatch
/// Verifies that validation fails when the transaction's solver does not match the intent's reserved solver.
/// Why: Only the authorized solver may fulfill an intent to enforce solver reservation and prevent unauthorized fulfillments.
#[tokio::test]
async fn test_validate_outflow_fulfillment_fails_on_solver_mismatch() {
    let different_solver = "0xffffffffffffffffffffffffffffffffffffffff"; // Different solver address for testing mismatch
    let solver_registry_addr = DUMMY_SOLVER_REGISTRY_ADDR;

    let (_mock_server, validator) = setup_mock_server_with_registry_evm(
        solver_registry_addr,
        DUMMY_SOLVER_ADDR_HUB,
        Some(DUMMY_SOLVER_ADDR_EVM),
    )
    .await;

    let intent = IntentEvent {
        desired_amount: 1000, // Set desired_amount to avoid validation failure on amount check
        reserved_solver_addr: Some(DUMMY_SOLVER_ADDR_HUB.to_string()),
        ..create_default_intent_evm()
    };

    let tx_params = FulfillmentTransactionParams {
        amount: intent.desired_amount,
        solver_addr: different_solver.to_string(), // Different solver (EVM address format)
        ..create_default_fulfillment_transaction_params_evm()
    };

    let result = validate_outflow_fulfillment(&validator, &intent, &tx_params, true).await;

    assert!(result.is_ok(), "Validation should complete without error");
    let validation_result = result.unwrap();
    if validation_result.valid {
        panic!(
            "Validation should fail when solver doesn't match. Message: {}",
            validation_result.message
        );
    }
    assert!(
        !validation_result.valid,
        "Validation should fail when solver doesn't match"
    );
    assert!(
        validation_result.message.contains("solver")
            || validation_result.message.contains("Solver")
            || validation_result.message.contains("Transaction solver")
            || validation_result.message.contains("does not match")
            || validation_result.message.contains("reserved solver"),
        "Validation message should mention solver mismatch. Got: {}",
        validation_result.message
    );
}
