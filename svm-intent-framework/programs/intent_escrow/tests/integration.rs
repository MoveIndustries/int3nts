mod common;

use common::{
    create_claim_ix, create_cancel_ix, create_ed25519_instruction, create_escrow_ix,
    generate_intent_id, get_token_balance, program_test, read_escrow, setup_basic_env,
};
use intent_escrow::state::seeds;
use solana_sdk::{
    clock::Clock,
    pubkey::Pubkey,
    signature::Signer,
    sysvar,
    transaction::Transaction,
};
use bincode::deserialize;

// ============================================================================
// INTEGRATION TESTS
// ============================================================================

/// Test: Complete Deposit to Claim Workflow
/// Verifies the full workflow from escrow creation through claim.
/// Why: Integration test ensures all components work together correctly in the happy path.
#[tokio::test]
async fn test_complete_full_deposit_to_claim_workflow() {
    let program_test = program_test();
    let mut context = program_test.start_with_context().await;
    let env = setup_basic_env(&mut context).await;

    let intent_id = generate_intent_id();
    let amount = 1_000_000u64;

    let (escrow_pda, _) =
        Pubkey::find_program_address(&[seeds::ESCROW_SEED, &intent_id], &env.program_id);
    let (vault_pda, _) =
        Pubkey::find_program_address(&[seeds::VAULT_SEED, &intent_id], &env.program_id);

    // Step 1: Create escrow
    let create_ix = create_escrow_ix(
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
    let create_tx = Transaction::new_signed_with_payer(
        &[create_ix],
        Some(&env.requester.pubkey()),
        &[&env.requester],
        blockhash,
    );
    context.banks_client.process_transaction(create_tx).await.unwrap();

    // Verify escrow created
    let vault_balance_after_create = get_token_balance(&mut context, vault_pda).await;
    assert_eq!(vault_balance_after_create, amount);

    // Step 2: Claim with verifier signature
    let signature = env.verifier.sign_message(&intent_id);
    let mut signature_bytes = [0u8; 64];
    signature_bytes.copy_from_slice(signature.as_ref());

    let ed25519_ix = create_ed25519_instruction(&intent_id, &signature_bytes, &env.verifier.pubkey());

    let claim_ix = create_claim_ix(
        env.program_id,
        intent_id,
        signature_bytes,
        escrow_pda,
        env.state_pda,
        vault_pda,
        env.solver_token,
    );

    let blockhash = context.banks_client.get_latest_blockhash().await.unwrap();
    let claim_tx = Transaction::new_signed_with_payer(
        &[ed25519_ix, claim_ix],
        Some(&context.payer.pubkey()),
        &[&context.payer],
        blockhash,
    );
    context.banks_client.process_transaction(claim_tx).await.unwrap();

    // Step 3: Verify final state
    let solver_balance = get_token_balance(&mut context, env.solver_token).await;
    assert_eq!(solver_balance, amount);

    let vault_balance_after_claim = get_token_balance(&mut context, vault_pda).await;
    assert_eq!(vault_balance_after_claim, 0);

    let escrow_account = context
        .banks_client
        .get_account(escrow_pda)
        .await
        .unwrap()
        .unwrap();
    let escrow = read_escrow(&escrow_account);
    assert!(escrow.is_claimed);
}

/// Test: Multi-Token Scenarios
/// Verifies that the escrow works with different token types.
/// Why: The escrow must support any token type, not just a single token.
///
/// NOTE: N/A for SVM - All escrows use SPL tokens. Multiple token types would require multiple mints, which is covered by the program design but not tested here.
// EVM: evm-intent-framework/test/integration.test.js - "Should handle multiple different ERC20 tokens"

/// Test: Comprehensive Event Emission
/// Verifies that all events are emitted with correct parameters.
/// Why: Events are critical for off-chain monitoring and indexing. Incorrect events break integrations.
///
/// NOTE: N/A for SVM - Solana programs use program logs (msg!) instead of events. Log verification is covered in individual test files.
// EVM: evm-intent-framework/test/integration.test.js - "Should emit all events with correct parameters"

/// Test: Complete Cancellation Workflow
/// Verifies the full workflow from escrow creation through cancellation after expiry.
/// Why: Integration test ensures the cancellation flow works end-to-end after expiry.
#[tokio::test]
async fn test_complete_full_cancellation_workflow() {
    let program_test = program_test();
    let mut context = program_test.start_with_context().await;
    let env = setup_basic_env(&mut context).await;

    let intent_id = generate_intent_id();
    let amount = 1_000_000u64;

    let (escrow_pda, _) =
        Pubkey::find_program_address(&[seeds::ESCROW_SEED, &intent_id], &env.program_id);
    let (vault_pda, _) =
        Pubkey::find_program_address(&[seeds::VAULT_SEED, &intent_id], &env.program_id);

    let initial_requester_balance = get_token_balance(&mut context, env.requester_token).await;

    // Step 1: Create escrow with short expiry
    let create_ix = create_escrow_ix(
        env.program_id,
        intent_id,
        amount,
        env.requester.pubkey(),
        env.mint,
        env.requester_token,
        env.solver.pubkey(),
        Some(1), // 1 second expiry
    );

    let blockhash = context.banks_client.get_latest_blockhash().await.unwrap();
    let create_tx = Transaction::new_signed_with_payer(
        &[create_ix],
        Some(&env.requester.pubkey()),
        &[&env.requester],
        blockhash,
    );
    context.banks_client.process_transaction(create_tx).await.unwrap();

    // Step 2: Advance time past expiry
    let escrow_account = context
        .banks_client
        .get_account(escrow_pda)
        .await
        .unwrap()
        .unwrap();
    let escrow = read_escrow(&escrow_account);
    let clock_account = context
        .banks_client
        .get_account(sysvar::clock::id())
        .await
        .unwrap()
        .unwrap();
    let mut clock: Clock = deserialize(&clock_account.data).unwrap();
    clock.unix_timestamp = escrow.expiry + 1;
    context.set_sysvar(&clock);

    // Step 3: Cancel and reclaim
    let cancel_ix = create_cancel_ix(
        env.program_id,
        intent_id,
        env.requester.pubkey(),
        env.requester_token,
        escrow_pda,
        vault_pda,
    );

    let blockhash = context.banks_client.get_latest_blockhash().await.unwrap();
    let cancel_tx = Transaction::new_signed_with_payer(
        &[cancel_ix],
        Some(&env.requester.pubkey()),
        &[&env.requester],
        blockhash,
    );
    context.banks_client.process_transaction(cancel_tx).await.unwrap();

    // Step 4: Verify final state
    let final_requester_balance = get_token_balance(&mut context, env.requester_token).await;
    assert_eq!(final_requester_balance, initial_requester_balance);

    let vault_balance = get_token_balance(&mut context, vault_pda).await;
    assert_eq!(vault_balance, 0);
}
