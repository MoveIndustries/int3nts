// Programmable outflow fulfillment script.
//
// Drives the S.1-S.5 sequence (see docs/programmable-fulfillment.md):
//   S.1 assert fulfillment proof received
//   S.2 fa_intent_with_oracle::start_fa_offering_session
//   S.3 arbitrary work on the unlocked FA — routes through dummy-protocol
//       stubs (unstake -> remove_liquidity -> swap -> add_liquidity)
//   S.4 fa_intent_with_oracle::finish_fa_receiving_session_for_gmp
//       (placeholder zero payment; real value delivery happened on the
//       connected chain)
//   S.5 fa_intent_outflow::script_complete (emit event + unregister + GMP cleanup)
//
// The S.3 stub calls re-merge the same FA back together — they exist so
// the framework path through arbitrary Move code is exercised, not
// because the test demonstrates a real unwind.
//
// Args (runtime, per A2):
//   solver       : signer (implicit, tx sender)
//   intent_addr  : address  // intent object address
//   intent_id    : address  // cross-chain intent id (used as identifier)
script {
    use std::signer;
    use std::bcs;
    use aptos_framework::object;
    use aptos_framework::primary_fungible_store;
    use aptos_framework::fungible_asset::{Self as fungible_asset};
    use mvmt_intent::fa_intent_with_oracle::{Self, FungibleStoreManager, OracleGuardedLimitOrder};
    use mvmt_intent::fa_intent_outflow;
    use mvmt_intent::intent::Intent;
    use mvmt_intent::gmp_intent_state;
    use dummy_protocols::dummy_swap;
    use dummy_protocols::dummy_lp;
    use dummy_protocols::dummy_farm;

    fun outflow_programmable(
        solver: &signer,
        intent_addr: address,
        intent_id: address,
    ) {
        let intent_id_bytes = bcs::to_bytes(&intent_id);

        // S.1 — pre-check
        assert!(gmp_intent_state::is_fulfillment_proof_received(intent_id_bytes), 1);

        // S.2 — open session
        let intent_obj =
            object::address_to_object<Intent<FungibleStoreManager, OracleGuardedLimitOrder>>(
                intent_addr
            );
        let solver_addr = signer::address_of(solver);
        let (unlocked_fa, session) =
            fa_intent_with_oracle::start_fa_offering_session(solver, intent_obj);

        // Capture metadata + amount before the FA is consumed
        let provided_metadata = fungible_asset::metadata_from_asset(&unlocked_fa);
        let provided_amount = fungible_asset::amount(&unlocked_fa);
        let payment_metadata = fungible_asset::asset_metadata(&unlocked_fa);

        // S.3 — route the unlocked FA through the dummy-protocol stubs
        let unlocked_fa = dummy_farm::unstake(unlocked_fa);
        let (a, b) = dummy_lp::remove_liquidity(unlocked_fa);
        let a = dummy_swap::swap(a);
        let unlocked_fa = dummy_lp::add_liquidity(a, b);

        // Solver claims the unlocked tokens (their reward)
        primary_fungible_store::deposit(solver_addr, unlocked_fa);

        // S.4 — close session with placeholder zero payment
        let solver_payment =
            primary_fungible_store::withdraw(solver, payment_metadata, 0);
        fa_intent_with_oracle::finish_fa_receiving_session_for_gmp(
            session, solver_payment
        );

        // S.5 — emit fulfillment event + cleanup
        fa_intent_outflow::script_complete(
            solver, intent_addr, intent_id, provided_metadata, provided_amount
        );
    }
}
