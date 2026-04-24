# Plan 2 — Mosaic Integration (PoC Round-Trip)

Parent branch: `feat/mvm-programmable-intents`. Sub-branch PRs into the parent.

## Status

Pending research. Mainnet-contract research (entry-function signatures, USDC variant, pool selection, exact Move script call sequences, receiver-validation outcomes) is initiated manually outside this plan. This sub-branch does not start until that research is published.

## Goal

Wire the PoC round-trip to real [Mosaic](https://docs.mosaic.ag) entry functions on Movement testnet. This is the first place the framework meets a specific destination-chain protocol by name.

## Deliverables

Each deliverable below is a separate commit. Unit tests are created alongside the implementation they cover and land in the same commit.

1. **Onboarding Move script** (inflow fulfillment). Constructs the sequence `swap USDC → MOVE` → `add_liquidity(USDC, MOVE)` → `stake(LP token)` against [Mosaic](https://docs.mosaic.ag)'s public entry functions. No new Move modules; all calls land on existing [Mosaic](https://docs.mosaic.ag) contracts. Ships with unit tests for script construction.

    Run `/review-me`, then `/commit`.

2. **Exit Move script** (outflow fulfillment). Mirror sequence: `release_for_fulfillment` from the outflow escrow → `unstake(farm_receipt)` → `remove_liquidity(LP token)` → `swap MOVE → USDC` → `finalize(escrow, usdc, hot_potato)`. Ships with unit tests for script construction.

    Run `/review-me`, then `/commit`.

3. **Receiver outcome assertions** tuned to the specific round-trip (expected balance deltas per step, expected object types held/consumed at boundaries). Ships with unit tests. Review again based on the results from the previous steps.

    Run `/review-me`, then `/commit`.

4. **Testnet integration tests.** End-to-end run of the round-trip on Movement testnet, against live [Mosaic](https://docs.mosaic.ag) contracts. Review again based on the results from the previous steps.

    Run `/review-me`, then `/commit`.

## Scope

- [Mosaic](https://docs.mosaic.ag)-specific Move script construction and the matching receiver assertions.
- Unit tests co-located with implementation; testnet integration tests as a separate final step.

## Non-goals

- New Move modules. All fulfillment lands on [Mosaic](https://docs.mosaic.ag)'s existing public entry functions.
- Mainnet deployment or mainnet integration tests. Mainnet is a later, separate effort.
- Frontend (that is plan 3).
- Framework-level changes; those belong in plan 1.

## Dependencies

- Plan 1 merged into the parent branch. The framework extensions must be in place before plan 2 integrates a real protocol against them.
- Mainnet-contract research published (see Status above).

## Progress tracking

Tracked in this sub-branch's PR body.
