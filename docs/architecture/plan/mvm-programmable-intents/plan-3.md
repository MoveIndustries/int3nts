# Plan 3 — Frontend

Parent branch: `feat/mvm-programmable-intents`. Sub-branch PRs into the parent.

## Goal

Reviewable, demo-able user experience for the PoC round-trip: one-click intent signing from Base (onboarding), exit-intent trigger from M1, status tracking across both intents.

## Deliverables

Each deliverable below is a separate commit. Unit/component tests are created alongside the UI they cover and land in the same commit.

1. **Onboarding UI.** Base wallet connection, intent-signing flow for the inflow intent (USDC escrow on Base + request-intent on M1). Ships with component tests.

    Run `/review-me`, then `/commit`.

2. **Exit UI.** M1 wallet connection, exit-intent creation locking the farm receipt into the outflow escrow. Ships with component tests.

    Run `/review-me`, then `/commit`.

3. **Status tracking.** Both intents surfaced with live status (pending, fulfilled, reverted, timed out), readable end-to-end during the demo. Ships with component tests. Review again based on the results from the previous steps.

    Run `/review-me`, then `/commit`.

4. **Demo script.** A short reproducible runbook for reviewers — env setup, wallet funding, click-path through the round-trip. Review again based on the results from the previous steps.

    Run `/review-me`, then `/commit`.

## Scope

- Frontend code only — UI wiring, wallet adapters, status polling against the coordinator.
- Component tests co-located with UI deliverables.
- Demo script living alongside the frontend.

## Non-goals

- Framework changes. The UI consumes the framework shape delivered by plan 1.
- [Mosaic](https://docs.mosaic.ag) or any protocol integration code. Integration lives in plan 2.
- Production-grade UX polish. This is a reviewable demo, not a shipped product.

## Dependencies

- Plan 1 merged into the parent branch (framework shape fixed).
- Plan 2 merged into the parent branch (something real for the UI to drive).

## Progress tracking

Tracked in this sub-branch's PR body.
