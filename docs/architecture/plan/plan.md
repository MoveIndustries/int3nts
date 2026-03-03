# Fees Implementation Plan (Inflow Only)

## Context

The int3nts cross-chain intent framework currently has no fee handling. We need to add a fee mechanism where:

- **Fee is embedded in the exchange rate** — the user gets fewer desired tokens; no separate fee transfer
- **Fees are only tracked on the hub** — no changes to connected chain escrows, GMP messages, or connected chain contracts
- **GMP costs are paid by tx issuers** (gas), not through the intent fee system

**Fee formula (computed by frontend):**

```text
total_fee = solver_min_fee + ceil(offered_amount * solver_fee_bps / 10000)
```

The fee reduces the `desired_amount` the user receives. The solver's profit is the spread.

**Scope:** Inflow only (Connected Chain → Hub). Outflow in a follow-up PR.

## Step 1: Documentation

- Create `docs/architecture/rates_and_fees.md` documenting the fee model
- Update `docs/architecture/conception/architecture-diff.md` — mark "Protocol fee deduction" as in-progress for inflow

## Step 2: Hub Intent — Add `fee_in_offered_token` to FALimitOrder

File: `intent-frameworks/mvm/intent-hub/sources/fa_intent.move`

- Add `fee_in_offered_token: u64` to `FALimitOrder` struct
- Add getter: `get_fee_in_offered_token(order): u64`
- Add `fee_in_offered_token: u64` to `LimitOrderEvent`
- Update `create_fa_to_fa_intent()` — accept `fee_in_offered_token` param, store it, emit it
- Update `create_fa_to_fa_intent_entry()` — accept `fee_in_offered_token` param, pass through

## Step 3: Intent Reservation — Include `fee_in_offered_token` in Signature

File: `intent-frameworks/mvm/intent-hub/sources/intent_reservation.move`

- Add `fee_in_offered_token: u64` to `Draftintent`
- Add `fee_in_offered_token: u64` to `IntentToSign`
- Add `fee_in_offered_token: u64` to `IntentToSignRaw`
- Update `new_intent_to_sign()` and `new_intent_to_sign_raw()` constructors
- Solver signs over `fee_in_offered_token` — prevents fee manipulation after signing

## Step 4: Inflow Intent Creation — Pass `fee_in_offered_token` Through

File: `intent-frameworks/mvm/intent-hub/sources/fa_intent_inflow.move`

- `create_inflow_intent()`: add `fee_in_offered_token: u64` param
- Pass `fee_in_offered_token` to `intent_reservation::new_intent_to_sign_raw()` for signature verification
- Pass `fee_in_offered_token` to `fa_intent::create_fa_to_fa_intent()`
- `create_cross_chain_draft_intent()`: add `fee_in_offered_token` param if applicable
- No changes to GMP message sending — `IntentRequirements` stays at 145 bytes

## Step 5: Solver Service — Fee Configuration and Advertisement

### Config (`solver/src/config.rs`)

Add to `TokenPairConfig`:

- `min_fee: u64` — minimum fee in smallest token units (covers gas costs)
- `fee_bps: u64` — fee in basis points, e.g. 50 = 0.5% (covers opportunity cost)

Add validation: `fee_bps <= 10000`.

### API (`solver/src/api.rs`)

Add to `ExchangeRateResponse`:

- `min_fee: u64`
- `fee_bps: u64`

Return fee params from `/acceptance` endpoint.

### Acceptance (`solver/src/acceptance.rs`)

Add `fee_in_offered_token: u64` to `DraftintentData`. Update `evaluate_draft_acceptance()`:

```text
required_fee = min_fee + ceil(offered_amount * fee_bps / 10000)
if fee_in_offered_token < required_fee → Reject
```

## Step 6: Frontend — Fee Calculation and Display

### Types (`frontend/src/lib/types.ts`)

Add `fee_in_offered_token: string` to `DraftIntentRequest.draft_data`.

### Coordinator client (`frontend/src/lib/coordinator.ts`)

Update `getExchangeRate()` response type to include `min_fee` and `fee_bps`.

### IntentBuilder (`frontend/src/components/intent/IntentBuilder.tsx`)

- Fetch solver fee params (`min_fee`, `fee_bps`) from coordinator/solver API
- Calculate: `total_fee = solver_min_fee + ceil(offered_amount * solver_fee_bps / 10000)`
- Compute: `desired_amount = (offered_amount - total_fee) * exchange_rate`
- Display fee breakdown to user before confirmation
- Include `fee_in_offered_token` in draft intent request

### Move transactions (`frontend/src/lib/move-transactions.ts`)

Pass `fee_in_offered_token` to `create_inflow_intent` entry function call.

## Steps 7-9: Update Tests

- **MVM hub tests**: verify `fee_in_offered_token` stored, emitted, and included in signature
- **Solver tests**: config validation, API response, acceptance logic
- **Frontend tests**: fee calculation, display, and draft intent fields

## Files Summary

**Hub contracts (modify):**

- `intent-frameworks/mvm/intent-hub/sources/fa_intent.move`
- `intent-frameworks/mvm/intent-hub/sources/fa_intent_inflow.move`
- `intent-frameworks/mvm/intent-hub/sources/intent_reservation.move`

**Solver (modify):**

- `solver/src/config.rs`
- `solver/src/api.rs`
- `solver/src/acceptance.rs`

**Frontend (modify):**

- `frontend/src/lib/types.ts`
- `frontend/src/lib/coordinator.ts`
- `frontend/src/components/intent/IntentBuilder.tsx`
- `frontend/src/lib/move-transactions.ts`

**Docs (create/modify):**

- `docs/architecture/plan/plan.md` (create)
- `docs/architecture/rates_and_fees.md` (create)
- `docs/architecture/conception/architecture-diff.md` (update)

**NOT modified:**

- Connected chain escrows (MVM/EVM/SVM) — unchanged
- GMP messages — unchanged (wire format stays 145 bytes)
- Coordinator — passes `draft_data` as JSON, no structural changes needed
- integrated-gmp relay — unchanged

## Verification

```bash
# MVM hub tests
./intent-frameworks/mvm/scripts/test.sh

# Solver tests
RUST_LOG=off nix develop ./nix -c bash -c "cd solver && cargo test --quiet"

# Frontend tests
nix develop ./nix -c bash -c "cd frontend && npm install --legacy-peer-deps && npm test"

# E2E inflow (after all changes)
nix develop ./nix -c bash -c "./testing-infra/ci-e2e/e2e-tests-mvm/run-tests-inflow.sh"
```
