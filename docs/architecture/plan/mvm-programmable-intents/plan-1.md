# Plan 1 — MVM Programmable Intents (Framework Extensions)

Parent branch: `feat/mvm-programmable-intents`. Sub-branch PRs into the parent.

## Goal

Deliver the two MVM framework extensions that let an int3nts intent be fulfilled by an arbitrary Move script: inflow script-tx fulfillment, and outflow hot-potato release. MVM only.

## Deliverables

Each deliverable below is a separate commit. Unit tests are created alongside the implementation they cover and land in the same commit.

1. **Audit doc — [plan-1-research.md](plan-1-research.md).** First commit on the sub-branch. A short design doc covering:

    - Solver-side fulfillment path today: how the Rust solver submits the fulfillment transaction on M1 (current `aptos move run --function-id` CLI call), and the insertion point for a raw-tx API that accepts Move script payloads.
    - Move-side inflow receiver today: whether the escrow-to-fulfillment coupling is entry-function-only or already admits a script-shaped payload, and what outcome validation (balance deltas, object invariants) the receiver must perform.
    - Move-side outflow escrow today: the current release/authority model for user-locked objects, and the distance from the hot-potato pattern required for an atomic in-script handoff.

    Run `/review-me`, then `/commit`.

2. **Inflow implementation.** Solver raw-tx API submitting Move script payloads; Move-side receiver validating script-execution outcomes instead of being the entry function. Ships with unit tests covering the solver-side submission shape and the Move-side outcome validator.

    Run `/review-me`, then `/commit`.

3. **Outflow implementation.** Escrow release exposed as `release_for_fulfillment(solver) -> (Object, HotPotato)`, consumed by a `finalize(escrow, deliverable, hot_potato)` that checks the post-condition (delivered amount, recipient). Non-droppable hot potato forces the script to finalize correctly or abort atomically. Ships with unit tests covering the release handoff and the finalize post-condition. Review again based on the results from the previous steps.

    Run `/review-me`, then `/commit`.

4. **Abstract E2E round-trip.** New CI script `testing-infra/ci-e2e/e2e-tests-mvm/run-tests-programmable-roundtrip.sh` exercising the full programmable inflow + outflow round-trip on hub + MVM connected chain in one test. Inflow leg: user locks tokens in connected-chain MVM escrow; solver submits a Move script payload; hub-side `finalize_fulfillment` validates outcome + state machine; GMP releases to solver on connected chain. Outflow leg: user locks a receipt-shaped object in the hub outflow escrow; solver's exit script calls `release_for_fulfillment` (object + HotPotato), runs abstract unwind steps, calls `finalize` (consumes HotPotato, checks deposit post-condition); GMP settles on connected chain; user receives tokens back. Helper submit scripts (`inflow-submit-hub-intent-programmable.sh`, `outflow-submit-hub-intent-programmable.sh`) live alongside the existing classic helpers in the same directory. Fixtures describe entry-function shapes (swap/LP/farm) in the abstract — no protocol-specific naming at this layer. Classic `run-tests-inflow.sh` and `run-tests-outflow.sh` remain unchanged; EVM and SVM E2E suites remain unchanged. Review again based on the results from the previous steps.

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
