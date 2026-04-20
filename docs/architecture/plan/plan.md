# Plan: Resilience Hardening

## Progress

| # | Stage                                                      | Status  |
| - | ---------------------------------------------------------- | ------- |
| 1 | Solver inflow retry with explicit terminal state           | Pending |
| 2 | Solver cross-chain state reconciliation loop               | Pending |
| 3 | Solver-driven orphaned-escrow cleanup on MVM / EVM / SVM   | Pending |
| 4 | E2E partial-failure tests (solver + integrated-gmp + on-chain) | Pending |

## Goal

Harden failure handling across the int3nts system. The changes land in three components:

- **Solver** ([solver/](../../../solver/)) — adds inflow retry, a reconciliation loop, and an escrow-cleanup sweep.
- **Chain clients** ([chain-clients/mvm](../../../chain-clients/mvm/), [chain-clients/evm](../../../chain-clients/evm/), [chain-clients/svm](../../../chain-clients/svm/)) — gains a per-chain `cancel_expired_escrow` wrapper used by the solver's cleanup sweep.
- **Testing infra** ([testing-infra/ci-e2e/](../../../testing-infra/ci-e2e/)) — adds partial-failure E2E scripts that exercise the solver + integrated-gmp + on-chain stack.

No on-chain contract changes (MVM/EVM/SVM) and no changes to the coordinator or integrated-gmp services. All on-chain cancel entry points already exist.

Today, the solver has outflow retry/backoff but no inflow retry, no cross-chain reconciliation, and no orphaned-escrow cleanup. Intents can end up in silent-stuck states (e.g., hub locked on MVM + escrow released on connected chain, or a connected-chain escrow past expiry with no cleanup) that violate the project's **No Fallbacks Policy** — they neither succeed nor fail loudly.

Cross-solver double-fulfillment is **out of scope**: cross-chain inflow/outflow intents must be reserved to a specific solver address on creation (enforced by `E_INVALID_SIGNATURE` in [fa_intent_inflow.move:228-232](../../../intent-frameworks/mvm/intent-hub/sources/fa_intent_inflow.move#L228-L232) and [fa_intent_outflow.move:380-384](../../../intent-frameworks/mvm/intent-hub/sources/fa_intent_outflow.move#L380-L384), and equivalents on EVM/SVM). On-chain `ensure_solver_authorized` / `E_UNAUTHORIZED_SOLVER` guarantees that only the reserved solver can fulfill, so competing solver instances cannot race at fulfillment time — they compete at quote time at the coordinator, which is a separate concern from this plan.

**No-Fallbacks compliance**: every solver retry path has a max attempt count and terminal `Failed` state; every solver reconciliation mismatch emits an explicit error from the solver; no silent recoveries anywhere.

## Stage Protocol (follow for EVERY stage)

Every stage MUST end with a review step and a commit step — no exceptions.

1. Run the stage's listed test command.
2. **Review step (required)**: run `/review-me` and wait for the review output. Address any blocking feedback before proceeding.
3. **Ask the user: "Ready to commit?"**
4. **Commit step (required)**: only if the user says yes, run `/commit`.
5. Do not proceed to the next stage until both review and commit are complete.

---

## Stage 1 — Solver inflow retry with explicit terminal state

### Purpose of Stage 1

**What**: In the **solver service** (specifically [solver/src/service/inflow.rs](../../../solver/src/service/inflow.rs) and the in-memory tracker in [solver/src/service/tracker.rs](../../../solver/src/service/tracker.rs)), bring inflow fulfillment up to parity with outflow by adding bounded retries with exponential backoff and an explicit `IntentState::Failed` terminal state. No on-chain contracts, integrated-gmp, coordinator, or chain-clients code changes.

**Why**: Today the solver's inflow service has no retry — if a transient RPC error from the connected-chain node or a GMP delivery delay causes a solver inflow fulfillment attempt to fail, the solver moves on and relies on its next poll cycle to eventually succeed. Transient failures are invisible in solver logs; permanent failures never reach a terminal state in the solver tracker. The solver's outflow service already solved this ([solver/src/service/tracker.rs:24-28](../../../solver/src/service/tracker.rs#L24-L28) — `MAX_OUTFLOW_RETRIES`, `record_outflow_failure`); the solver's inflow service should follow the same pattern so both solver fulfillment paths either succeed, retry with backoff, or fail loudly after a bounded number of attempts (No Fallbacks Policy).

### Scope

[solver/](../../../solver/) only. No on-chain contracts, no integrated-gmp service, no coordinator service, no chain-clients crates.

### Files to change

- [solver/src/service/tracker.rs](../../../solver/src/service/tracker.rs) — the solver's in-memory `IntentTracker`
  - Add solver-side constant `MAX_INFLOW_RETRIES: u32 = 3` next to existing solver-side `MAX_OUTFLOW_RETRIES`.
  - Extend the solver's `TrackedIntent` struct with `inflow_attempt_count: u32` and `next_inflow_retry_after: u64` (mirror existing outflow fields on [lines 66-69](../../../solver/src/service/tracker.rs#L66-L69)).
  - Add solver-side method `record_inflow_failure(intent_id, error)` on `IntentTracker`, mirroring `record_outflow_failure`.
  - Transition the solver tracker's intent to `IntentState::Failed` when `inflow_attempt_count >= MAX_INFLOW_RETRIES`.
- [solver/src/service/inflow.rs](../../../solver/src/service/inflow.rs) — the solver's `InflowService` polling loop
  - In the solver inflow poll, skip intents whose `next_inflow_retry_after > now` (mirror the outflow polling check in the solver's `OutflowService`).
  - On a solver fulfillment error, call the solver tracker's `record_inflow_failure` rather than moving on silently.
- [solver/tests/tracker_tests.rs](../../../solver/tests/tracker_tests.rs) — solver unit tests
  - Add `test_record_inflow_failure_increments_count_and_sets_backoff`.
  - Add `test_inflow_failure_backoff_increases_exponentially`.
  - Add `test_inflow_exhausted_retries_transition_to_failed`.

### Test command

```bash
RUST_LOG=off nix develop ./nix -c bash -c "cd solver && cargo test --quiet"
```

### End of Stage 1 (required)

1. Run the test command above and confirm the solver unit tests pass.
2. **Review**: run `/review-me` and resolve any blocking feedback.
3. Ask the user: "Ready to commit?"
4. **Commit**: if yes, run `/commit`.
5. Do not start Stage 2 until both review and commit are complete.

---

## Stage 2 — Solver cross-chain state reconciliation loop

### Purpose of Stage 2

**What**: Add a new periodic loop **inside the solver service** (a new module `solver/src/service/reconciliation.rs`, spawned from the solver's [main.rs](../../../solver/src/main.rs)) that iterates every intent the solver's `IntentTracker` is tracking, and for each intent queries:

- The **hub chain** state (MVM intent state) via the solver's existing hub client.
- The **connected-chain escrow** state (MVM/EVM/SVM, depending on the intent) via the shared `chain-clients/{mvm,evm,svm}` crates the solver already uses.

It then compares those two on-chain readings against the solver's own in-memory tracker state and emits an explicit `anyhow::Error` + structured `tracing::error!` log line from the solver for every mismatch. **Observation only** — the solver does not attempt any repair in this stage. No on-chain contracts, integrated-gmp, coordinator, or chain-clients code changes; the solver uses the existing shared client methods read-only.

**Why**: An intent's lifecycle spans the MVM hub chain + one connected chain + the integrated-gmp relay. If integrated-gmp drops or delays a message, if a connected-chain RPC flakes, or if the solver process restarts, the solver's in-memory `IntentTracker` can diverge from on-chain reality — e.g., hub still locked on MVM but escrow has already been released on the connected chain, or the solver tracker thinks fulfilled but the MVM hub state disagrees. Today nothing in the solver detects this, so intents silently get stuck. A read-only reconciliation loop in the solver is the minimum viable observability layer, and its mismatch signals are what Stage 3's solver-driven escrow-cleanup sweep uses to decide what to clean up. Splitting observation (Stage 2, solver) from action (Stage 3, solver + chain-clients + on-chain cancel calls) keeps repair logic testable against known mismatch inputs.

### Scope

Solver only. New module in [solver/src/service/](../../../solver/src/service/). Read-only queries across MVM/EVM/SVM via the existing [chain-clients/](../../../chain-clients/) crates — no new on-chain contract code, no integrated-gmp changes, no coordinator changes.

### Files to change

- `solver/src/service/reconciliation.rs` (new)
  - Solver's `ReconciliationService` with `run_once()` that iterates all intents in the solver's `IntentTracker` and, for each, queries the MVM hub state + the connected-chain escrow state via the solver's existing shared clients ([chain-clients/mvm](../../../chain-clients/mvm/), [chain-clients/evm](../../../chain-clients/evm/), [chain-clients/svm](../../../chain-clients/svm/)).
  - Detects these mismatches (each is a divergence between two on-chain readings, or between the solver tracker and an on-chain reading):
    - `HubLockedButConnectedReleased` — MVM hub still locked but the connected-chain escrow has been released. Fulfillment proof lost somewhere in the integrated-gmp relay.
    - `HubFulfilledButConnectedNotReleased` — MVM hub marked fulfilled but the connected-chain escrow is still locked. Inflow auto-release on the connected chain failed.
    - `TrackerClaimsFulfilledButHubDoesNotAgree` — solver's in-memory tracker says fulfilled but MVM hub state disagrees. Solver tracker cache is stale.
  - Emits each mismatch as an explicit `anyhow::Error` carrying chain, intent_id, and mismatch type. **The solver does not attempt repair** — this stage is observation only; Stage 3's solver escrow-cleanup sweep consumes these signals.
  - Logs a structured `tracing::error!` line per mismatch from the solver.
- [solver/src/service/mod.rs](../../../solver/src/service/mod.rs) — expose the new solver module.
- [solver/src/bin/solver.rs](../../../solver/src/bin/solver.rs) — in the solver entrypoint, spawn the reconciliation loop every `RECONCILE_INTERVAL_SECS = 15` (mainnet intents live ~120s, so the sweep must fire several times per intent lifetime).
- `solver/tests/reconciliation_tests.rs` (new) — solver unit tests
  - Use existing solver-side chain-client test doubles (see [chain-clients/svm/tests/](../../../chain-clients/svm/tests/) for patterns).
  - `test_detects_hub_locked_but_connected_released`
  - `test_detects_hub_fulfilled_but_connected_not_released`
  - `test_no_mismatch_on_healthy_intent`
  - `test_emits_explicit_error_per_mismatch` (verify the solver errors, does not silently fix).

### Test command

```bash
RUST_LOG=off nix develop ./nix -c bash -c "cd solver && cargo test --quiet"
```

### End of Stage 2 (required)

1. Run the test command above and confirm the solver unit tests pass.
2. **Review**: run `/review-me` and resolve any blocking feedback.
3. Ask the user: "Ready to commit?"
4. **Commit**: if yes, run `/commit`.
5. Do not start Stage 3 until both review and commit are complete.

---

## Stage 3 — Solver-driven orphaned-escrow cleanup on MVM / EVM / SVM

### Purpose of Stage 3

**What**: Add a sweep loop **inside the solver service** (a new module `solver/src/service/escrow_cleanup.rs`, spawned from the solver's [main.rs](../../../solver/src/main.rs)) that, for each intent past `expiry_time + GRACE_PERIOD_SECS` with the solver's tracker state `Expired` and the connected-chain escrow still locked, calls the connected chain's existing cancel entry point via the corresponding `chain-clients/{mvm,evm,svm}` crate:

- MVM → `cancel_escrow` on the `intent_inflow_escrow` Move module.
- EVM → `cancel()` on the `IntentInflowEscrow` Solidity contract.
- SVM → `Cancel` instruction on the `intent_inflow_escrow` Solana program.

The solver tracks the outcome via two new solver-side `IntentState` variants: `Cleaned` (on-chain cancel succeeded) and `CleanupFailed` (cancel call failed after `cleanup_attempt_count` retries).

**Why**: Today if solver fulfillment never completes (integrated-gmp dropped a message, solver process died, a connected chain paused), the on-chain escrow on the connected chain sits locked until someone manually calls the on-chain cancel. That's poor UX for requesters and leaves requester funds hanging. The on-chain cancel entry points already exist on all three connected chains (MVM/EVM/SVM) — this stage adds an automated caller on the **solver** side, plus a thin per-chain wrapper in **chain-clients**, with explicit solver-side bookkeeping so we can tell the difference between "solver successfully cleaned the intent" and "solver-side cleanup attempt itself failed." Covers both halves of "orphaned escrow cleanup": on-chain recovery (the actual cancel transaction on MVM/EVM/SVM, issued by the solver) and off-chain bookkeeping (solver tracker state transition).

### Scope

Solver + chain-clients (MVM/EVM/SVM). Uses the existing on-chain cancel entry points on all three connected chains — **no new on-chain contract code**, only:

- New solver caller logic (new sweep module + tracker bookkeeping).
- New thin per-chain wrappers in the shared chain-clients crates.

No changes to integrated-gmp or coordinator.

Existing on-chain cancel entry points (called by the solver via chain-clients, unchanged in this stage):

- MVM: `cancel_escrow` in [intent-frameworks/mvm/intent-connected/sources/gmp/intent_inflow_escrow.move](../../../intent-frameworks/mvm/intent-connected/sources/gmp/intent_inflow_escrow.move)
- EVM: `cancel()` in [intent-frameworks/evm/contracts/IntentInflowEscrow.sol](../../../intent-frameworks/evm/contracts/IntentInflowEscrow.sol)
- SVM: `Cancel` instruction in [intent-frameworks/svm/programs/intent_inflow_escrow/src/processor.rs](../../../intent-frameworks/svm/programs/intent_inflow_escrow/src/processor.rs)

### Files to change

- `solver/src/service/escrow_cleanup.rs` (new) — solver sweep loop
  - Solver's `EscrowCleanupService::sweep_once()` — for each intent in the solver tracker with `state == Expired` and `now > expiry_time + GRACE_PERIOD_SECS (900)`:
    - Solver queries the connected chain (via chain-clients): is the escrow still locked? If not, the solver marks its tracker as `Cleaned` and moves on.
    - If still locked: solver calls the chain-specific cancel via the shared client (dispatch on the intent's `connected_chain_type`).
    - On success: solver transitions its tracker to the new `IntentState::Cleaned`.
    - On failure: solver increments a per-intent `cleanup_attempt_count` (cap at 3), then transitions the solver tracker to `IntentState::CleanupFailed` — explicit terminal state in the solver, not a silent swallow.
- [chain-clients/mvm/src/](../../../chain-clients/mvm/src/), [chain-clients/evm/src/](../../../chain-clients/evm/src/), [chain-clients/svm/src/](../../../chain-clients/svm/src/) — per-chain shared clients
  - Add a `cancel_expired_escrow(intent_id)` method on each chain's shared client. Thin wrapper around the existing on-chain cancel entry point (CLI call for MVM, ethers call for EVM, RPC instruction for SVM). The solver's sweep loop calls this.
- [solver/src/service/tracker.rs](../../../solver/src/service/tracker.rs) — solver tracker
  - Add `IntentState::Cleaned` and `IntentState::CleanupFailed` variants. Update solver pattern-match sites.
  - Add `cleanup_attempt_count: u32` to the solver's `TrackedIntent`.
- [solver/src/main.rs](../../../solver/src/main.rs) — solver entrypoint
  - Spawn the solver sweep loop every `CLEANUP_INTERVAL_SECS = 300`.
- `solver/tests/escrow_cleanup_tests.rs` (new) — solver unit tests
  - One test per connected chain (MVM/EVM/SVM): expired escrow is cancelled by the solver; still-valid escrow is skipped by the solver; cleanup failure transitions the solver tracker to `CleanupFailed` after 3 attempts.
- Chain-client unit tests under [chain-clients/mvm/tests/](../../../chain-clients/mvm/tests/), [chain-clients/evm/tests/](../../../chain-clients/evm/tests/), [chain-clients/svm/tests/](../../../chain-clients/svm/tests/) — one per chain, verifying the new `cancel_expired_escrow` wrapper.

### Test command

```bash
RUST_LOG=off nix develop ./nix -c bash -c "cd solver && cargo test --quiet" && \
nix develop ./nix -c bash -c "./chain-clients/scripts/test.sh"
```

### End of Stage 3 (required)

1. Run the test commands above and confirm both the solver unit tests and the chain-clients unit tests pass.
2. **Review**: run `/review-me` and resolve any blocking feedback.
3. Ask the user: "Ready to commit?"
4. **Commit**: if yes, run `/commit`.
5. Do not start Stage 4 until both review and commit are complete.

---

## Stage 4 — E2E partial-failure tests (solver + integrated-gmp + on-chain)

### Purpose of Stage 4

**What**: Add end-to-end shell scripts under [testing-infra/ci-e2e/](../../../testing-infra/ci-e2e/) that spin up the full stack (solver + integrated-gmp + per-chain local nodes) and deliberately break the happy path — kill the integrated-gmp relay mid-flow, create a short-expiry escrow — then assert the system recovers through the mechanisms built in Stages 1–3:

- The **solver** retries inflow (Stage 1), emits reconciliation mismatches (Stage 2), and drives on-chain cancel via **chain-clients** (Stage 3).
- The **integrated-gmp relay** is the component killed/paused to simulate dropped messages.
- The on-chain escrow contracts on **MVM/EVM/SVM** are the cancel targets.

**Why**: The Stage 1–3 unit tests prove each solver primitive (retry, reconciliation, cleanup) works in isolation — but partial-failure behavior is emergent across solver + integrated-gmp + on-chain contracts. E2E coverage is the only way to verify those pieces compose correctly under real failure conditions. Running the same scenarios on MVM, EVM, and SVM also confirms the solver's behavior is chain-uniform, not just MVM-flavored. Without these, Stages 1–3 ship as a set of untested-at-the-system-level primitives.

### Scope

[testing-infra/ci-e2e/](../../../testing-infra/ci-e2e/) only — new partial-failure E2E scripts on top of the existing inflow/outflow test harnesses. No solver code changes, no chain-clients changes, no integrated-gmp code changes, no on-chain contract changes.

### Files to change

- `testing-infra/ci-e2e/e2e-tests-mvm/partial-failure/` (new directory)
  - `test-gmp-delivery-drop.sh` — start the full stack (solver + integrated-gmp + MVM + connected chain), kill the **integrated-gmp** process after the MVM hub lock but before the connected-chain release, then assert (a) the **solver**'s reconciliation loop reports `HubLockedButConnectedReleased` within a bounded wait, and (b) the **solver**'s escrow-cleanup sweep eventually cancels the on-chain escrow via chain-clients.
  - `test-expired-escrow-auto-cleanup.sh` — create a connected-chain escrow with short expiry, wait past the solver's grace period, assert the **solver**'s cleanup sweep calls cancel on the on-chain escrow contract and transitions the solver tracker to `Cleaned`.
- Repeat equivalents under `testing-infra/ci-e2e/e2e-tests-evm/partial-failure/` and `testing-infra/ci-e2e/e2e-tests-svm/partial-failure/`.
- Root scripts under [testing-infra/ci-e2e/](../../../testing-infra/ci-e2e/) don't need changes — these new scripts are run standalone per the existing pattern.

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

1. Run all test commands above and confirm the E2E scripts pass on all three chains.
2. **Review**: run `/review-me` and resolve any blocking feedback.
3. Ask the user: "Ready to commit?"
4. **Commit**: if yes, run `/commit`.
5. This is the final stage — once committed, mark all stages complete in the progress table.
