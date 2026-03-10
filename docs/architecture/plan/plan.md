# Unhappy Path Implementation Plan

## Context

The on-chain contracts (MVM, EVM, SVM) already have solid expiry/validation/cancellation mechanics. The gaps are at the **service level** — coordinator, solver, and relay do not enforce timeouts, retry failures, or automate recovery.

This plan covers the **primary** unhappy paths — the main ways things go wrong that users will hit. Secondary paths (race conditions, partial cross-chain failures, state reconciliation) are deferred.

## Current State

| Layer | Strengths | Gaps |
|---|---|---|
| On-chain (Move/Solidity/Solana) | Expiry enforcement, strict validation, admin cancellation, idempotent GMP delivery | No auto-cleanup of expired intents/escrows |
| Solver | Tracks `outflow_attempted` to prevent duplicate submissions | No retry on failure, no expiry enforcement, no `Failed` terminal state |
| Integrated-GMP relay | Idempotent delivery, event polling | In-memory queue (lost on crash), no health checks, no retry with backoff |
| Coordinator | Event caching, API serving | Serves expired intents to solvers, no expiry-aware filtering |

## Plan

### 1. Intent Expiry Handling

**Problem**: The **solver** tracker stores `expiry_time` but never enforces it. Expired intents sit in solver memory forever. The **coordinator** API serves expired intents to solvers with no filtering.

**Goal**: Expired intents are detected and cleaned up at the service level, not just on-chain.

**Scope**:

- **Solver** tracker ([solver/src/service/tracker.rs](../../../solver/src/service/tracker.rs)): Add expiry check to poll loop. When `now > expiry_time`, transition intent to terminal `Expired` state, stop tracking it.
- **Coordinator** API: Add expiry-aware filtering. Don't serve expired intents to solvers.
- Logging: Explicit log line when an intent expires (both solver and coordinator).

**Tests**:

- Unit: **Solver** tracker expiry transitions — mock `now > expiry_time`, assert intent moves to `Expired` state
- E2E: New test script (e.g. `run-tests-expiry.sh`) using the existing E2E framework (`e2e-common.sh`, `util.sh`):
  1. Start infrastructure normally (`e2e_init`, `e2e_setup_chains`, `e2e_start_services`)
  2. Create intent on **MVM hub** with short expiry: `EXPIRY_TIME=$(date -d "+10 seconds" +%s)` (instead of the normal +180 seconds)
  3. Submit draft to **coordinator**, wait for **solver** signature
  4. Create intent on-chain (requester calls `create_inflow_intent_entry` with short expiry)
  5. Do NOT submit escrow on connected chain — let the intent sit
  6. Sleep past expiry (~15 seconds)
  7. Verify: **solver** logs show intent transitioned to `Expired` (grep solver.log)
  8. Verify: **coordinator** API no longer returns this intent in active intent queries
  9. Verify: on-chain `cancel_expired_intent` succeeds (admin can cancel the expired **MVM hub** intent, funds return to requester)
  10. Verify: requester balance restored on **MVM hub**

### 2. Solver Failure Recovery

**Problem**: The **solver** outflow service sets `outflow_attempted = true` after the first fulfillment attempt. If that tx fails (rejected, timed out, insufficient gas), the **solver** never retries — the intent is stuck with no terminal state and no error surfaced.

**Goal**: Failed **solver** fulfillment transactions are retried, and permanently failed intents reach a terminal state.

**Scope**:

- **Solver** outflow service: Distinguish `outflow_attempted` from `outflow_succeeded`. A failed attempt must be retryable.
- **Solver** outflow service: Add bounded retry with exponential backoff on fulfillment tx failure (rejection, timeout, insufficient gas).
- **Solver** tracker: Add explicit `Failed` terminal state after max retries exhausted.
- **Solver** logging: Failed fulfillments must include chain error details (not swallowed).
- Tx rejection at the **solver** level is handled here — a rejected fulfillment tx is a solver failure.

**Key files**:

- [solver/src/service/outflow.rs](../../../solver/src/service/outflow.rs) — fulfillment execution and retry
- [solver/src/service/tracker.rs](../../../solver/src/service/tracker.rs) — state transitions and `Failed` state

**Tests**:

- Unit: **Solver** retry logic, state transitions on failure

### 3. Integrated-GMP Relay Unavailability

**Problem**: The **integrated-gmp relay** uses an in-memory queue with no persistence — messages are lost if the relay crashes. The **relay** has no health checks against destination chain RPC endpoints and no retry with backoff on failed deliveries. A single delivery failure is silent.

**Goal**: The **integrated-gmp relay** handles transient failures with retries and surfaces permanent failures explicitly.

**Scope**:

- **Integrated-GMP relay**: Add health check — verify destination chain RPC connectivity before attempting delivery. Log clearly when unreachable.
- **Integrated-GMP relay**: Add bounded exponential backoff on failed deliveries.
- **Integrated-GMP relay**: After max retries, log explicit error with message details (nonce, src chain, dest chain).
- Tx rejection at the **relay** level is handled here — a rejected delivery tx is a relay failure.

**Deferred**: **Integrated-GMP relay** message persistence / write-ahead log (bigger lift, secondary path).

**Key files**:

- [integrated-gmp/src/integrated_gmp_relay.rs](../../../integrated-gmp/src/integrated_gmp_relay.rs) — delivery logic and retry

**Tests**:

- Unit: **Integrated-GMP relay** retry behavior, health check logic

## Implementation Order

After each task: summarize the change and stop for review before proceeding to the next task.

1. **Intent expiry handling** — smallest scope, foundation for the rest → **stop**
2. **Solver failure recovery** — highest user impact (stuck funds if solver fails) → **stop**
3. **GMP unavailability** — relay is the critical path for cross-chain messaging → **stop**

## Dropped

- **"Transaction rejection recovery" as standalone item** — tx rejection is not a distinct failure mode. It manifests as either a solver fulfillment failure (#2) or a relay delivery failure (#3). Handling it separately would duplicate logic.

## Secondary Paths (deferred)

- Race conditions in concurrent fulfillment
- Partial failures across chains
- Retry mechanisms with backoff (cross-service)
- State reconciliation after failures
- Orphaned escrow cleanup
- GMP message persistence / write-ahead log
