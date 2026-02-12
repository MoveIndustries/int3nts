# GMP Architecture Integration Design

**Status:** Draft
**Date:** 2026-01-28
**Purpose:** Map out exactly how GMP messaging (via integrated GMP relay, with LZ v2-compatible interfaces) replaces integrated-gmp signatures in our existing architecture.

---

## Current System Summary

Today, cross-chain approval works like this:

```text
Integrated-GMP (off-chain) validates → Signs intent_id → Contract checks signature → Releases funds
```

The integrated-gmp service holds private keys (Ed25519 + ECDSA) and generates approval signatures. Contracts on each chain verify these signatures before releasing funds.

**Key contracts:**

- **MVM Hub**: `fa_intent_outflow.move`, `fa_intent_inflow.move`, `intent_escrow.move`
- **SVM Connected**: `intent_escrow` program (escrow with Ed25519 signature verification)
- **EVM Connected**: `IntentInflowEscrow.sol` (escrow with ECDSA signature verification)

**Signature as approval:**

- MVM: Ed25519 signature over BCS-encoded `intent_id`
- SVM: Ed25519 signature over raw 32-byte `intent_id`
- EVM: ECDSA signature over `keccak256(abi.encodePacked(intentId))`

---

## GMP Replacement: What Changes

With GMP, the approval mechanism changes from **"integrated-gmp signs intent_id"** to **"on-chain contract receives GMP message confirming the cross-chain action"**.

```text
Before: Integrated-GMP signs → Contract verifies signature
After:  Source contract sends GMP message → Destination contract receives and acts
```

### What Moves On-Chain

| Currently in Integrated-GMP | Moves to | How |
|--------------------------|----------|-----|
| Inflow: validate escrow matches intent | Connected chain escrow contract | Contract validates requirements received via GMP before allowing escrow creation |
| Inflow: approve escrow release after hub fulfillment | Hub intent contract | Hub sends GMP message to connected chain on fulfillment → escrow auto-releases |
| Outflow: validate connected chain transfer | Connected chain validation contract | New contract validates solver's transfer and sends GMP confirmation to hub |
| Outflow: approve hub intent release | Hub intent contract | Hub receives GMP fulfillment proof → auto-releases locked tokens |
| Signature generation (Ed25519/ECDSA) | Eliminated | GMP message authentication replaces signatures |

### What Stays Off-Chain

| Component | Stays because |
|-----------|--------------|
| Coordinator event monitoring (hub only) | UX only, not security-critical. Hub has full state via GMP messages. |
| Coordinator negotiation API | Application logic, not security-critical |
| Coordinator event caching | Convenience, not security-critical |
| Integrated-GMP (local/CI only) | Relays GMP messages via integrated GMP endpoints |

---

## Message Flow Diagrams

### Outflow: Hub → Connected Chain

**Current flow (integrated-gmp signs):**

```text
1. Hub: Requester creates outflow intent (locks tokens)
         → emits OracleLimitOrderEvent
2. Solver: Sees intent via coordinator
3. Connected: Solver does arbitrary transfer to requester
              (ERC20 transfer / SPL transfer / FA transfer)
              Includes intent_id in tx metadata
4. Solver: Calls POST /validate-outflow-fulfillment on integrated-gmp
5. Integrated-GMP: Queries tx, validates (recipient, amount, token, solver)
6. Integrated-GMP: Signs intent_id → returns signature
7. Hub: Solver calls fulfill_outflow_intent(signature)
        → hub verifies signature, releases locked tokens to solver
```

**GMP flow (all environments):**

```text
1. Hub: Requester creates outflow intent (locks tokens)
        → contract calls lzSend() with IntentRequirements message
        → message contains: intent_id, recipient, amount, token, authorized_solver

2. Connected: Validation contract receives IntentRequirements via lzReceive()
              → stores requirements in state (keyed by intent_id)

3. Connected: Authorized solver calls validationContract.fulfillIntent(intent_id, token, amount)
              Within this single solver-initiated transaction:
              a. Token transfer executes:
                 → EVM: solver calls approve(validationContract, exactAmount) beforehand,
                   fulfillIntent() executes transferFrom
                 → SVM: solver signs the transaction, program executes CPI transfer
                   using solver's signer authority
              b. Contract validates: amount, token, solver match stored requirements
              c. Contract forwards tokens to requester address
              d. Contract calls lzSend() with FulfillmentProof message

4. Hub: Intent contract receives FulfillmentProof via lzReceive()
        → validates intent_id exists and is active
        → releases locked tokens to solver
        → deletes intent
```

**Key differences:**

- Solver no longer does arbitrary transfer; must call validation contract
- Solver actively initiates the token transfer (EVM: approve exact amount + transferFrom; SVM: signer authority, no approval needed)
- No off-chain signature needed; GMP message IS the proof
- Hub release is automatic on GMP message receipt

### Inflow: Connected Chain → Hub

**Current flow (integrated-gmp signs):**

```text
1. Hub: Requester creates inflow intent
        → emits LimitOrderEvent
2. Connected: Requester creates escrow (locks tokens, reserved for solver)
              → emits EscrowInitialized
3. Hub: Solver calls fulfill_inflow_intent()
        → provides desired tokens to requester on hub
        → emits LimitOrderFulfillmentEvent
4. Integrated-GMP: Monitors hub fulfillment event
5. Integrated-GMP: Validates escrow matches intent (amount, token, solver, chain)
6. Integrated-GMP: Signs intent_id → caches signature
7. Connected: Solver calls escrow.claim(signature)
              → escrow verifies signature, releases to reserved_solver
```

**GMP flow (all environments):**

```text
1. Hub: Requester creates inflow intent
        → contract calls lzSend() with IntentRequirements message
        → message contains: intent_id, required_amount, required_token, authorized_solver

2. Connected: Escrow contract receives IntentRequirements via lzReceive()
              → stores requirements in state (keyed by intent_id)

3. Connected: Requester creates escrow
              → contract validates requirements exist for this intent_id
              → contract validates escrow params match requirements
              → reverts if no requirements or mismatch
              → escrow created, tokens locked
              → contract calls lzSend() with EscrowConfirmation message

4. Hub: Intent contract receives EscrowConfirmation via lzReceive()
        → marks intent as escrow-confirmed (enables fulfillment)

5. Hub: Solver calls fulfill_inflow_intent()
        → provides desired tokens to requester
        → contract calls lzSend() with FulfillmentProof message

6. Connected: Escrow contract receives FulfillmentProof via lzReceive()
              → automatically releases escrowed tokens to reserved_solver
```

**Key differences:**

- Escrow creation now validated on-chain (requirements received via GMP)
- Hub fulfillment gated on escrow confirmation (prevents solver fulfilling without escrow)
- Escrow release is automatic on GMP fulfillment proof receipt
- No off-chain signature needed

### Message Handling

These apply to all `lzReceive()` handlers in both flows:

- **Idempotency**: Each message carries intent_id + step number. If state is already updated for that step, the duplicate is ignored.
- **Ordering**: Step numbers enforce ordering — step N can only be processed if step N-1 is complete.
- **Failure/timeout**: Existing expiry mechanisms handle incomplete flows. Intent/escrow expires, requester cancels and recovers funds.

---

## Integration Points: Existing Contracts

### MVM Hub Contracts

**`fa_intent_outflow.move`** - Needs GMP hooks:

- `create_outflow_intent()`: After creating intent, call `lzSend()` with `IntentRequirements`
- New: `receive_fulfillment_proof()`: Called by `lzReceive()`, releases locked tokens to solver
- `fulfill_outflow_intent()`: Remove signature verification; release now handled by `receive_fulfillment_proof()`
- `ApproverConfig`: Replace approver public key with GMP endpoint address

**`fa_intent_inflow.move`** - Needs GMP hooks:

- `create_inflow_intent()`: After creating intent, call `lzSend()` with `IntentRequirements`
- New: `receive_escrow_confirmation()`: Called by `lzReceive()`, marks intent as escrow-confirmed
- `fulfill_inflow_intent()`: Gate on escrow confirmation before allowing fulfillment; after fulfillment, call `lzSend()` with `FulfillmentProof`

**`intent_inflow_escrow.move`** (MVM as connected chain) - Needs GMP hooks:

- New: `receive_intent_requirements()`: Called by `lzReceive()`, stores requirements
- `create_escrow()`: Validate against stored requirements before allowing creation
- New: `receive_fulfillment_proof()`: Called by `lzReceive()`, auto-releases escrow
- `complete_escrow()`: Remove signature verification; release now handled by `receive_fulfillment_proof()`

**New: `gmp/intent_gmp.move`** - GMP endpoint (LZ v2-compatible interface):

- `lz_send()`: Encode and send message via integrated GMP endpoint (LZ-compatible naming)
- `lz_receive()`: Entry point called by relay via `deliver_message()`, dispatches to handlers
- Remote GMP endpoint verification

**Note:** The `intent_gmp.move` module listed above serves as both the LZ-compatible interface and the integrated GMP endpoint. `send()` emits `MessageSent` event, `deliver_message()` is called by the integrated GMP relay.

### SVM Connected Chain

**`intent_escrow` program** - Modify to use GMP:

- Add `lz_receive` instruction for requirements and fulfillment proof
- Add on-chain validation in `create_escrow`
- Remove signature verification in `claim`

**New: `outflow-validator` program** - For outflow validation:

- `lz_receive`: Stores intent requirements from hub
- `fulfill_intent`: Solver calls this; validates, transfers, sends GMP proof

**New: `integrated-gmp-endpoint` program** - Integrated GMP endpoint:

- `send`: Emits `MessageSent` event
- `deliver_message`: Integrated-GMP relays messages

### EVM Connected Chain

**`IntentInflowEscrow.sol`** - Modify to use GMP (same approach as SVM)

**New: `OutflowValidator.sol`** - For outflow validation
**New: `NativeGmpEndpoint.sol`** - Integrated GMP endpoint

### Decision: New Contracts vs Modify Existing

**Decision: Modify existing contracts to use GMP.** The signature-based approach is being fully replaced, not maintained alongside. There is no dual-mode support.

Rationale:

- Single code path — no mode flags or conditional logic
- Existing signature verification code gets removed, not preserved
- All environments (local/CI, testnet, mainnet) use the same GMP contract interface
- Local/CI uses integrated GMP endpoints with integrated-gmp for message relay

---

## Integrated-GMP Relay Design

The integrated GMP relay handles message delivery in all environments. It watches for `MessageSent` events on integrated GMP endpoints and delivers messages to destination chains.

### How It Works

```text
                    Local/CI Environment
┌──────────┐     ┌──────────────────────┐     ┌──────────┐
│  MVM Hub │     │   Integrated-GMP        │     │   SVM    │
│  (local  │────>│   Relay Mode         │────>│  (local  │
│   GMP    │     │                      │     │   GMP    │
│ endpoint)│<────│  Watches MessageSent  │<────│ endpoint)│
└──────────┘     │  Calls deliver_msg   │     └──────────┘
                 └──────────────────────┘
```

1. Contracts call `lzSend()` on integrated GMP endpoint
2. Integrated GMP endpoint emits `MessageSent` event (no real cross-chain)
3. Integrated-GMP polls for `MessageSent` events on all chains
4. Integrated-GMP calls `deliver_message()` on destination chain's integrated GMP endpoint
5. Integrated GMP endpoint calls `lzReceive()` on destination contract
6. Destination contract processes message normally

### Integrated-GMP Relay Requirements

- **Watches**: `MessageSent` events on integrated GMP endpoints (MVM, SVM, EVM)
- **Delivers**: Calls `deliver_message()` / `lzReceive()` on destination
- **Needs**: Funded operator wallet per chain (pays gas for delivery)
- **Config**: Chain RPCs, GMP endpoint addresses, operator keys
- **Mode**: `--mode relay` flag on integrated-gmp binary
- **Polling**: Configurable interval (default 500ms for fast CI)
- **Fidelity**: Minimal. Local endpoints emit events and deliver messages only — no DVN simulation, no fee calculation

### Relay Mode vs Current Integrated-GMP

| Aspect | Current Integrated-GMP | Relay Mode |
|--------|--------------------|----|
| **Watches** | Intent/escrow events | `MessageSent` events on integrated GMP endpoints |
| **Validates** | 15+ off-chain checks | None (contracts validate on-chain) |
| **Action** | Signs intent_id | Calls `deliver_message()` |
| **Keys needed** | Approver private key | Operator wallet (gas payment only) |
| **Can forge** | Approval signatures | GMP messages (same risk level) |

### Contracts Stay Identical

Contracts use the same GMP interface in all environments. Only the endpoint differs:

- **All environments**: Integrated GMP endpoint → Integrated GMP relay watches and delivers

```text
// Same contract code in all environments (LZ v2-compatible naming):
lz_send(endpoint, dst_chain_id, destination, payload);

// GMP endpoint is the integrated GMP endpoint address:
// All environments: <intent_gmp_address>
// Future LZ: swap to LZ endpoint address (config change only)
```

---

## Environment Matrix

| Environment | MVM Hub | SVM Connected | EVM Connected | GMP Delivery |
|-------------|---------|---------------|---------------|--------------|
| **Local/CI** | Integrated GMP endpoint | Integrated GMP endpoint | Integrated GMP endpoint | Integrated GMP relay |
| **Testnet** | Integrated GMP endpoint | Integrated GMP endpoint | Integrated GMP endpoint | Integrated GMP relay |
| **Mainnet** | Integrated GMP endpoint | Integrated GMP endpoint | Integrated GMP endpoint | Integrated GMP relay |

> **Note:** All environments use integrated GMP. Contracts follow LZ v2 conventions so that future LZ integration is a configuration change (swap endpoint address).

---

## What Triggers lzSend()?

This is a critical design question. In our current system, integrated-gmp is an external service that signs. With GMP, the contracts themselves must call `lzSend()`.

### Who Triggers Each Message

| Message | Direction | Triggered By | When |
|---------|-----------|--------------|------|
| `IntentRequirements` | Hub → Connected | Hub contract | On intent creation (`create_outflow_intent()` / `create_inflow_intent()`) |
| `EscrowConfirmation` | Connected → Hub | Connected escrow contract | On escrow creation (`create_escrow()`) |
| `FulfillmentProof` (outflow) | Connected → Hub | Connected validation contract | On solver fulfillment (`fulfill_intent()`) |
| `FulfillmentProof` (inflow) | Hub → Connected | Hub contract | On solver fulfillment (`fulfill_inflow_intent()`) |

**Key insight:** Every `lzSend()` is triggered by a user transaction (requester or solver). No external service needs to initiate messages. The contract logic calls `lzSend()` as part of its normal execution.

### Gas Costs

The caller of the transaction pays gas for `lzSend()`. This means:

- **Requester pays** for `IntentRequirements` (part of intent creation tx)
- **Requester pays** for `EscrowConfirmation` (part of escrow creation tx)
- **Solver pays** for `FulfillmentProof` (part of fulfillment tx)

With integrated GMP, there are no third-party GMP fees. The relay operator pays gas for delivery on the destination chain.

---

## Summary: Architecture with GMP

```text
ALL ENVIRONMENTS:
┌──────────────────┐      Integrated GMP Relay       ┌──────────────────┐
│    MVM Hub        │ ◄─── deliver_message ────► │  SVM/EVM         │
│  Intent contracts │                             │  Escrow/Validator │
│  + GMP endpoint   │                             │  + GMP endpoint   │
└──────────────────┘                             └──────────────────┘
        │
        │ Coordinator (read-only)
        │ Reads hub state only
        │ Event monitoring, UX
```

**What's eliminated (with GMP):**

- Off-chain approval signing (GMP messages replace signatures)
- Off-chain validation logic (moved on-chain)
- Approval key management (relay has gas wallets only, not approval authority)

**What remains in all environments:**

- Coordinator (event monitoring, negotiation, UX, readiness tracking)
  - Monitors IntentRequirementsReceived events on connected chains
  - Provides `ready_on_connected_chain` flag via API
  - Does NOT track full GMP message lifecycle (MessageSent/MessageDelivered)
- On-chain contracts (same code, different GMP endpoint config)
- Frontend / solver bots query coordinator API for readiness status instead of polling connected chains directly
