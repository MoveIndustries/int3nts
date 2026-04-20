# Plan: Resilience Hardening

## Progress

| # | Stage                                           | Status  |
| - | ----------------------------------------------- | ------- |
| 1 | Inflow retry with explicit terminal state       | Pending |
| 2 | Cross-chain state reconciliation loop           | Pending |
| 3 | Orphaned escrow cleanup (MVM/EVM/SVM)           | Pending |
| 4 | E2E partial-failure tests                       | Pending |

## Goal

Harden failure handling across the int3nts system for MVM, EVM, and SVM. Today, the solver has outflow retry/backoff but no inflow retry, no cross-chain reconciliation, and no orphaned-escrow cleanup. Intents can end up in silent-stuck states (e.g., hub locked + connected chain released, or escrow past expiry with no cleanup) that violate the project's **No Fallbacks Policy** — they neither succeed nor fail loudly.

Cross-solver double-fulfillment is **out of scope**: cross-chain inflow/outflow intents must be reserved to a specific solver address on creation (enforced by `E_INVALID_SIGNATURE` in [fa_intent_inflow.move:228-232](../../../intent-frameworks/mvm/intent-hub/sources/fa_intent_inflow.move#L228-L232) and [fa_intent_outflow.move:380-384](../../../intent-frameworks/mvm/intent-hub/sources/fa_intent_outflow.move#L380-L384), and equivalents on EVM/SVM). On-chain `ensure_solver_authorized` / `E_UNAUTHORIZED_SOLVER` guarantees that only the reserved solver can fulfill, so competing solvers on different EC2 instances cannot race at fulfillment time — they compete at quote time at the coordinator, which is a separate concern from this plan.

This plan adds:

- Explicit retry + terminal `Failed` transitions for inflow (mirroring existing outflow pattern in [solver/src/service/tracker.rs:24-28](../../../solver/src/service/tracker.rs#L24-L28)).
- A reconciliation loop that periodically compares tracker state to on-chain state across hub + connected chain and surfaces mismatches as explicit errors (not silent fixes).
- On-chain cancel triggers for escrows past `expiry + grace_period` on all three chains, with off-chain bookkeeping that marks cleaned intents.
- E2E tests that drop GMP messages and exhaust escrow expiry to verify the above.

**No-Fallbacks compliance**: every retry has a max attempt count and terminal `Failed` state; every reconciliation mismatch emits an explicit error; no silent recoveries.

## Stage Protocol (follow for EVERY stage)

Every stage MUST end with a review step and a commit step — no exceptions.

1. Run the relevant test command listed in the stage.
2. **Review step (required)**: run `/review-me` and wait for the review output. Address any blocking feedback before proceeding.
3. **Ask the user: "Ready to commit?"**
4. **Commit step (required)**: only if the user says yes, run `/commit`.
5. Do not proceed to the next stage until both the review and commit steps have completed.

---

## Stage 1 — Inflow retry with explicit terminal state

### Purpose of Stage 1

**What**: Bring inflow fulfillment up to parity with outflow by adding bounded retries with exponential backoff and an explicit `Failed` terminal state.

**Why**: Today, [solver/src/service/inflow.rs](../../../solver/src/service/inflow.rs) has no retry — if a transient RPC error or GMP delivery delay causes a fulfillment attempt to fail, the service moves on and relies on the next poll cycle to eventually succeed. That means transient failures are invisible, and permanent failures never reach a terminal state. Outflow already solved this ([solver/src/service/tracker.rs:24-28](../../../solver/src/service/tracker.rs#L24-L28)); inflow should follow the same pattern so both fulfillment paths either succeed, retry with backoff, or fail loudly after a bounded number of attempts (No Fallbacks Policy).

### Scope

[solver/](../../../solver/) only. No chain contracts, no integrated-gmp, no coordinator.

### Files to change

- [solver/src/service/tracker.rs](../../../solver/src/service/tracker.rs)
  - Add `MAX_INFLOW_RETRIES: u32 = 3` constant next to existing `MAX_OUTFLOW_RETRIES`.
  - Extend `TrackedIntent` with `inflow_attempt_count: u32` and `next_inflow_retry_after: u64` (mirror existing outflow fields on [lines 66-69](../../../solver/src/service/tracker.rs#L66-L69)).
  - Add `record_inflow_failure(draft_id)` method mirroring `record_outflow_failure`.
  - Transition to `IntentState::Failed` when `inflow_attempt_count >= MAX_INFLOW_RETRIES`.
- [solver/src/service/inflow.rs](../../../solver/src/service/inflow.rs)
  - Skip intents whose `next_inflow_retry_after > now` (mirror outflow polling check).
  - On fulfillment error, call `record_inflow_failure` rather than moving on silently.
- [solver/tests/tracker_tests.rs](../../../solver/tests/tracker_tests.rs)
  - Add `test_record_inflow_failure_increments_count_and_sets_backoff`.
  - Add `test_inflow_failure_backoff_increases_exponentially`.
  - Add `test_inflow_exhausted_retries_transition_to_failed`.

### Test command

```bash
RUST_LOG=off nix develop ./nix -c bash -c "cd solver && cargo test --quiet"
```

### End of Stage 1 (required)

1. Run the test command above and confirm it passes.
2. **Review**: run `/review-me` and resolve any blocking feedback.
3. Ask the user: "Ready to commit?"
4. **Commit**: if yes, run `/commit`.
5. Do not start Stage 2 until both review and commit are complete.

---

## Stage 2 — Cross-chain state reconciliation loop

### Purpose of Stage 2

**What**: Add a periodic loop that compares each tracked intent's solver-side state against the actual on-chain state on both the hub and the connected chain, and emits an explicit error for every mismatch. Observation only — no repair attempts in this stage.

**Why**: An intent's lifecycle spans two chains plus a GMP relay. If the relay drops a message, a chain RPC flakes, or the solver restarts, the solver's in-memory tracker can diverge from reality — e.g., hub still locked but connected chain has already released, or tracker thinks fulfilled but hub disagrees. Today nothing detects this, so intents silently get stuck. A read-only reconciliation loop is the minimum viable observability layer, and its mismatch signals are what Stage 3 uses to decide what to clean up. Splitting observation (Stage 2) from action (Stage 3) keeps repair logic testable against known mismatch inputs.

### Scope

New module in [solver/src/service/](../../../solver/src/service/). Read-only across MVM/EVM/SVM via existing `chain-clients` — no new on-chain code.

### Files to change

- `solver/src/service/reconciliation.rs` (new)
  - `ReconciliationService` with `run_once()` that iterates all tracked intents and, for each, queries hub state + connected-chain escrow state via existing shared clients ([chain-clients/mvm](../../../chain-clients/mvm/), [chain-clients/evm](../../../chain-clients/evm/), [chain-clients/svm](../../../chain-clients/svm/)).
  - Detects mismatches:
    - `HubLockedButConnectedReleased` — fulfillment proof lost in GMP.
    - `HubFulfilledButConnectedNotReleased` — inflow auto-release failed.
    - `TrackerClaimsFulfilledButHubDoesNotAgree` — tracker cache stale.
  - Emits each mismatch as an explicit `anyhow::Error` with chain, intent_id, and mismatch type. **Does not attempt repair** — this stage is observation only; Stage 4 handles cleanup.
  - Logs a structured line per mismatch at `error` level.
- [solver/src/service/mod.rs](../../../solver/src/service/mod.rs) — expose new module.
- [solver/src/main.rs](../../../solver/src/main.rs) — spawn reconciliation loop every `RECONCILE_INTERVAL_SECS = 60`.
- `solver/tests/reconciliation_tests.rs` (new)
  - Use existing chain-client test doubles (see [chain-clients/svm/tests/](../../../chain-clients/svm/tests/) for patterns).
  - `test_detects_hub_locked_but_connected_released`
  - `test_detects_hub_fulfilled_but_connected_not_released`
  - `test_no_mismatch_on_healthy_intent`
  - `test_emits_explicit_error_per_mismatch` (verify it errors, does not silently fix).

### Test command

```bash
RUST_LOG=off nix develop ./nix -c bash -c "cd solver && cargo test --quiet"
```

### End of Stage 2 (required)

1. Run the test command above and confirm it passes.
2. **Review**: run `/review-me` and resolve any blocking feedback.
3. Ask the user: "Ready to commit?"
4. **Commit**: if yes, run `/commit`.
5. Do not start Stage 3 until both review and commit are complete.

---

## Stage 3 — Orphaned escrow cleanup (MVM / EVM / SVM)

### Purpose of Stage 3

**What**: Add a sweep loop in the solver that, for each intent past `expiry + grace_period` with escrow still locked on the connected chain, calls the chain's existing `cancel_escrow` / `cancel()` / `Cancel` entry point to refund the requester. Track outcome via new `IntentState::Cleaned` and `IntentState::CleanupFailed` terminal states.

**Why**: Today if fulfillment never completes (GMP dropped, solver died, chain paused), the on-chain escrow sits locked until someone manually calls cancel. That's poor UX for requesters and leaves funds hanging. The on-chain cancel entry points already exist on all three chains — this stage just adds an automated caller on the solver side, with explicit bookkeeping so we can tell the difference between "intent was cleaned" and "cleanup itself failed." Covers both halves of "orphaned escrow cleanup": on-chain recovery (actual cancel tx) and off-chain bookkeeping (tracker state transition).

### Scope

Solver + all three connected chain frameworks. Uses existing on-chain `cancel_escrow` / `cancel` / `Cancel` entry points — no new on-chain code, only new caller logic + tracker bookkeeping.

Existing cancel entry points:

- MVM: `cancel_escrow` in [intent-frameworks/mvm/intent-connected/sources/gmp/intent_inflow_escrow.move](../../../intent-frameworks/mvm/intent-connected/sources/gmp/intent_inflow_escrow.move)
- EVM: `cancel()` in [intent-frameworks/evm/contracts/IntentInflowEscrow.sol](../../../intent-frameworks/evm/contracts/IntentInflowEscrow.sol)
- SVM: `Cancel` instruction in [intent-frameworks/svm/programs/intent_inflow_escrow/src/processor.rs](../../../intent-frameworks/svm/programs/intent_inflow_escrow/src/processor.rs)

### Files to change

- `solver/src/service/escrow_cleanup.rs` (new)
  - `EscrowCleanupService::sweep_once()` — for each tracked intent with `state == Expired` and `now > expiry_time + GRACE_PERIOD_SECS (900)`:
    - Query on-chain: is escrow still locked? If not, mark tracker as `Cleaned` and move on.
    - If still locked: call chain-specific `cancel` via the shared client (dispatch on `connected_chain_type`).
    - On success: transition tracker to new `IntentState::Cleaned`.
    - On failure: increment a per-intent `cleanup_attempt_count` (cap at 3), then transition to `IntentState::CleanupFailed` — explicit terminal state, not a silent swallow.
- [chain-clients/mvm/src/](../../../chain-clients/mvm/src/), [chain-clients/evm/src/](../../../chain-clients/evm/src/), [chain-clients/svm/src/](../../../chain-clients/svm/src/)
  - Add `cancel_expired_escrow(intent_id)` method to the shared client on each chain. Thin wrapper around existing CLI calls / SDK calls.
- [solver/src/service/tracker.rs](../../../solver/src/service/tracker.rs)
  - Add `IntentState::Cleaned` and `IntentState::CleanupFailed` variants. Update pattern-match sites.
  - Add `cleanup_attempt_count: u32` to `TrackedIntent`.
- [solver/src/main.rs](../../../solver/src/main.rs) — spawn sweep loop every `CLEANUP_INTERVAL_SECS = 300`.
- `solver/tests/escrow_cleanup_tests.rs` (new) — one test per chain for: expired escrow is cancelled; still-valid escrow is skipped; cleanup failure transitions to `CleanupFailed` after 3 attempts.
- Chain-client tests: per-chain unit tests for `cancel_expired_escrow` under [chain-clients/{mvm,evm,svm}/tests/](../../../chain-clients/).

### Test command

```bash
RUST_LOG=off nix develop ./nix -c bash -c "cd solver && cargo test --quiet" && \
nix develop ./nix -c bash -c "./chain-clients/scripts/test.sh"
```

### End of Stage 3 (required)

1. Run the test command above and confirm it passes.
2. **Review**: run `/review-me` and resolve any blocking feedback.
3. Ask the user: "Ready to commit?"
4. **Commit**: if yes, run `/commit`.
5. Do not start Stage 4 until both review and commit are complete.

---

## Stage 4 — E2E partial-failure tests

### Purpose of Stage 4

**What**: Add end-to-end tests that deliberately break the happy path (kill the GMP relay mid-flow, create a short-expiry escrow) and assert the system recovers through the mechanisms built in Stages 1–3.

**Why**: Unit tests in earlier stages prove each primitive (retry, reconciliation, cleanup) works in isolation — but partial-failure behavior is emergent across services. E2E coverage is the only way to verify the pieces actually compose correctly under real failure conditions. Running the same scenarios on MVM, EVM, and SVM also confirms the behavior is chain-uniform, not just MVM-flavored. Without these, we'd be shipping the hardening work untested as a system.

### Scope

[testing-infra/ci-e2e/](../../../testing-infra/ci-e2e/) — add partial-failure scenarios on top of existing inflow/outflow test harnesses.

### Files to change

- `testing-infra/ci-e2e/e2e-tests-mvm/partial-failure/` (new directory)
  - `test-gmp-delivery-drop.sh` — start the full stack, drop the GMP relay mid-flight (kill integrated-gmp process after hub lock, before connected release), then assert reconciliation loop reports `HubLockedButConnectedReleased` within a bounded wait, and escrow cleanup eventually cancels.
  - `test-expired-escrow-auto-cleanup.sh` — create an escrow with short expiry, wait past grace period, assert cleanup service cancels it and transitions tracker to `Cleaned`.
- Repeat equivalents under `e2e-tests-evm/partial-failure/` and `e2e-tests-svm/partial-failure/`.
- Root scripts don't need changes — these are run standalone per the existing pattern.

### Test command

```bash
nix develop ./nix -c bash -c "./testing-infra/ci-e2e/e2e-tests-mvm/partial-failure/test-gmp-delivery-drop.sh" && \
nix develop ./nix -c bash -c "./testing-infra/ci-e2e/e2e-tests-mvm/partial-failure/test-expired-escrow-auto-cleanup.sh" && \
nix develop ./nix -c bash -c "./testing-infra/ci-e2e/e2e-tests-evm/partial-failure/test-gmp-delivery-drop.sh" && \
nix develop ./nix -c bash -c "./testing-infra/ci-e2e/e2e-tests-evm/partial-failure/test-expired-escrow-auto-cleanup.sh" && \
nix develop ./nix -c bash -c "./testing-infra/ci-e2e/e2e-tests-svm/partial-failure/test-gmp-delivery-drop.sh" && \
nix develop ./nix -c bash -c "./testing-infra/ci-e2e/e2e-tests-svm/partial-failure/test-expired-escrow-auto-cleanup.sh"
```

### End of Stage 4 (required)

1. Run all test commands above and confirm they pass.
2. **Review**: run `/review-me` and resolve any blocking feedback.
3. Ask the user: "Ready to commit?"
4. **Commit**: if yes, run `/commit`.
5. This is the final stage — once committed, mark all stages complete in the progress table.
