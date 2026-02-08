//! Unit tests for EVM solver registry validation
//!
//! These tests verify that EVM escrow solver validation works correctly,
//! including registry lookup, address matching, and error handling.

use integrated_gmp::monitor::IntentEvent;
#[path = "../mod.rs"]
mod test_helpers;
use test_helpers::{
    create_default_intent_evm, DUMMY_SOLVER_ADDR_EVM, DUMMY_SOLVER_ADDR_HUB, setup_mock_server_with_error,
    setup_mock_server_with_evm_address_response,
};

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/// Create a test intent with the given solver
fn create_test_intent(solver_addr: Option<String>) -> IntentEvent {
    IntentEvent {
        offered_metadata: "{}".to_string(),
        desired_metadata: "{}".to_string(),
        expiry_time: 1000000,
        reserved_solver_addr: solver_addr,
        ..create_default_intent_evm()
    }
}

// ============================================================================
// TESTS
// ============================================================================

/// 1. Test: Successful EVM Solver Validation
/// Verifies that validate_evm_escrow_solver succeeds when escrow reserved_solver matches registered EVM address.
/// Why: This is the happy path for solver validation; addresses must match for escrow approval.
#[tokio::test]
async fn test_successful_evm_solver_validation() {
    let _ = tracing_subscriber::fmt::try_init();

    let (_mock_server, config, _validator) =
        setup_mock_server_with_evm_address_response(DUMMY_SOLVER_ADDR_HUB, Some(DUMMY_SOLVER_ADDR_EVM))
            .await;

    let intent = create_test_intent(Some(DUMMY_SOLVER_ADDR_HUB.to_string()));

    // Test with matching address
    let result = integrated_gmp::validator::inflow_evm::validate_evm_escrow_solver(
        &intent,
        DUMMY_SOLVER_ADDR_EVM, // matching solver address as registered
        &config.hub_chain.rpc_url,
        &config.hub_chain.intent_module_addr,
    )
    .await;

    assert!(result.is_ok(), "Validation should succeed");
    let validation_result = result.unwrap();
    assert!(
        validation_result.valid,
        "Validation should be valid when addresses match"
    );
    assert!(
        validation_result.message.contains("successful"),
        "Message should indicate success"
    );
}

/// 2. Test: Rejection When Solver Not Registered
/// Verifies that validate_evm_escrow_solver rejects when solver is not found in registry.
/// Why: Unregistered solvers must be rejected to prevent unauthorized escrow claims.
#[tokio::test]
async fn test_rejection_when_solver_not_registered() {
    let _ = tracing_subscriber::fmt::try_init();

    let (_mock_server, config, _validator) = setup_mock_server_with_evm_address_response(
        "0xunregistered_solver", // solver not registered
        None, // No EVM address (solver not registered)
    )
    .await;

    let intent = create_test_intent(Some("0xunregistered_solver".to_string())); // solver not registered

    let result = integrated_gmp::validator::inflow_evm::validate_evm_escrow_solver(
        &intent,
        DUMMY_SOLVER_ADDR_EVM,
        &config.hub_chain.rpc_url,
        &config.hub_chain.intent_module_addr,
    )
    .await;

    assert!(result.is_ok(), "Validation should complete without error");
    let validation_result = result.unwrap();
    assert!(
        !validation_result.valid,
        "Validation should fail when solver is not registered"
    );
    assert!(
        validation_result.message.contains("not registered")
            || validation_result.message.contains("Solver"),
        "Error message should indicate solver not registered"
    );
}

/// 3. Test: Rejection When EVM Addresses Don't Match
/// Verifies that validate_evm_escrow_solver rejects when registered EVM address doesn't match escrow reserved_solver.
/// Why: Address mismatches indicate a different solver than intended, which must be rejected.
#[tokio::test]
async fn test_rejection_when_evm_addresses_dont_match() {
    let _ = tracing_subscriber::fmt::try_init();

    let solver_addr = DUMMY_SOLVER_ADDR_HUB;
    let solver_registered_evm_addr = DUMMY_SOLVER_ADDR_EVM;
    let (_mock_server, config, _validator) =
        setup_mock_server_with_evm_address_response(solver_addr, Some(solver_registered_evm_addr))
            .await;

    let intent = create_test_intent(Some(solver_addr.to_string()));

    let result = integrated_gmp::validator::inflow_evm::validate_evm_escrow_solver(
        &intent,
        "0xwrong_solver", // different solver address as registered
        &config.hub_chain.rpc_url,
        &config.hub_chain.intent_module_addr,
    )
    .await;

    assert!(result.is_ok(), "Validation should complete without error");
    let validation_result = result.unwrap();
    assert!(
        !validation_result.valid,
        "Validation should fail when addresses don't match"
    );
    assert!(
        validation_result.message.contains("does not match")
            || validation_result.message.contains("match"),
        "Error message should indicate address mismatch"
    );
}

/// 4. Test: EVM Address Normalization
/// Verifies that EVM address comparison is case-insensitive and handles 0x prefix correctly.
/// Why: Ethereum addresses are case-insensitive; normalization prevents false rejections.
#[tokio::test]
async fn test_evm_address_normalization() {
    let _ = tracing_subscriber::fmt::try_init();

    // Test cases: (escrow_addr, registered_addr, should_match)
    // Use valid 20-byte EVM addresses (40 hex characters)
    let test_cases = vec![
        ("0xABC1234567890123456789012345678901234567", "0xabc1234567890123456789012345678901234567", true),
        ("0xabc1234567890123456789012345678901234567", "0xABC1234567890123456789012345678901234567", true),
        ("ABC1234567890123456789012345678901234567", "0xabc1234567890123456789012345678901234567", true),    // Missing 0x prefix
        ("0xABC1234567890123456789012345678901234567", "abc1234567890123456789012345678901234567", true),    // Missing 0x prefix
        ("0xABC1234567890123456789012345678901234567", "0xDEF4567890123456789012345678901234567890", false), // Different addresses
    ];

    for (escrow_addr, registered_addr, should_match) in test_cases {
        let solver_addr = DUMMY_SOLVER_ADDR_HUB;
        let (_mock_server, config, _validator) =
            setup_mock_server_with_evm_address_response(solver_addr, Some(registered_addr))
                .await;

        let intent = create_test_intent(Some(solver_addr.to_string()));

        let result = integrated_gmp::validator::inflow_evm::validate_evm_escrow_solver(
            &intent,
            escrow_addr,
            &config.hub_chain.rpc_url,
            &config.hub_chain.intent_module_addr,
        )
        .await;

        assert!(result.is_ok(), "Validation should complete");
        let validation_result = result.unwrap();
        assert_eq!(
            validation_result.valid, should_match,
            "Address normalization failed: escrow='{}', registered='{}', expected_match={}",
            escrow_addr, registered_addr, should_match
        );
    }
}

/// 5. Test: Error Handling for Registry Query Failures
/// Verifies that validate_evm_escrow_solver returns an error when the registry query fails.
/// Why: Network errors must propagate as errors, not be silently treated as "not registered".
#[tokio::test]
async fn test_error_handling_for_registry_query_failures() {
    let _ = tracing_subscriber::fmt::try_init();

    // Setup mock server that returns a 500 error (simulating network/server error)
    let (_mock_server, config, _validator) = setup_mock_server_with_error(500).await;

    let intent = create_test_intent(Some(DUMMY_SOLVER_ADDR_HUB.to_string()));

    let result = integrated_gmp::validator::inflow_evm::validate_evm_escrow_solver(
        &intent,
        DUMMY_SOLVER_ADDR_EVM,
        &config.hub_chain.rpc_url,
        &config.hub_chain.intent_module_addr,
    )
    .await;

    // When registry query fails, it should return an error, not treat it as "not registered"
    assert!(
        result.is_err(),
        "Validation should return an error when registry query fails"
    );
    let error_msg = result.unwrap_err().to_string();
    assert!(
        error_msg.contains("Failed to query")
            || error_msg.contains("resources")
            || error_msg.contains("registry"),
        "Error message should indicate registry query failure. Got: {}",
        error_msg
    );
}

/// 6. Test: Rejection When Intent Has No Solver
/// Verifies that validate_evm_escrow_solver rejects when intent has no reserved solver.
/// Why: Intents without a solver cannot be matched to escrow solvers.
#[tokio::test]
async fn test_rejection_when_intent_has_no_solver() {
    let _ = tracing_subscriber::fmt::try_init();

    let (_mock_server, config, _validator) = setup_mock_server_with_evm_address_response(
        DUMMY_SOLVER_ADDR_HUB,
        Some(DUMMY_SOLVER_ADDR_EVM),
    )
    .await;

    let intent = create_test_intent(None); // No solver

    let result = integrated_gmp::validator::inflow_evm::validate_evm_escrow_solver(
        &intent,
        DUMMY_SOLVER_ADDR_EVM,
        &config.hub_chain.rpc_url,
        &config.hub_chain.intent_module_addr,
    )
    .await;

    assert!(result.is_ok(), "Validation should complete without error");
    let validation_result = result.unwrap();
    assert!(
        !validation_result.valid,
        "Validation should fail when intent has no reserved solver"
    );
    assert!(
        validation_result.message.contains("does not have a reserved solver"),
        "Error message should indicate intent has no solver"
    );
}
