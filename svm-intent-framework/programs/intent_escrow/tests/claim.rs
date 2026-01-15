mod common;

use common::{
    create_claim_ix, create_escrow_ix, get_token_balance, program_test, read_escrow,
    setup_basic_env,
};
use intent_escrow::state::seeds;
use solana_sdk::{
    pubkey::Pubkey,
    signature::Signer,
    transaction::Transaction,
};
use solana_sdk::ed25519_instruction::new_ed25519_instruction_with_signature;

// ============================================================================
// CLAIM TESTS
// ============================================================================

/// Test: Valid Claim with Verifier Signature
/// Verifies that solvers can claim escrow funds when provided with a valid verifier signature.
/// Why: Claiming is the core fulfillment mechanism.
#[tokio::test]
async fn test_claim_with_valid_verifier_signature() {
    let program_test = program_test();
    let mut context = program_test.start_with_context().await;
    let env = setup_basic_env(&mut context).await;

    let intent_id = [2u8; 32];
    let amount = 500_000u64;

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

    let (escrow_pda, _) =
        Pubkey::find_program_address(&[seeds::ESCROW_SEED, &intent_id], &env.program_id);
    let (vault_pda, _) =
        Pubkey::find_program_address(&[seeds::VAULT_SEED, &intent_id], &env.program_id);

    let signature = env.verifier.sign_message(&intent_id);
    let mut signature_bytes = [0u8; 64];
    signature_bytes.copy_from_slice(signature.as_ref());
    let ed25519_ix = new_ed25519_instruction_with_signature(
        &intent_id,
        &signature_bytes,
        &env.verifier.pubkey().to_bytes(),
    );

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

    let vault_balance = get_token_balance(&mut context, vault_pda).await;
    let solver_balance = get_token_balance(&mut context, env.solver_token).await;
    assert_eq!(vault_balance, 0);
    assert_eq!(solver_balance, amount);

    let escrow_account = context
        .banks_client
        .get_account(escrow_pda)
        .await
        .unwrap()
        .unwrap();
    let escrow = read_escrow(&escrow_account);
    assert!(escrow.is_claimed);
    assert_eq!(escrow.amount, 0);
}
