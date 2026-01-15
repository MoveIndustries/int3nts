mod common;

use common::{initialize_program, program_test, read_state};
use solana_sdk::signature::{Keypair, Signer};

// ============================================================================
// VERIFIER INITIALIZATION TESTS
// ============================================================================

/// Test: Verifier Address Initialization
/// Verifies that the escrow is initialized with the correct verifier address.
/// Why: The verifier address is critical for signature validation.
#[tokio::test]
async fn test_initialize_verifier_address() {
    let program_test = program_test();
    let mut context = program_test.start_with_context().await;
    let payer = context.payer.insecure_clone();
    let verifier = Keypair::new();

    let state_pda = initialize_program(
        &mut context,
        &payer,
        intent_escrow::id(),
        verifier.pubkey(),
    )
    .await;

    let state_account = context
        .banks_client
        .get_account(state_pda)
        .await
        .unwrap()
        .unwrap();
    let state = read_state(&state_account);
    assert_eq!(state.verifier, verifier.pubkey());
}
