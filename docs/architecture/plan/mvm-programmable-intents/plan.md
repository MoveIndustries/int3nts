# MVM Programmable Intents — Plan Overview

## Goal

Deliver the USDC Yield PoC: a cross-chain intent whose destination-chain fulfillment on M1 is an arbitrary Move script (not a token delivery), demonstrated end-to-end by a round-trip through a staked [Mosaic](https://docs.mosaic.ag) USDC/MOVE LP position.

## Scope

MVM only. Programmable intents apply to the M1 hub side. EVM and SVM connected-chain behavior is unchanged.

## Branch structure

Three int3nts sub-branches merge into a shared parent integration branch in this repository.

- Parent branch (this one): `feat/mvm-programmable-intents`. Holds this plan. Plans 1, 2, 3 PR into here. Once all three are merged, the parent PRs into `main`.
- Plan 1 — int3nts sub-branch: framework extensions. See [plan-1.md](plan-1.md).
- Plan 2 — int3nts sub-branch: [Mosaic](https://docs.mosaic.ag) integration for the PoC round-trip. See [plan-2.md](plan-2.md).
- Plan 3 — int3nts sub-branch: frontend. See [plan-3.md](plan-3.md).

Mainnet-contract research (entry-function signatures, USDC variant, pool selection, exact Move script call sequences, receiver-validation outcomes) is initiated manually outside this plan and is a hard prerequisite for plan 2.

## Sequencing

1. Parent branch pushed with this plan.
2. Plan 1 (sub-branch) opens; its first commit is an audit of the current int3nts code (solver fulfillment path, Move-side receiver, outflow escrow release model).
3. Plan 1 completes implementation and abstract tests, merges into the parent.
4. Plan 2 starts only after plan 1 is merged into the parent AND the mainnet-contract research is published.
5. Plan 2 merges into the parent.
6. Plan 3 starts after plan 2 is merged. Merges into the parent.
7. Parent PRs into `main`.

## Workflow per step

Each numbered deliverable inside a plan is a separate commit. Unit tests ship alongside the implementation they cover in the same commit; dedicated integration / end-to-end test steps come later in the sequence. Before each commit, run `/review-me`, then `/commit`.

## Progress tracking

Each sub-branch tracks its own progress in its PR body (checklist, status updates). This overview document stays scope-only and does not track runtime status.

## Non-goals

- EVM or SVM framework changes. Connected-chain behavior for those two VM families stays as it is.
- Competing on yield rate. This is a technical demo, not a product launch.
- Account abstraction (M1 identity driving a Base wallet). Out of scope for the PoC; the user holds both wallets.
- Alternative PoC approaches (A, C, D, E, F from the mainnet-contract research). Only the [Mosaic](https://docs.mosaic.ag) round-trip is in scope for this plan.
