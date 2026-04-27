# Plan 1 — MVM Programmable Intents (Framework Extensions)

Parent branch: `feat/mvm-programmable-intents`. Sub-branch PRs into the parent.

## Goal

Deliver the MVM framework changes that let an int3nts intent be fulfilled by an arbitrary Move script — for both inflow and outflow on the hub side. MVM only.

The Move-side hot-potato pattern needed for atomic in-script handoff already exists in the framework as `Session<Args>` ([intent.move:47-52](../../../../intent-frameworks/mvm/intent-hub/sources/intent.move#L47-L52)) and the `start_*` / `finish_*` pair around it is already `public`. This plan does not introduce a new hot-potato type; it adds the Rust solver code path that submits Move script payloads and the small public Move wrappers a script needs in order to drive the existing sequence end-to-end. See [plan-1-research.md](plan-1-research.md) for the audit details.

## Deliverables

Each deliverable below is a separate commit. Unit tests are created alongside the implementation they cover and land in the same commit.

1. **Audit doc — [plan-1-research.md](plan-1-research.md).** First commit on the sub-branch. A short design doc covering:

    - Solver-side fulfillment path today: how the Rust solver submits the fulfillment transaction on M1 (current `aptos move run --function-id` CLI call), and the insertion point for a raw-tx API that accepts Move script payloads.
    - Move-side inflow receiver today: whether the escrow-to-fulfillment coupling is entry-function-only or already admits a script-shaped payload, and what outcome validation (balance deltas, object invariants) the receiver must perform.
    - Move-side outflow escrow today: the current release/authority model for user-locked objects, and the distance from the hot-potato pattern required for an atomic in-script handoff.

    Run `/review-me`, then `/commit`.

2. **Inflow implementation.** Two changes. (i) Rust: add a script-payload submission path in `solver/src/chains/hub.rs::fulfill_inflow_intent`, parallel to the existing `--function-id` CLI path. (ii) Move: add a public `script_complete` wrapper in `fa_intent_inflow` that bundles `intent_registry::unregister_intent` + `intent_gmp_hub::send_fulfillment_proof` + `gmp_intent_state::remove_intent` (the wrapper exists because `unregister_intent` is friend-only). Script flow: assert `is_escrow_confirmed` → `start_fa_offering_session` → script work → `finish_fa_receiving_session_with_event` → `script_complete`. Ships with unit tests covering the Rust submission path and the new Move wrapper.

    Run `/review-me`, then `/commit`.

3. **Outflow implementation.** Two changes. (i) Rust: add a script-payload submission path in `solver/src/chains/hub.rs::fulfill_outflow_intent`, parallel to the existing `--function-id` CLI path. (ii) Move: add a public `script_complete` wrapper in `fa_intent_outflow` that emits `LimitOrderFulfillmentEvent` + runs `intent_registry::unregister_intent` + `gmp_intent_state::remove_intent` (the wrapper exists because the event struct cannot be constructed outside the defining module *and* `unregister_intent` is friend-only). Script flow: assert `is_fulfillment_proof_received` → `start_fa_offering_session` → script work (unstake / unwind / swap) → `finish_fa_receiving_session_for_gmp` → `script_complete`. The hub-side hot-potato enforces "session can't leave the tx"; the delivered-amount and recipient post-condition is enforced on the connected chain by the validation contract before the GMP FulfillmentProof is sent back, so no new hub-side post-condition check is added. **Assumption:** the user-locked object on the hub outflow escrow is a fungible asset (the existing `FungibleStoreManager` path holds FA only). If the mainnet-contract research finds that the [Mosaic](https://docs.mosaic.ag) farm receipt is a non-FA Move object, a follow-up step 5 adds a generic-object outflow escrow path. Ships with unit tests covering the Rust submission path and the new Move wrapper. Review again based on the results from the previous steps.

    Run `/review-me`, then `/commit`.

4. **Abstract E2E round-trip.** New CI script `testing-infra/ci-e2e/e2e-tests-mvm/run-tests-programmable-roundtrip.sh` exercising the full programmable inflow + outflow round-trip on hub + MVM connected chain in one test. Inflow leg: user locks tokens in connected-chain MVM escrow; solver submits a Move script payload that drives `start_fa_offering_session` → abstract swap/LP/farm work → `finish_fa_receiving_session_with_event` → `script_complete`; GMP releases to solver on connected chain. Outflow leg: user locks a receipt-shaped object in the hub outflow escrow; solver's exit script drives `start_fa_offering_session` → abstract unwind steps → `finish_fa_receiving_session_for_gmp` → `script_complete`; the connected-chain validation contract has already enforced the delivered-amount post-condition; the existing GMP FulfillmentProof flow settles. Helper submit scripts (`inflow-submit-hub-intent-programmable.sh`, `outflow-submit-hub-intent-programmable.sh`) live alongside the existing classic helpers in the same directory. Fixtures describe entry-function shapes (swap/LP/farm) in the abstract — no protocol-specific naming at this layer. The shapes live in a new test-only Move package `intent-frameworks/mvm/test-shapes/` with stub modules (`test_swap`, `test_lp`, `test_farm` or similar) that publish public entry functions matching the swap / add_liquidity / remove_liquidity / stake / unstake shapes. The package is deployed on the hub during E2E setup. Classic `run-tests-inflow.sh` and `run-tests-outflow.sh` remain unchanged; EVM and SVM E2E suites remain unchanged. Review again based on the results from the previous steps.

    Run `/review-me`, then `/commit`.

## Scope

- MVM only.
- Framework-level code: solver + Move-side receivers + outflow escrow.
- Unit tests co-located with implementation; abstract integration tests as a separate final step.

## Non-goals

- Any EVM or SVM code changes.
- Integration against a real destination-chain protocol (that is plan 2).
- Frontend (that is plan 3).
- Mainnet-contract research. Initiated manually outside this plan; prerequisite for plan 2.

## Dependencies

None. This is the first sub-branch and starts immediately after the parent branch lands on remote.

## Progress tracking

Tracked in this sub-branch's PR body.
