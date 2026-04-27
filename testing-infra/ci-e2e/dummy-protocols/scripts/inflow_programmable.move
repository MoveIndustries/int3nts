// Programmable inflow fulfillment script.
//
// Drives the S.1-S.5 sequence (see docs/programmable-fulfillment.md):
//   S.1 assert escrow confirmed (cross-chain only)
//   S.2 fa_intent::start_fa_offering_session
//   S.3 arbitrary work — routes payment through dummy-protocol stubs
//   S.4 fa_intent::finish_fa_receiving_session_with_event
//   S.5 fa_intent_inflow::script_complete (unregister + GMP cleanup)
//
// The S.3 stub calls (dummy_swap::swap, dummy_farm::stake/unstake) are no-op
// passthroughs: they exist so the framework path through arbitrary Move
// code is exercised, not because the test demonstrates a real swap.
//
// Args (runtime, per A2):
//   solver           : signer (implicit, tx sender)
//   intent_addr      : address  // intent object address
//   intent_id_bytes  : vector<u8>  // BCS-encoded intent id; empty for same-chain
//   payment_amount   : u64
script {
    use std::signer;
    use std::vector;
    use aptos_framework::object;
    use aptos_framework::primary_fungible_store;
    use mvmt_intent::fa_intent::{Self, FungibleStoreManager, FALimitOrder};
    use mvmt_intent::fa_intent_inflow;
    use mvmt_intent::intent::{Self as intent, Intent};
    use mvmt_intent::gmp_intent_state;
    use dummy_protocols::dummy_swap;
    use dummy_protocols::dummy_farm;

    fun inflow_programmable(
        solver: &signer,
        intent_addr: address,
        intent_id_bytes: vector<u8>,
        payment_amount: u64,
    ) {
        // S.1 — cross-chain pre-check
        if (!vector::is_empty(&intent_id_bytes)) {
            assert!(gmp_intent_state::is_escrow_confirmed(intent_id_bytes), 1);
        };

        // S.2 — open session
        let intent_obj =
            object::address_to_object<Intent<FungibleStoreManager, FALimitOrder>>(
                intent_addr
            );
        let solver_addr = signer::address_of(solver);
        let (unlocked_fa, session) =
            fa_intent::start_fa_offering_session(solver, intent_obj);

        // Inflow unlocks 0 tokens — deposit back to solver to consume the FA
        primary_fungible_store::deposit(solver_addr, unlocked_fa);

        // Read desired metadata from the session argument so we know what
        // FA the solver must construct as payment
        let argument = intent::get_argument(&session);
        let desired_metadata = fa_intent::get_desired_metadata(argument);

        // S.3 — withdraw payment and route through the dummy-protocol stubs
        let payment_fa =
            primary_fungible_store::withdraw(solver, desired_metadata, payment_amount);
        let payment_fa = dummy_swap::swap(payment_fa);
        let payment_fa = dummy_farm::stake(payment_fa);
        let payment_fa = dummy_farm::unstake(payment_fa);

        // S.4 — close session
        fa_intent::finish_fa_receiving_session_with_event(
            session, payment_fa, intent_addr, solver_addr
        );

        // S.5 — unregister + GMP cleanup
        fa_intent_inflow::script_complete(
            solver, intent_addr, intent_id_bytes, payment_amount
        );
    }
}
