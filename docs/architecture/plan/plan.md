# Plan: Resilience Hardening

## Progress

| # | Stage                                                          | Status      |
| - | -------------------------------------------------------------- | ----------- |
| 1 | Solver inflow retry with explicit terminal state               | Done        |
| 2 | Solver tracker self-heal against hub fulfillment proof         | Done        |
| 3 | E2E partial-failure tests (solver + integrated-gmp + on-chain) | Pending     |

## Out of scope (previously Stage 3)

Automated orphaned-escrow cleanup was originally planned as Stage 3 ("solver-driven on-chain cancel on MVM/EVM/SVM"). **Dropped for two reasons:**

- On-chain `cancel_escrow` / `cancel()` / `process_cancel` is admin-gated on all three connected chains, and keeping it admin-gated is intentional — cancellation should only happen after a human has clarified on-chain status.
- The solver is an independent third-party participant, not the protocol operator. Surfacing protocol-wide problems (stuck escrows, dropped GMP, failed auto-releases) is operator tooling, not solver logic.

Orphaned-escrow detection + admin-triggered cancel is a separate operator-tooling initiative, tracked outside this plan.

## Goal

Harden failure handling for the things the **solver itself** is responsible for on MVM, EVM, and SVM — retries, bounded failure, and keeping its own in-memory tracker honest.

The changes land in two components:

- **Solver** ([solver/](../../../solver/)) — adds inflow retry (Stage 1) and tracker self-heal against the hub (Stage 2).
- **Testing infra** ([testing-infra/ci-e2e/](../../../testing-infra/ci-e2e/)) — adds partial-failure E2E scripts that exercise the solver + integrated-gmp + on-chain stack (Stage 3).

No on-chain contract changes, no changes to the coordinator or integrated-gmp services.

Today the solver has outflow retry/backoff but no inflow retry and no mechanism to correct its tracker when the hub disagrees with it. Intents can end up in silent-stuck states (transient fulfillment failures never reaching a terminal state, tracker cache diverging from on-chain reality) that violate the project's **No Fallbacks Policy** — they neither succeed nor fail loudly.

Cross-solver double-fulfillment is **out of scope**: cross-chain inflow/outflow intents must be reserved to a specific solver address on creation (enforced by `E_INVALID_SIGNATURE` in [fa_intent_inflow.move:228-232](../../../intent-frameworks/mvm/intent-hub/sources/fa_intent_inflow.move#L228-L232) and [fa_intent_outflow.move:380-384](../../../intent-frameworks/mvm/intent-hub/sources/fa_intent_outflow.move#L380-L384), and equivalents on EVM/SVM). On-chain `ensure_solver_authorized` / `E_UNAUTHORIZED_SOLVER` guarantees that only the reserved solver can fulfill, so competing solver instances cannot race at fulfillment time — they compete at quote time at the coordinator, which is a separate concern from this plan.

**No-Fallbacks compliance**: every solver retry path has a max attempt count and terminal `Failed` state; every solver tracker drift is healed in-place with an explicit log; no silent recoveries.

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

### Files changed (done)

- [solver/src/service/tracker.rs](../../../solver/src/service/tracker.rs) — solver's in-memory `IntentTracker`
  - Added solver-side constant `MAX_INFLOW_RETRIES: u32 = 3` alongside `MAX_OUTFLOW_RETRIES`.
  - Extended `TrackedIntent` with `inflow_attempt_count` and `next_inflow_retry_after`.
  - Added `record_inflow_failure(intent_id, error)` mirroring `record_outflow_failure`.
  - Transitions the tracker's intent to `IntentState::Failed` when retries exhausted.
- [solver/src/service/inflow.rs](../../../solver/src/service/inflow.rs) — solver's `InflowService` polling loop
  - Skips intents whose `next_inflow_retry_after > now`.
  - On fulfillment error, calls `record_inflow_failure` instead of moving on silently.
- [solver/tests/tracker_tests.rs](../../../solver/tests/tracker_tests.rs) — three new solver unit tests covering backoff, exponential growth, and terminal transition.

### Test command

```bash
RUST_LOG=off nix develop ./nix -c bash -c "cd solver && cargo test --quiet"
```

---

## Stage 2 — Solver tracker self-heal against hub fulfillment proof (outflow only)

### Purpose of Stage 2

**What**: In the **solver service**, add a periodic sweep (new module `solver/src/service/reconciliation.rs`, spawned from the solver's [bin/solver.rs](../../../solver/src/bin/solver.rs)) that iterates **outflow** intents in the solver's `IntentTracker` and asks the **MVM hub** for the fulfillment-proof status via the existing `HubChainClient::is_fulfillment_proof_received`. When the hub's answer disagrees with the tracker, the solver **corrects its own tracker in place** and logs the drift at warn level. No connected-chain queries, no protocol-wide diagnostics, no repair actions beyond the solver's own cache.

**Outflow-only scope (important)**: `is_fulfillment_proof_received` asks the hub "did the connected chain send you a FulfillmentProof GMP message?" That message exists only on the outflow path (solver fulfills on connected chain → FulfillmentProof flows connected → hub). For inflow, the solver fulfills on the hub directly and **no FulfillmentProof message ever flows toward the hub** — this view returns `false` forever for inflow. Applying the signal to inflow would classify every completed inflow as drift and trigger double-fulfillment. The sweep therefore filters inflow out. Inflow tracker drift needs a different hub-side signal and is a separate design problem, deferred.

**Why**: An outflow intent's lifecycle spans the MVM hub + one connected chain + the integrated-gmp relay. If the relay delays a fulfillment proof, the solver crashes mid-fulfillment, or a hub RPC flakes, the solver's in-memory `IntentTracker` can diverge from the hub's authoritative view — leading to either redundant fulfillment attempts (tracker says `Created`, hub already has proof) or stuck retries against already-expired state (tracker says `Fulfilled`, hub has no proof). A solver-internal self-heal loop catches both and corrects them, which is strictly a solver concern: each solver cares about *its own* tracker, not about protocol-wide health.

### Scope

Solver only. Single new module in [solver/src/service/](../../../solver/src/service/). Reads the hub via the existing `HubChainClient` — no connected-chain clients, no new on-chain contract code, no integrated-gmp changes, no coordinator changes.

### Files changed (done)

- [solver/src/service/reconciliation.rs](../../../solver/src/service/reconciliation.rs) (new)
  - `TrackerDrift` enum with two variants: `ClaimsFulfilledButNoProofOnHub` (revert tracker to `Created`) and `ClaimsUnfulfilledButHubHasProof` (advance tracker to `Fulfilled`).
  - Pure `classify_drift(snapshot)` — tested without chain-client mocks.
  - `ReconciliationService::{new, run_once, run}` — constructs hub client, iterates tracked intents in `Created`/`Fulfilled`, queries `is_fulfillment_proof_received`, on drift calls `IntentTracker::heal_state_by_intent_id`.
  - Sweep interval: `RECONCILE_INTERVAL_SECS = 30` (mainnet intents live ~120s).
- [solver/src/service/tracker.rs](../../../solver/src/service/tracker.rs)
  - Added `get_all_tracked_intents()` for the sweep.
  - Added `heal_state_by_intent_id(intent_id, new_state)` — state-only overwrite by on-chain intent_id, used by the reconciliation service for drift correction.
- [solver/src/service/mod.rs](../../../solver/src/service/mod.rs), [solver/src/lib.rs](../../../solver/src/lib.rs) — module registration and public re-exports.
- [solver/src/bin/solver.rs](../../../solver/src/bin/solver.rs) — spawns the sweep in `tokio::select!` at `RECONCILE_INTERVAL_SECS`.
- [solver/tests/reconciliation_tests.rs](../../../solver/tests/reconciliation_tests.rs) (new) — 10 tests: pure drift classification (both drift kinds, healthy states, terminal states), Display carries intent_id, tracker heal method (success + not-found), service construction, empty-tracker run_once.

### Test command

```bash
RUST_LOG=off nix develop ./nix -c bash -c "cd solver && cargo test --quiet"
```

---

## Stage 3 — E2E partial-failure tests (solver + integrated-gmp + on-chain)

### Purpose of Stage 3

**What**: Add end-to-end shell scripts under [testing-infra/ci-e2e/](../../../testing-infra/ci-e2e/) that spin up the full stack (solver + integrated-gmp + per-chain local nodes) and deliberately break the happy path to exercise Stages 1 and 2:

- **Stage 1 exercised**: induce transient inflow fulfillment failures (e.g. kill integrated-gmp briefly, then restore) and assert the solver retries with backoff, and that after `MAX_INFLOW_RETRIES` the intent reaches `Failed`.
- **Stage 2 exercised**: force tracker drift (e.g. kill the solver mid-fulfillment after the hub records proof but before the tracker writes `Fulfilled`; restart the solver), then assert the reconciliation sweep heals the tracker state within ~30s.

**Why**: Stage 1 and Stage 2 unit tests prove each primitive in isolation — but retry + self-heal behavior is emergent across solver + integrated-gmp + on-chain contracts. E2E coverage is the only way to verify those pieces compose correctly under real failure conditions. Running the same scenarios on MVM, EVM, and SVM also confirms behavior is chain-uniform.

### Scope

[testing-infra/ci-e2e/](../../../testing-infra/ci-e2e/) only — new partial-failure E2E scripts on top of the existing inflow/outflow test harnesses. No solver code changes, no chain-clients changes, no integrated-gmp code changes, no on-chain contract changes.

### Files to change

- `testing-infra/ci-e2e/e2e-tests-mvm/partial-failure/` (new directory)
  - `test-inflow-retry-exhaustion.sh` — induce repeated inflow fulfillment failures (kill integrated-gmp until `MAX_INFLOW_RETRIES` is exceeded) and assert the solver transitions the intent to `Failed`.
  - `test-tracker-self-heal.sh` — kill the solver after the MVM hub has recorded a fulfillment proof but before the solver tracker writes `Fulfilled`; restart the solver; assert the reconciliation sweep flips the tracker to `Fulfilled` within ~30s.
- Repeat equivalents under `testing-infra/ci-e2e/e2e-tests-evm/partial-failure/` and `testing-infra/ci-e2e/e2e-tests-svm/partial-failure/`.
- Root scripts under [testing-infra/ci-e2e/](../../../testing-infra/ci-e2e/) don't need changes — these new scripts run standalone per the existing pattern.

### Test command

```bash
nix develop ./nix -c bash -c "./testing-infra/ci-e2e/e2e-tests-mvm/partial-failure/test-inflow-retry-exhaustion.sh" && \
nix develop ./nix -c bash -c "./testing-infra/ci-e2e/e2e-tests-mvm/partial-failure/test-tracker-self-heal.sh" && \
nix develop ./nix -c bash -c "./testing-infra/ci-e2e/e2e-tests-evm/partial-failure/test-inflow-retry-exhaustion.sh" && \
nix develop ./nix -c bash -c "./testing-infra/ci-e2e/e2e-tests-evm/partial-failure/test-tracker-self-heal.sh" && \
nix develop ./nix -c bash -c "./testing-infra/ci-e2e/e2e-tests-svm/partial-failure/test-inflow-retry-exhaustion.sh" && \
nix develop ./nix -c bash -c "./testing-infra/ci-e2e/e2e-tests-svm/partial-failure/test-tracker-self-heal.sh"
```

### End of Stage 3 (required)

1. Run all test commands above and confirm the E2E scripts pass on all three chains.
2. **Review**: run `/review-me` and resolve any blocking feedback.
3. Ask the user: "Ready to commit?"
4. **Commit**: if yes, run `/commit`.
5. This is the final stage — once committed, mark all stages complete in the progress table.
