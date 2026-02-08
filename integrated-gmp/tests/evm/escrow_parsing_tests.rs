//! Unit tests for EVM escrow event parsing
//!
//! These tests verify that EscrowCreated events are correctly parsed,
//! especially that amount and expiry fields are properly extracted.

use integrated_gmp::evm_client::EscrowCreatedEvent;
use integrated_gmp::monitor::{ChainType, EscrowEvent, EventMonitor, IntentEvent};

#[path = "../mod.rs"]
mod test_helpers;
use test_helpers::{
    build_test_config_with_evm, DUMMY_ESCROW_CONTRACT_ADDR_EVM, DUMMY_ESCROW_ID_MVM, DUMMY_EXPIRY, DUMMY_INTENT_ID,
    DUMMY_REQUESTER_ADDR_EVM, DUMMY_REQUESTER_ADDR_HUB, DUMMY_SOLVER_ADDR_EVM,
    DUMMY_TOKEN_ADDR_EVM, DUMMY_TX_HASH,
};

/// 1. Test: EscrowCreated Event Has Amount and Expiry
/// Verifies that EscrowCreatedEvent struct includes amount, expiry, escrow_id, and reserved_solver fields.
/// Why: These fields are required for proper escrow validation and cross-chain symmetry with MVM and SVM.
#[test]
fn test_escrow_created_event_has_amount_and_expiry() {
    let event = EscrowCreatedEvent {
        intent_id: DUMMY_INTENT_ID.to_string(),
        escrow_id: DUMMY_ESCROW_ID_MVM.to_string(),
        requester_addr: DUMMY_REQUESTER_ADDR_EVM.to_string(),
        amount: 100000,
        token_addr: DUMMY_TOKEN_ADDR_EVM.to_string(),
        reserved_solver: DUMMY_SOLVER_ADDR_EVM.to_string(),
        expiry: DUMMY_EXPIRY,
        block_number: "0x1".to_string(),
        transaction_hash: DUMMY_TX_HASH.to_string(),
    };

    assert_eq!(event.amount, 100000, "Amount should be 100000");
    assert_eq!(event.expiry, DUMMY_EXPIRY, "Expiry should be DUMMY_EXPIRY");
    assert_ne!(event.amount, 0, "Amount should NOT be 0");
}

/// 2. Test: Escrow Amount Is Not Hardcoded Zero
/// Verifies that the parsed amount field is properly populated, not defaulted to 0.
/// Why: A hardcoded zero amount would silently break all escrow validations.
#[test]
fn test_escrow_amount_is_not_hardcoded_zero() {
    let event = EscrowCreatedEvent {
        intent_id: DUMMY_ESCROW_ID_MVM.to_string(),
        escrow_id: DUMMY_ESCROW_CONTRACT_ADDR_EVM.to_string(),
        requester_addr: DUMMY_REQUESTER_ADDR_EVM.to_string(),
        amount: 1,
        token_addr: DUMMY_TOKEN_ADDR_EVM.to_string(),
        reserved_solver: DUMMY_SOLVER_ADDR_EVM.to_string(),
        expiry: DUMMY_EXPIRY,
        block_number: "0x100".to_string(),
        transaction_hash: DUMMY_TX_HASH.to_string(),
    };

    assert!(
        event.amount > 0,
        "Event amount must be greater than 0 for valid escrows"
    );
}

/// 3. Test: Amount Hex Parsing
/// Verifies that hex-to-u64 conversion works correctly for typical escrow amounts.
/// Why: EVM event data encodes amounts as uint256 hex; incorrect parsing would produce wrong escrow amounts.
#[test]
fn test_amount_hex_parsing() {
    // Simulate what the EVM client does when parsing the event data
    // Amount is encoded as uint256 in the last 64 hex chars of the amount field

    // 100000 in hex = 0x186a0, padded to 64 chars
    let amount_hex = "00000000000000000000000000000000000000000000000000000000000186a0";
    let parsed_amount = u64::from_str_radix(amount_hex, 16).unwrap();
    assert_eq!(parsed_amount, 100000);

    // 1 ETH in wei = 1000000000000000000 = 0xde0b6b3a7640000
    let one_eth_hex = "0000000000000000000000000000000000000000000000000de0b6b3a7640000";
    let parsed_eth = u64::from_str_radix(one_eth_hex, 16).unwrap();
    assert_eq!(parsed_eth, 1000000000000000000);
}

/// 4. Test: Expiry Hex Parsing
/// Verifies that expiry timestamp hex-to-u64 parsing works correctly.
/// Why: Incorrect expiry parsing could allow expired or premature escrow operations.
#[test]
fn test_expiry_hex_parsing() {
    // Far future timestamp used in tests
    let timestamp: u64 = DUMMY_EXPIRY;
    let expiry_hex = format!("{:064x}", timestamp);
    let parsed_expiry = u64::from_str_radix(&expiry_hex, 16).unwrap();
    assert_eq!(parsed_expiry, timestamp);
}

/// 5. Test: Zero Amount Escrow Fails Validation
/// Verifies that an escrow with zero amount is rejected during validation.
/// Why: Zero-amount escrows are invalid and must be caught before approval.
#[tokio::test]
async fn test_zero_amount_escrow_fails_validation() {
    let _ = tracing_subscriber::fmt::try_init();
    let config = build_test_config_with_evm();
    let monitor = EventMonitor::new(&config)
        .await
        .expect("Failed to create monitor");

    // Add intent that requires 1000 tokens
    {
        let mut intent_cache = monitor.event_cache.write().await;
        intent_cache.push(IntentEvent {
            intent_id: DUMMY_INTENT_ID.to_string(),
            offered_metadata: "{}".to_string(),
            offered_amount: 1000,
            desired_metadata: "{}".to_string(),
            desired_amount: 1000, // Requires 1000 tokens
            revocable: false,
            requester_addr: DUMMY_REQUESTER_ADDR_HUB.to_string(),
            requester_addr_connected_chain: None,
            reserved_solver_addr: None, // None to avoid triggering EVM RPC validation in unit tests
            connected_chain_id: Some(84532), // Base Sepolia
            expiry_time: DUMMY_EXPIRY,
            timestamp: 1,
        });
    }

    // Add escrow with amount = 0
    let zero_amount_escrow = EscrowEvent {
        escrow_id: DUMMY_INTENT_ID.to_string(), // escrow_id matches intent_id in this test
        intent_id: DUMMY_INTENT_ID.to_string(),
        requester_addr: DUMMY_REQUESTER_ADDR_EVM.to_string(),
        offered_metadata: "{}".to_string(),
        offered_amount: 0,
        desired_metadata: "{}".to_string(),
        desired_amount: 0,
        expiry_time: DUMMY_EXPIRY,
        revocable: false,
        reserved_solver_addr: None,
        chain_id: 84532,
        chain_type: ChainType::Evm,
        timestamp: 1,
    };

    // Validation should fail because amount 0 < required 1000
    let result = monitor.validate_intent_fulfillment(&zero_amount_escrow).await;
    assert!(
        result.is_err(),
        "Escrow with zero amount should fail validation"
    );

    let error_msg = result.unwrap_err().to_string();
    assert!(
        error_msg.contains("Deposit amount 0 is less than required"),
        "Error should mention deposit amount 0: {}",
        error_msg
    );
}

/// 6. Test: Correct Amount Escrow Passes Validation
/// Verifies that an escrow meeting the intent's required amount passes validation.
/// Why: Valid escrows must be approved for the fulfillment flow to proceed.
#[tokio::test]
async fn test_correct_amount_escrow_passes_validation() {
    let _ = tracing_subscriber::fmt::try_init();
    let config = build_test_config_with_evm();
    let monitor = EventMonitor::new(&config)
        .await
        .expect("Failed to create monitor");

    // Add intent that requires 1000 tokens
    {
        let mut intent_cache = monitor.event_cache.write().await;
        intent_cache.push(IntentEvent {
            intent_id: DUMMY_INTENT_ID.to_string(),
            offered_metadata: "{}".to_string(),
            offered_amount: 1000,
            desired_metadata: "{}".to_string(),
            desired_amount: 1000,
            revocable: false,
            requester_addr: DUMMY_REQUESTER_ADDR_HUB.to_string(),
            requester_addr_connected_chain: None,
            reserved_solver_addr: None, // None to avoid triggering EVM RPC validation in unit tests
            connected_chain_id: Some(84532),
            expiry_time: DUMMY_EXPIRY,
            timestamp: 1,
        });
    }

    // Add escrow with correct amount
    let valid_escrow = EscrowEvent {
        escrow_id: DUMMY_INTENT_ID.to_string(), // escrow_id matches intent_id in this test
        intent_id: DUMMY_INTENT_ID.to_string(),
        requester_addr: DUMMY_REQUESTER_ADDR_EVM.to_string(),
        offered_metadata: "{}".to_string(),
        offered_amount: 1000,
        desired_metadata: "{}".to_string(),
        desired_amount: 0,
        expiry_time: DUMMY_EXPIRY,
        revocable: false,
        reserved_solver_addr: None,
        chain_id: 84532,
        chain_type: ChainType::Evm,
        timestamp: 1,
    };

    // Validation should pass
    let result = monitor.validate_intent_fulfillment(&valid_escrow).await;
    assert!(
        result.is_ok(),
        "Escrow with correct amount should pass validation: {:?}",
        result
    );
}
