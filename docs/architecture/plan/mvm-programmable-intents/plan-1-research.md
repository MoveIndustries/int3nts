# Plan 1 — Research: Current Code Audit for MVM Programmable Intents

## Purpose

This audit maps the current int3nts code paths that plan 1 extends. It covers three areas: the Rust solver's fulfillment submission, the Move-side inflow receiver, and the Move-side outflow escrow. Findings here inform the concrete implementation steps in [plan-1.md](plan-1.md).

## Baseline flow — documented elsewhere

This document does not re-describe the intent flows. Inflow and outflow are already specified in:

- [docs/architecture/conception/conception_inflow.md](../../conception/conception_inflow.md)
- [docs/architecture/conception/conception_outflow.md](../../conception/conception_outflow.md)
- [docs/intent-frameworks/mvm/intent-as-escrow.md](../../../intent-frameworks/mvm/intent-as-escrow.md)

In particular, the canonical outflow ordering — requester locks on Hub → IntentRequirements GMP → solver fulfills on connected chain → FulfillmentProof GMP → Hub auto-releases escrow to solver — is the baseline this audit assumes. The programmable extension keeps that ordering; only Hub-side step 8 (solver claim on Hub) changes shape from an entry-function call to a Move script.

## Headline finding

The Move framework already implements a non-droppable hot-potato pattern via `Session<Args>` ([intent.move:47-52](../../../../intent-frameworks/mvm/intent-hub/sources/intent.move#L47-L52)). The type carries no `drop` or `copy` ability; it is the value returned by `start_*_session` and must be consumed by `finish_*_session`. Both inflow and outflow entry functions already use this pattern internally, and the `start`/`finish` functions are already `public` — callable from a Move script.

Consequence: the two framework extensions named in the plan are not "introduce a hot-potato type" — that type exists and is already exposed. The extensions are about (a) adding a Rust solver code path that submits Move script payloads instead of entry-function calls, and (b) restructuring the hub-side Move entry functions into script-friendly pairs by factoring out the GMP cleanup and cross-chain authorization checks into separately callable helpers.

## Area A — Solver-side fulfillment submission (Rust)

### Solver Rust — current shape

The solver submits hub-side fulfillment transactions by shelling out to the Move CLI (`aptos` or `movement`) with `move run --function-id <module>::<function>` and BCS-encoded arguments. Invocation is synchronous (`std::process::Command`) and the transaction hash is extracted by regex-matching stdout.

Key call sites:

- [solver/src/chains/hub.rs:313-393](../../../../solver/src/chains/hub.rs#L313-L393) — `fulfill_inflow_intent`. Builds `--function-id fa_intent_inflow::fulfill_inflow_intent` plus `[address:intent_addr, u64:payment_amount]` args and invokes the CLI.
- [solver/src/chains/hub.rs:408-491](../../../../solver/src/chains/hub.rs#L408-L491) — `fulfill_outflow_intent`. Same shape; target is `fa_intent_outflow::fulfill_outflow_intent`.
- [solver/src/chains/hub.rs:19-49](../../../../solver/src/chains/hub.rs#L19-L49) — `extract_transaction_hash` helper (stdout regex).

Authentication: `--profile` for E2E tests, `--private-key` with `MOVEMENT_SOLVER_PRIVATE_KEY` for live networks. The `chain-clients/mvm/` crate wraps RPC queries (view functions, events) but does not submit transactions — it defers to the CLI.

### Solver Rust — what is missing

No script-payload submission exists anywhere in the Rust codebase today. Every fulfillment tx flows through `aptos move run --function-id`. The CLI does support scripts via a separate subcommand: `aptos move run-script --compiled-script-path <PATH.mv>` (pre-compiled bytecode) or `--script-path <PATH.move>` (source, CLI compiles). Same `--type-args`, `--args`, `--profile`/`--private-key`/`--url` flags as `move run`. So the script path is a parallel sync `Command` invocation, not a different protocol.

### Where to add the script-submission path

The two `fulfill_*_intent` functions in [solver/src/chains/hub.rs](../../../../solver/src/chains/hub.rs) are the entry points to modify. Add a new code path that invokes `aptos move run-script --compiled-script-path <path> --args ...` when the caller supplies a script-bytecode path, parallel to the existing `move run --function-id` path. The tx-hash extraction helper [solver/src/chains/hub.rs:19-49](../../../../solver/src/chains/hub.rs#L19-L49) is reusable across both paths. Auth (`--profile` / `--private-key`) is identical between subcommands. Sync stays sync — no async needed.

### Solver Rust — open questions

1. **Where the compiled `.mv` file lives.** The CLI takes a file path. The `.mv` for the abstract E2E (plan 1 step 4) and for Mosaic (plan 2) needs to be compiled ahead of time and reachable from the solver at run time. Open: ship inside the solver crate, alongside the test fixture, in a separate package the solver loads at startup, or per-PoC compiled by plan 2 / plan 3?
2. **Compile-time vs runtime parameterization.** Some script parameters (token amounts, recipient addresses) want to be passed via `--args` per call. Others (Mosaic module addresses) are baked into the bytecode at compile time. Open: which split goes into the abstract test fixture's `.mv` vs the Mosaic `.mv` in plan 2?

## Area B — Move-side inflow receiver

### Move inflow — current shape

The inflow entry function [fa_intent_inflow::fulfill_inflow_intent](../../../../intent-frameworks/mvm/intent-hub/sources/fa_intent_inflow.move#L74) ([fa_intent_inflow.move:74-147](../../../../intent-frameworks/mvm/intent-hub/sources/fa_intent_inflow.move#L74-L147)) runs the following sequence in one tx:

1. Call `fa_intent::start_fa_offering_session(solver, intent)` — returns `(unlocked_fa, session: Session<FALimitOrder>)`. For inflow, `unlocked_fa` is 0 tokens (hub side locks nothing); the session carries the limit-order arguments and is non-droppable.
2. Read `desired_metadata` from `session`'s argument.
3. For cross-chain intents, assert `gmp_intent_state::is_escrow_confirmed(intent_id_bytes)` — GMP proof from the connected chain that the user's inflow escrow is locked.
4. Withdraw `payment_amount` of `desired_metadata` from the solver's primary store.
5. Call `fa_intent::finish_fa_receiving_session_with_event(session, payment_fa, intent_addr, solver_addr)` — consumes the session, validates `payment_fa`'s metadata and amount against the session's desired values, deposits to the requester, emits event.
6. `intent_registry::unregister_intent(intent_addr)`.
7. For cross-chain intents, `intent_gmp_hub::send_fulfillment_proof(...)` and `gmp_intent_state::remove_intent(intent_id_bytes)`.

State machine: the `Intent` object is held in a registry; `start_intent_session` calls `move_from` on the intent ([intent.move:131](../../../../intent-frameworks/mvm/intent-hub/sources/intent.move#L131)), which deletes it atomically. Double-fulfillment is prevented structurally — the second call finds no intent to `move_from` and aborts. There is no explicit `pending → fulfilled` state struct; the presence/absence of the intent object is the state.

Outcome validation is done inside `finish_fa_receiving_session_with_event` at [fa_intent.move:437-443](../../../../intent-frameworks/mvm/intent-hub/sources/fa_intent.move#L437-L443): metadata match + amount ≥ minimum required.

### Visibility map for the surrounding helpers

Verified by grep against the source (not the build directory):

| Function | Visibility | Script-callable |
| --- | --- | --- |
| `fa_intent::start_fa_offering_session` ([fa_intent.move:373](../../../../intent-frameworks/mvm/intent-hub/sources/fa_intent.move#L373)) | `public` | yes |
| `fa_intent::finish_fa_receiving_session_with_event` ([fa_intent.move:425](../../../../intent-frameworks/mvm/intent-hub/sources/fa_intent.move#L425)) | `public` | yes — also emits the inflow fulfillment event internally |
| `gmp_intent_state::is_escrow_confirmed` ([gmp_intent_state.move:268](../../../../intent-frameworks/mvm/intent-gmp/sources/gmp/gmp_intent_state.move#L268)) | `public` | yes |
| `gmp_intent_state::remove_intent` ([gmp_intent_state.move:411](../../../../intent-frameworks/mvm/intent-gmp/sources/gmp/gmp_intent_state.move#L411)) | `public` | yes |
| `intent_gmp_hub::send_fulfillment_proof` ([intent_gmp_hub.move:317](../../../../intent-frameworks/mvm/intent-hub/sources/interfaces/intent_gmp_hub.move#L317)) | `public` | yes |
| `intent_registry::unregister_intent` ([intent_registry.move:115](../../../../intent-frameworks/mvm/intent-hub/sources/intent_registry.move#L115)) | `public(friend)` (friends: `fa_intent_inflow`, `fa_intent_outflow`) | **no** |

The only inflow gap is `intent_registry::unregister_intent`. Outcome validation is already inside `finish_fa_receiving_session_with_event`, and the inflow fulfillment event is also already emitted there — neither is an extra step the script needs to make.

### Where the inflow extension plugs in

The programmable inflow path wants a script-friendly shape where the script author drives the sequence directly: assert escrow confirmed → `start_fa_offering_session` → arbitrary Move work (swap / LP / stake) → `finish_fa_receiving_session_with_event` → cleanup.

The cleanup (`unregister_intent`, `send_fulfillment_proof`, `remove_intent`) needs one new public wrapper because `unregister_intent` is friend-only:

- Add `fa_intent_inflow::script_complete(solver, intent_addr, intent_id_bytes, payment_amount)` (name TBD) — bundles `intent_registry::unregister_intent(intent_addr)` + (cross-chain) `intent_gmp_hub::send_fulfillment_proof(...)` + `gmp_intent_state::remove_intent(intent_id_bytes)`. Script calls this immediately after `finish_fa_receiving_session_with_event`.

The classic `fulfill_inflow_intent` entry function stays unchanged.

### Note

In the programmable path the script constructs the payment FA from its own operations (rather than withdrawing a fixed `payment_amount` from the solver's primary store) and passes it straight to `finish_fa_receiving_session_with_event`. The metadata + minimum-amount checks inside `finish` cover correctness — no additional witness or assertion is required.

## Area C — Move-side outflow escrow

### Move outflow — current shape

The outflow entry function [fa_intent_outflow::fulfill_outflow_intent](../../../../intent-frameworks/mvm/intent-hub/sources/fa_intent_outflow.move#L139) ([fa_intent_outflow.move:139-196](../../../../intent-frameworks/mvm/intent-hub/sources/fa_intent_outflow.move#L139-L196)) runs:

1. `fa_intent_with_oracle::start_fa_offering_session(solver, intent)` — returns `(unlocked_fa, session: Session<OracleGuardedLimitOrder>)`. For outflow, `unlocked_fa` is the user-locked tokens (the thing the user put in the escrow); the session is non-droppable.
2. Assert `gmp_intent_state::is_fulfillment_proof_received(intent_id_bytes)` — GMP proof from the connected chain that the solver has delivered value to the user there.
3. Deposit `unlocked_fa` to the solver (the solver's reward for having pre-funded the connected-chain side).
4. Emit `LimitOrderFulfillmentEvent`.
5. Withdraw 0 tokens from solver as a placeholder "payment" — the hub-side `finish` requires a payment FA argument, but outflow's actual value exchange already happened on the connected chain.
6. Call `fa_intent_with_oracle::finish_fa_receiving_session_for_gmp(session, solver_payment)` — consumes session.
7. `intent_registry::unregister_intent(intent_addr)` and `gmp_intent_state::remove_intent(intent_id_bytes)`.

Storage model: user-locked tokens are held in a per-intent `FungibleStore`, managed by a `FungibleStoreManager` resource that holds `ExtendRef` + `DeleteRef` ([fa_intent.move:35-38](../../../../intent-frameworks/mvm/intent-hub/sources/fa_intent.move#L35-L38), creation at [fa_intent.move:209-225](../../../../intent-frameworks/mvm/intent-hub/sources/fa_intent.move#L209-L225)). `start_fa_offering_session` extracts the stored FA and destroys the store in the same call ([fa_intent.move:373-402](../../../../intent-frameworks/mvm/intent-hub/sources/fa_intent.move#L373-L402)).

### Public visibility

Both ends of the outflow hot-potato pair are already `public fun`:

- [fa_intent_with_oracle.move:279](../../../../intent-frameworks/mvm/intent-hub/sources/fa_intent_with_oracle.move#L279) — `public fun start_fa_offering_session`
- [fa_intent_with_oracle.move:349](../../../../intent-frameworks/mvm/intent-hub/sources/fa_intent_with_oracle.move#L349) — `public fun finish_fa_receiving_session_for_gmp`

A Move script can already call both. The escrow store is created/destroyed inside `start`, so a script gets the unlocked FA directly as a return value. This is the hot-potato handoff the plan describes: the script receives the FA *and* the non-droppable session; the session cannot leave the tx without being consumed by `finish`.

### Move outflow — what is missing

The script still needs to, in the same tx:

1. Emit the `LimitOrderFulfillmentEvent`. The struct is defined in `fa_intent_outflow` and Move does not allow cross-module struct construction, so a script cannot emit this event itself.
2. Call `intent_registry::unregister_intent(intent_addr)`. This function is `public(friend)` only ([intent_registry.move:115](../../../../intent-frameworks/mvm/intent-hub/sources/intent_registry.move#L115)); a script cannot call it directly.

The other two surrounding calls — `gmp_intent_state::is_fulfillment_proof_received` (precondition) and `gmp_intent_state::remove_intent` (cleanup) — are already `public` and script-callable.

**Outflow post-condition difference from plan 1 summary.** Plan-1 step 3 describes finalize as checking "delivered amount, recipient." In the current outflow flow, the hub-side `finish` receives a 0-amount placeholder FA (step 5 above); the actual value delivery to the user happens on the connected chain and is authorized by the GMP `is_fulfillment_proof_received` gate, not by a hub-side amount check. The hot-potato on the hub enforces "the session cannot leave the tx" but does not enforce a hub-side deposit amount. This is correct for the current outflow semantics — worth capturing explicitly before implementing.

**Asset-type assumption.** The current `fulfill_outflow_intent` is typed `Intent<FungibleStoreManager, OracleGuardedLimitOrder>` — the user-locked thing is a fungible asset. Plan 1 assumes the [Mosaic](https://docs.mosaic.ag) farm receipt is FA-compatible. If mainnet-contract research finds the farm receipt is a non-FA Move object (e.g. `Object<FarmPosition>`), the existing `FungibleStoreManager` escrow path does not hold it; a generic-object outflow escrow path becomes a follow-up step 5 in plan 1. This assumption is owned by the mainnet-contract research track, not by plan 1 itself.

### Where the outflow extension plugs in

One new public wrapper covers both gaps:

- Add `fa_intent_outflow::script_complete(solver, intent_addr, intent_id_bytes, provided_metadata, provided_amount)` (name TBD) — emits `LimitOrderFulfillmentEvent` and runs `intent_registry::unregister_intent(intent_addr)` + `gmp_intent_state::remove_intent(intent_id_bytes)`. Script calls this immediately after `finish_fa_receiving_session_for_gmp`.

Script flow then becomes: `assert is_fulfillment_proof_received` → `start_fa_offering_session` → script work (unstake/unwind/swap) → `finish_fa_receiving_session_for_gmp` → `script_complete`.

The classic `fulfill_outflow_intent` entry function stays unchanged.

### Move outflow — open questions

1. **Intent-type constraints.** `fulfill_outflow_intent` is typed specifically to `Intent<FungibleStoreManager, OracleGuardedLimitOrder>`. Are programmable outflow intents still the same shape, or do they need a new intent type with a different argument struct (e.g. one that carries the delivery post-condition spec)?

## What stays the same

- `Session<Args>` as the hot-potato primitive — no new non-droppable type needed.
- The entry function BCS/CLI call path for classic (non-programmable) intents — unchanged on both the Rust side and the Move side.
- EVM and SVM code — out of scope for plan 1.

## What changes

- **Rust solver:** add a script-payload submission path in the two `fulfill_*_intent` functions, parallel to the existing `--function-id` path. Caller supplies (or compiles) the Move script bytecode.
- **Move inflow (`fa_intent_inflow`):** add one public `script_complete` wrapper that bundles `intent_registry::unregister_intent` + `intent_gmp_hub::send_fulfillment_proof` + `gmp_intent_state::remove_intent`. The wrapper exists because `intent_registry::unregister_intent` is friend-only.
- **Move outflow (`fa_intent_outflow`):** add one public `script_complete` wrapper that emits `LimitOrderFulfillmentEvent` + runs `intent_registry::unregister_intent` + `gmp_intent_state::remove_intent`. The wrapper exists because the event struct cannot be constructed outside the defining module *and* `intent_registry::unregister_intent` is friend-only.

The classic entry functions (`fulfill_inflow_intent`, `fulfill_outflow_intent`) stay unchanged. EVM and SVM code untouched.

## Resolved design questions

- **(A1) — resolved.** Compiled `.mv` script files live in the test-only Move package's own `build/` output (mirrors the `testing-infra/ci-e2e/test-tokens/` precedent for test-only packages). The abstract test package lives at `testing-infra/ci-e2e/test-shapes/`, compiled at E2E setup time before the orchestration script runs. The Mosaic-specific package (plan 2) follows the same pattern.
- **(A2) — resolved.** Compile-time parameters baked into the script bytecode: module addresses of `test-shapes` and the intent-hub modules (resolved via the package's `Move.toml` `[addresses]` section). Runtime parameters passed via `--args`: per-intent values that vary every fulfillment — `intent_addr`, `intent_id` / `intent_id_bytes`, `payment_amount` (inflow), `provided_metadata` + `provided_amount` (outflow). The `solver: signer` is implicit from the tx sender, not an arg.

## Open design questions carried forward

1. (C1) Whether programmable outflow needs a new intent argument type that carries delivery post-condition spec.

Item C1 is a design call that plan 1 implementation must close before step 3 lands.
