# Plan: Router Flow Implementation

Implement the router flow (connected chain → connected chain) end-to-end. The router flow composes the inflow escrow pattern (source side) with the outflow validator pattern (destination side), coordinated by a new hub-side intent type that fans out IntentRequirements to both connected chains via GMP.

References:

- [conception_routerflow.md](../conception/conception_routerflow.md) — conceptual design, protocol sequence, scenarios
- [architecture-diff.md](../conception/architecture-diff.md) — current implementation gap and planned diagram

## Progress

- [ ] Phase 0 — Design freeze
- [ ] Phase 1 — Hub intent module (MVM)
- [ ] Phase 2 — GMP + chain-clients wiring
- [ ] Phase 3 — Coordinator
- [ ] Phase 4 — Solver
- [ ] Phase 5 — SDK and frontend
- [ ] Phase 6 — E2E, same-framework

As each phase completes, tick the box above and fill in the `Done` sub-section of that phase with exactly what landed (files touched, tests added, PR link).

## Guiding principles

- **Reuse existing primitives.** The connected-chain escrow ([intent_inflow_escrow](../../../intent-frameworks/mvm/intent-connected/sources/gmp/intent_inflow_escrow.move), [IntentInflowEscrow.sol](../../../intent-frameworks/evm/contracts/IntentInflowEscrow.sol), [intent_inflow_escrow](../../../intent-frameworks/svm/programs/intent_inflow_escrow/)) and the outflow validator ([intent_outflow_validator](../../../intent-frameworks/mvm/intent-connected/sources/gmp/intent_outflow_validator.move), [IntentOutflowValidator.sol](../../../intent-frameworks/evm/contracts/IntentOutflowValidator.sol), [intent-outflow-endpoint-validator](../../../intent-frameworks/svm/programs/intent-outflow-endpoint-validator/)) already validate against GMP-delivered IntentRequirements. The router flow does not need new connected-chain contracts — only a new hub intent module and new service/client glue.
- **One flow at a time across layers.** Finish each layer (hub → GMP relay → coordinator → solver → SDK/frontend → E2E) before moving on, so each phase is shippable and testable in isolation.
- **Same-framework only.** Start with MVM→MVM (two connected MVM instances — already supported by the E2E harness), then EVM→EVM and SVM→SVM. Cross-framework is out of scope.
- **No fallbacks** (per project rules). Each new code path errors explicitly on missing state; router-specific assertions must be strict.

## End-of-phase protocol

At the end of **every** phase below:

1. Run `/review-me` to self-review the staged changes against project rules.
2. Run `/commit` to create the phase commit (or a small number of logical commits — still using `/commit`).
3. Tick the phase box in the **Progress** section above and fill in the `Done` sub-section of that phase.

This is repeated explicitly at the end of each phase as a reminder.

## Phase 0 — Design freeze (doc-only)

Deliverables:

- Update [architecture-diff.md](../conception/architecture-diff.md) to flip router status from "not yet implemented" to "in progress" once Phase 1 lands.
- Add one design doc under `docs/architecture/design/` covering:
  - Hub intent shape (`RouterIntent` struct, fields, lifecycle).
  - GMP message flow (reuse existing `IntentRequirements` / `EscrowConfirmation` / `FulfillmentProof` types; no new message types).
  - State transitions on hub: `Created → EscrowConfirmed → Fulfilled`. No hub-locked funds.
  - Collateral is explicitly out of scope (matches inflow/outflow status).

### Phase 0 — Done

_(fill in when complete: files added/edited, PR link)_

**At phase end: run `/review-me`, then `/commit`, then tick Phase 0 in Progress and fill this section.**

## Phase 1 — Hub intent module (MVM)

New file: `intent-frameworks/mvm/intent-hub/sources/fa_intent_router.move`.

- `create_router_intent(requester, offered_metadata_addr, offered_amount, offered_chain_id, desired_metadata_addr, desired_amount, desired_chain_id, expiry_time, intent_id, requester_addr_source, requester_addr_dest, solver, solver_addr_source, solver_addr_dest, solver_signature)`
  - Validates the draft signature against `solver_registry`.
  - Registers the intent via `intent_registry` and reserves via `intent_reservation`.
  - Emits `RouterLimitOrderEvent` (new event; parallels `LimitOrderEvent` / `OracleLimitOrderEvent`).
  - Sends two `IntentRequirements` GMP messages — one to `source_chain_id`, one to `desired_chain_id`.
- `receive_escrow_confirmation(...)` handler — marks the intent `EscrowConfirmed` when the source chain's escrow confirmation arrives.
- `receive_fulfillment_proof(...)` handler — on destination-chain proof receipt, sends a second `FulfillmentProof` GMP to the source chain so the existing inflow escrow auto-release path fires.
- Unit tests in `intent-frameworks/mvm/intent-hub/tests/fa_intent_router_tests.move` following `// N. Test / Verifies that / Why:` convention.

No changes to `intent_registry`, `intent_reservation`, `solver_registry`. No changes to connected-chain contracts.

### Phase 1 — Done

_(fill in when complete: files added/edited, tests added, PR link)_

**At phase end: run `/review-me`, then `/commit`, then tick Phase 1 in Progress and fill this section.**

## Phase 2 — GMP + chain-clients wiring

- Extend [integrated-gmp](../../../integrated-gmp/) to route the two IntentRequirements messages emitted by the new hub intent, and to handle the hub→source re-emit of `FulfillmentProof` after destination proof receipt.
  - Existing message encoders/decoders for `IntentRequirements`, `EscrowConfirmation`, `FulfillmentProof` are sufficient — no new wire formats.
- Extend chain-clients where needed (`chain-clients/{common,mvm,evm,svm}`) with query helpers a router intent needs (e.g. "fetch stored IntentRequirements on destination chain for a given `intent_id`"). Add only what Phase 3/4 actually calls.
- Tests: integration tests under `integrated-gmp/tests/` covering the new two-fanout + re-emit flow; extend chain-clients tests as surface grows.

### Phase 2 — Done

_(fill in when complete: files added/edited, tests added, PR link)_

**At phase end: run `/review-me`, then `/commit`, then tick Phase 2 in Progress and fill this section.**

## Phase 3 — Coordinator

- Add a router draft-intent type and route it through the existing FCFS path:
  - New request shape: `source_chain_id + dest_chain_id + offered + desired` (distinct from inflow/outflow, which have hub on one side).
  - Negotiation endpoint accepts it; solver signs; on signed draft, coordinator points the client at `fa_intent_router::create_router_intent`.
- Reconciliation / monitor: observe `RouterLimitOrderEvent` on hub, source-chain `EscrowCreated`, destination-chain `FulfillmentSucceeded`.
- Tests under `coordinator/tests/` — `negotiation_validation_tests.rs` and `monitor_tests.rs` get router variants.

### Phase 3 — Done

_(fill in when complete: files added/edited, tests added, PR link)_

**At phase end: run `/review-me`, then `/commit`, then tick Phase 3 in Progress and fill this section.**

## Phase 4 — Solver

- New solver path for router intents:
  - Observe `RouterLimitOrderEvent` on hub.
  - Observe escrow on source connected chain (reuses existing inflow client code).
  - Fulfill on destination connected chain via the existing outflow validator (reuses existing outflow client code).
  - No hub-side fulfillment call — the hub auto-forwards the destination proof to the source chain (Phase 1's `receive_fulfillment_proof` handler).
- Tests under `solver/tests/` — add a `router_tests.rs` covering acceptance, liquidity, reconciliation for the new flow. Existing patterns apply.

### Phase 4 — Done

_(fill in when complete: files added/edited, tests added, PR link)_

**At phase end: run `/review-me`, then `/commit`, then tick Phase 4 in Progress and fill this section.**

## Phase 5 — SDK and frontend

- SDK ([packages/sdk](../../../packages/sdk/)): add router draft builder, submission helpers, and status queries. Mirror the existing `intent-evm` / `intent-mvm` / `intent-svm` shape.
- Frontend ([frontend](../../../frontend/)): add a router flow screen with source + destination chain pickers. Only after the SDK is in place. Manually verify in-browser before marking the phase done (project rule).

### Phase 5 — Done

_(fill in when complete: files added/edited, tests added, PR link)_

**At phase end: run `/review-me`, then `/commit`, then tick Phase 5 in Progress and fill this section.**

## Phase 6 — E2E, same-framework

Pattern: leverage the existing harness, which already launches two connected-chain instances per framework ([e2e-common.sh](../../../testing-infra/ci-e2e/e2e-common.sh)).

- Add `testing-infra/ci-e2e/e2e-tests-mvm/run-tests-router.sh` (then EVM, then SVM) that:
  - Uses instance 2 as source and instance 3 as destination of the same framework.
  - Scripts the full sequence: draft → sign → hub router intent → source escrow → dest fulfillment → hub re-emit → source auto-release.
  - Asserts pre/post balances on both connected chains and state on hub.
- Add a Rust integration test mirroring the existing MVM rust-integration pattern ([coordinator-rust-integration-tests](../../../testing-infra/ci-e2e/e2e-tests-mvm/coordinator-rust-integration-tests/)).

### Phase 6 — Done

_(fill in when complete: files added/edited, tests added, PR link)_

**At phase end: run `/review-me`, then `/commit`, then tick Phase 6 in Progress and fill this section. Also flip [architecture-diff.md](../conception/architecture-diff.md) router status to Implemented.**

## Out of scope

- Cross-framework router scenarios (EVM→MVM, MVM→SVM, etc.). The contracts and services will support it by construction since the hub speaks GMP to any connected chain, but the E2E harness work to bring up mixed frameworks together is deferred.
- Solver collateral / slashing (unimplemented for inflow and outflow as well — shared future work).
- Router-specific negotiation improvements beyond FCFS.

## Sequencing and checkpoints

Each phase has an independent PR. Recommended merge gates:

1. Phase 1 PR — hub module + unit tests; docs updated; status flipped to "in progress".
2. Phase 2 PR — GMP relay + chain-client hooks; integration tests green.
3. Phase 3 PR — coordinator routing; unit + monitor tests green.
4. Phase 4 PR — solver path; unit tests green. End-to-end path now exists but not yet wired into E2E harness.
5. Phase 5 PR — SDK; frontend in a separate PR after SDK lands.
6. Phase 6 PR — same-framework E2E green in CI before merging.
