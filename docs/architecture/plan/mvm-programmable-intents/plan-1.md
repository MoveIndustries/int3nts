# Plan 1 — MVM Programmable Intents (Framework Extensions)

Parent branch: `feat/mvm-programmable-intents`. Sub-branch PRs into the parent.

## Goal

Deliver the MVM framework changes that let an int3nts intent be fulfilled by an arbitrary Move script — for both inflow and outflow on the hub side. MVM only.

The Move-side hot-potato pattern needed for atomic in-script handoff already exists in the framework as `Session<Args>` ([intent.move:47-52](../../../../intent-frameworks/mvm/intent-hub/sources/intent.move#L47-L52)) and the `start_*` / `finish_*` pair around it is already `public`. This plan does not introduce a new hot-potato type; it adds the Rust solver code path that submits Move script payloads and the small public Move wrappers a script needs in order to drive the existing sequence end-to-end. See [plan-1-research.md](plan-1-research.md) for the audit details.

## Deliverables

Each deliverable below is a separate commit. Unit tests are created alongside the implementation they cover and land in the same commit.

1. **[x] Audit doc — [plan-1-research.md](plan-1-research.md).** First commit on the sub-branch. A short design doc covering:

    - Solver-side fulfillment path today: how the Rust solver submits the fulfillment transaction on M1 (current `aptos move run --function-id` CLI call), and the insertion point for a raw-tx API that accepts Move script payloads.
    - Move-side inflow receiver today: whether the escrow-to-fulfillment coupling is entry-function-only or already admits a script-shaped payload, and what outcome validation (balance deltas, object invariants) the receiver must perform.
    - Move-side outflow escrow today: the current release/authority model for user-locked objects, and the distance from the hot-potato pattern required for an atomic in-script handoff.

    Run `/review-me`, then `/commit`.

2. **[x] Inflow implementation.** Two changes. (i) Rust: add a script-payload submission path in `solver/src/chains/hub.rs::fulfill_inflow_intent`, parallel to the existing `--function-id` CLI path. (ii) Move: add a public `script_complete` wrapper in `fa_intent_inflow` that bundles `intent_registry::unregister_intent` + `intent_gmp_hub::send_fulfillment_proof` + `gmp_intent_state::remove_intent` (the wrapper exists because `unregister_intent` is friend-only). Script flow: assert `is_escrow_confirmed` → `start_fa_offering_session` → script work → `finish_fa_receiving_session_with_event` → `script_complete`. Ships with unit tests covering the Rust submission path and the new Move wrapper.

    Run `/review-me`, then `/commit`.

3. **[x] Outflow implementation.** Two changes. (i) Rust: add a script-payload submission path in `solver/src/chains/hub.rs::fulfill_outflow_intent`, parallel to the existing `--function-id` CLI path. (ii) Move: add a public `script_complete` wrapper in `fa_intent_outflow` that emits `LimitOrderFulfillmentEvent` + runs `intent_registry::unregister_intent` + `gmp_intent_state::remove_intent` (the wrapper exists because the event struct cannot be constructed outside the defining module *and* `unregister_intent` is friend-only). Script flow: assert `is_fulfillment_proof_received` → `start_fa_offering_session` → script work (unstake / unwind / swap) → `finish_fa_receiving_session_for_gmp` → `script_complete`. The hub-side hot-potato enforces "session can't leave the tx"; the delivered-amount and recipient post-condition is enforced on the connected chain by the validation contract before the GMP FulfillmentProof is sent back, so no new hub-side post-condition check is added. **Assumption:** the user-locked object on the hub outflow escrow is a fungible asset (the existing `FungibleStoreManager` path holds FA only). If the mainnet-contract research finds that the [Mosaic](https://docs.mosaic.ag) farm receipt is a non-FA Move object, a follow-up step 5 adds a generic-object outflow escrow path. Ships with unit tests covering the Rust submission path and the new Move wrapper. Review again based on the results from the previous steps.

    Run `/review-me`, then `/commit`.

4. **[ ] Abstract E2E round-trip.** Exercises the full programmable inflow + outflow round-trip on hub + MVM connected chain. Split into four phases, each its own commit, ordered to keep the diff for each phase narrowly scoped (test scaffold → Move package → solver Rust → integration glue). Decisions captured by the design calls A1 (compiled `.mv` files live in the package's `build/` output, package compiled at E2E setup time) and A2 (compile-time: module addresses; runtime: per-intent values like `intent_addr`, `intent_id`, `payment_amount`) in [plan-1-research.md](plan-1-research.md). Test-shapes are FA-typed throughout to match the plan-1 step-3 outflow assumption.

    **[x] 4a — Test scaffold (classic round-trip).** New `testing-infra/ci-e2e/e2e-tests-mvm/run-tests-programmable-roundtrip.sh` that drives a **classic** inflow + classic outflow round-trip in one test using the existing `inflow-submit-hub-intent.sh` / `outflow-submit-hub-intent.sh` helpers and the existing solver flow. Reuses the existing `e2e_init` / `e2e_build` / `e2e_setup_chains` / `e2e_start_services` helpers. Validates the new orchestration script works end-to-end against the known-good fulfillment path before any programmable bits exist. Lands in CI so the scaffold is correct before later phases layer in programmable behavior. Diff: bash test infra only.

    Run `/review-me`, then `/commit`.

    **[ ] 4b — Test-shapes Move package.** New `testing-infra/ci-e2e/test-shapes/` package (mirrors the `testing-infra/ci-e2e/test-tokens/` precedent for test-only Move packages). `sources/` has stub modules `test_swap`, `test_lp`, `test_farm` exposing the abstract swap / add_liquidity / remove_liquidity / stake / unstake shapes — all FA→FA. `scripts/` has `inflow_programmable.move` and `outflow_programmable.move` driving the S.1–S.5 sequence (see [docs/programmable-fulfillment.md](../../../programmable-fulfillment.md)). `Move.toml` declares a local-path dependency on `intent-frameworks/mvm/intent-hub`. Adds the deploy step to chain-hub setup so the package is on the hub for later phases. 4a's classic round-trip continues to pass unchanged. Diff: Move package only.

    Run `/review-me`, then `/commit`.

    **[ ] 4c — Solver strategy registry.** Rust-only: a `Strategy` trait (`matches(&Intent) -> bool` and `build_script_call(&Intent) -> ScriptCall { script_path, args }`), a `build_strategy_registry() -> Vec<Box<dyn Strategy>>` startup function, and config plumbing for enabling strategies by name. The solver inflow / outflow services walk the registry per intent and dispatch to `fulfill_*_intent_via_script` (added in steps 2 and 3) on the first match; no match → existing entry-function path. Empty registry by default → existing behavior unchanged, 4a's test still passes. Strategies are local to each solver process — not on-chain, not shared. Diff: solver Rust only.

    Run `/review-me`, then `/commit`.

    **[ ] 4d — Programmable wiring.** Add a `TestShapesStrategy` impl that matches a recognizable test-fixture intent shape and points at the compiled `test-shapes` `.mv` paths from 4b; register it in `build_strategy_registry()`. New helper scripts `inflow-submit-hub-intent-programmable.sh` and `outflow-submit-hub-intent-programmable.sh` create intents the predicate matches. Update `run-tests-programmable-roundtrip.sh` to use the programmable helpers and assert the script path fired (e.g., by event/log inspection). Classic `run-tests-inflow.sh` and `run-tests-outflow.sh` remain unchanged; EVM and SVM E2E suites remain unchanged. Diff: integration glue + the test flip.

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

Inline checkboxes on each deliverable above (`[x]` done, `[ ]` pending). Detailed status (commit SHAs, blockers, follow-ups) lives in this sub-branch's PR body.
