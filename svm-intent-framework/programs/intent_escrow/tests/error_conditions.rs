mod common;

use common::{create_escrow_ix, generate_intent_id, program_test, setup_basic_env};
use solana_sdk::{pubkey::Pubkey, signature::Signer, transaction::Transaction};

/// 1. Test: Zero Amount Rejection
/// Verifies that createEscrow reverts when amount is zero.
/// Why: Zero-amount escrows are meaningless and could cause accounting issues.
#[tokio::test]
async fn test_reject_zero_amount() {
    let program_test = program_test();
    let mut context = program_test.start_with_context().await;
    let env = setup_basic_env(&mut context).await;

    let intent_id = generate_intent_id();
    let amount = 0u64;

    let ix = create_escrow_ix(
        env.program_id,
        intent_id,
        amount,
        env.requester.pubkey(),
        env.mint,
        env.requester_token,
        env.solver.pubkey(),
        None,
    );

    let blockhash = context.banks_client.get_latest_blockhash().await.unwrap();
    let tx = Transaction::new_signed_with_payer(
        &[ix],
        Some(&env.requester.pubkey()),
        &[&env.requester],
        blockhash,
    );

    let result = context.banks_client.process_transaction(tx).await;
    assert!(result.is_err(), "Should have thrown an error");
}

/// 2. Test: Insufficient Allowance Rejection
/// Verifies that createEscrow reverts when token allowance is insufficient.
/// Why: Token transfers require explicit approval. Insufficient allowance must be rejected to prevent failed transfers.
/// We mint tokens to ensure the requester has balance, then approve less than needed to test specifically the allowance check, not the balance check.
///
/// NOTE: N/A for SVM - SPL tokens don't use approve/allowance pattern
// EVM: evm-intent-framework/test/error-conditions.test.js - "Should revert with insufficient ERC20 allowance"

/// 3. Test: Maximum Value Edge Case
/// Verifies that createEscrow handles maximum values correctly.
/// Why: Edge case testing ensures the program doesn't overflow or fail on boundary values.
///
/// NOTE: N/A for SVM - Covered in edge_cases.rs. Solana uses u64 for amounts
// EVM: evm-intent-framework/test/error-conditions.test.js - "Should handle maximum uint256 value in createEscrow"

/// 4. Test: Native Currency Escrow Creation with address(0)
/// Verifies that createEscrow accepts address(0) for native currency deposits.
/// Why: Native currency deposits use address(0) as a convention to distinguish from token deposits.
///
/// NOTE: N/A for SVM - No native currency escrow equivalent - all escrows use SPL tokens
// EVM: evm-intent-framework/test/error-conditions.test.js - "Should allow ETH escrow creation with address(0)"

/// 5. Test: Native Currency Amount Mismatch Rejection
/// Verifies that createEscrow reverts when msg.value doesn't match amount for native currency deposits.
/// Why: Prevents accidental underpayment or overpayment, ensuring exact amount matching.
///
/// NOTE: N/A for SVM - No native currency deposits - no msg.value equivalent
// EVM: evm-intent-framework/test/error-conditions.test.js - "Should revert with ETH amount mismatch"

/// 6. Test: Native Currency Not Accepted for Token Escrow
/// Verifies that createEscrow reverts when native currency is sent with a token address.
/// Why: Prevents confusion between native currency and token deposits. Token escrows should not accept native currency.
///
/// NOTE: N/A for SVM - No native currency/token distinction - all escrows use SPL tokens
// EVM: evm-intent-framework/test/error-conditions.test.js - "Should revert when ETH sent with token address"

/// 7. Test: Invalid Signature Length Rejection
/// Verifies that claim reverts with invalid signature length.
/// Why: Signatures must have the correct length. Invalid lengths indicate malformed signatures.
///
/// NOTE: N/A for SVM - Signature validation handled by Ed25519Program, not the escrow program
// EVM: evm-intent-framework/test/error-conditions.test.js - "Should revert with invalid signature length"

/// 8. Test: Non-Existent Escrow Cancellation Rejection
/// Verifies that cancel reverts with EscrowDoesNotExist for non-existent escrows.
/// Why: Prevents cancellation of non-existent escrows and ensures proper error handling.
///
/// NOTE: N/A for SVM - Already covered in cancel.rs - "test_revert_if_escrow_does_not_exist"
// EVM: evm-intent-framework/test/error-conditions.test.js - "Should revert cancel on non-existent escrow"

/// 9. Test: Zero Solver Address Rejection
/// Verifies that escrows cannot be created with zero/default solver address.
/// Why: A valid solver must be specified for claims.
#[tokio::test]
async fn test_reject_zero_solver_address() {
    let program_test = program_test();
    let mut context = program_test.start_with_context().await;
    let env = setup_basic_env(&mut context).await;

    let intent_id = generate_intent_id();
    let amount = 1_000_000u64;

    let ix = create_escrow_ix(
        env.program_id,
        intent_id,
        amount,
        env.requester.pubkey(),
        env.mint,
        env.requester_token,
        Pubkey::default(), // Zero address
        None,
    );

    let blockhash = context.banks_client.get_latest_blockhash().await.unwrap();
    let tx = Transaction::new_signed_with_payer(
        &[ix],
        Some(&env.requester.pubkey()),
        &[&env.requester],
        blockhash,
    );

    let result = context.banks_client.process_transaction(tx).await;
    assert!(result.is_err(), "Should have thrown an error");
}

/// 10. Test: Duplicate Intent ID Rejection
/// Verifies that escrows with duplicate intent IDs are rejected.
/// Why: Each intent ID must map to exactly one escrow.
#[tokio::test]
async fn test_reject_duplicate_intent_id() {
    let program_test = program_test();
    let mut context = program_test.start_with_context().await;
    let env = setup_basic_env(&mut context).await;

    let intent_id = generate_intent_id();
    let amount = 1_000_000u64;

    // Create first escrow
    let ix1 = create_escrow_ix(
        env.program_id,
        intent_id,
        amount,
        env.requester.pubkey(),
        env.mint,
        env.requester_token,
        env.solver.pubkey(),
        None,
    );

    let blockhash = context.banks_client.get_latest_blockhash().await.unwrap();
    let tx1 = Transaction::new_signed_with_payer(
        &[ix1],
        Some(&env.requester.pubkey()),
        &[&env.requester],
        blockhash,
    );
    context.banks_client.process_transaction(tx1).await.unwrap();

    // Warp to next slot to ensure clean transaction processing
    context.warp_to_slot(100).unwrap();

    // Try to create second escrow with same intent ID
    let ix2 = create_escrow_ix(
        env.program_id,
        intent_id,
        amount,
        env.requester.pubkey(),
        env.mint,
        env.requester_token,
        env.solver.pubkey(),
        None,
    );

    let blockhash = context.banks_client.get_latest_blockhash().await.unwrap();
    let tx2 = Transaction::new_signed_with_payer(
        &[ix2],
        Some(&env.requester.pubkey()),
        &[&env.requester],
        blockhash,
    );

    let result = context.banks_client.process_transaction(tx2).await;
    assert!(result.is_err(), "Should have thrown an error");
}

/// 11. Test: Insufficient Token Balance Rejection
/// Verifies that escrow creation fails if requester has insufficient tokens.
/// Why: Cannot deposit more tokens than available.
#[tokio::test]
async fn test_reject_if_requester_has_insufficient_balance() {
    let program_test = program_test();
    let mut context = program_test.start_with_context().await;
    let env = setup_basic_env(&mut context).await;

    let intent_id = generate_intent_id();
    let amount = 1_000_000_000_000u64; // More than minted

    let ix = create_escrow_ix(
        env.program_id,
        intent_id,
        amount,
        env.requester.pubkey(),
        env.mint,
        env.requester_token,
        env.solver.pubkey(),
        None,
    );

    let blockhash = context.banks_client.get_latest_blockhash().await.unwrap();
    let tx = Transaction::new_signed_with_payer(
        &[ix],
        Some(&env.requester.pubkey()),
        &[&env.requester],
        blockhash,
    );

    let result = context.banks_client.process_transaction(tx).await;
    // Token transfer error
    assert!(result.is_err(), "Should have thrown an error");
}
