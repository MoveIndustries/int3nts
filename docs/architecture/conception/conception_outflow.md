# Conception - Outflow Flow

This document describes the Outflow flow (Hub → Connected Chain). For general concepts, actors, and terminology, see [conception_generic.md](conception_generic.md).

## Use cases

For general use cases applicable to all flows, see [conception_generic.md](conception_generic.md). This section focuses on outflow-specific use cases.

### Users (Requester)

- As a requester, I want to swap some USDhub from M1 chain to a connected chain so that I get my USDcon on the connected chain fast and with low fee.

## Protocol

```mermaid
sequenceDiagram
    participant Requester
    participant Hub as Hub Chain
    participant IntegratedGMP as Integrated-GMP
    participant Connected as Connected Chain
    participant Solver

    Note over Requester,Solver: Off-chain negotiation
    Requester->>Requester: Create draft intent
    Requester->>Solver: Send draft
    Solver->>Solver: Solver signs (off-chain)
    Solver->>Requester: Returns signature

    Note over Requester,Solver: Intent creation on Hub + GMP to Connected
    Requester->>Hub: Create reserved intent with escrow (locks tokens)
    Hub->>IntegratedGMP: GMP: IntentRequirements
    IntegratedGMP->>Connected: Deliver IntentRequirements (recipient, amount, token, solver)

    Note over Requester,Solver: Solver fulfillment on Connected Chain (validated on-chain)
    Solver->>Connected: Call validation contract (fulfillIntent)
    Connected->>Connected: Validate against GMP-delivered requirements
    Connected->>Connected: Pull tokens from solver, forward to requester
    Connected->>IntegratedGMP: GMP: FulfillmentProof
    IntegratedGMP->>Hub: Deliver FulfillmentProof

    Note over Requester,Solver: Escrow auto-release on Hub
    Hub->>Hub: Auto-release escrow to solver + release collateral
```

## Scenarios

### Requester makes an outflow swap intent

0. Given the requester
   - owns the USDhub that they want to transfer on M1 chain
   - owns some MOVE to execute Tx on M1 chain
   - can access the connected chain and M1 chain RPC
1. When the requester wants to realize a swap from M1 chain to connected chain
   - then the requester requests a signed quote from a solver for the desired intent
   - then the requester sends a request-intent Tx to the M1 chain with escrow (locks tokens on Hub)
   - then the requester waits for a confirmation of the swap
   - then the requester has received the requested amount of USDcon in their connected chain account.

#### Possible issues (Requester)

1. The requester didn't get the right expected amount of USDcon on connected chain.
    - _Mitigation: The validation contract on the connected chain validates the transfer against GMP-delivered IntentRequirements on-chain. The fulfillment reverts if amounts don't match._
2. The solver never fulfills on connected chain. How can the requester withdraw their tokens?
    - _Mitigation: The escrow on Hub eventually times out and the requester can withdraw their tokens._

### Solver resolves an outflow swap intent

0. Given the solver
   - is registered in the solver registry on Hub chain
   - owns some MOVE to execute Tx on M1 chain
   - owns enough USDcon on the connected chain
   - can access both chains' RPC
1. When the requester creates a draft intent and sends it to the solver
   - Then the solver signs the draft intent off-chain and returns signature
2. When the requester creates the reserved request-intent with escrow on Hub chain
   - Then the solver observes the request-intent event
   - Then the solver calls the validation contract on the connected chain (fulfillIntent)
   - Then the validation contract sends a GMP FulfillmentProof to the hub
   - Then the hub auto-releases the escrow to the solver

#### Possible issues (Solver)

- The solver doesn't send the right amount of desired tokens to the requester on the desired connected chain.
  - _Mitigation: The validation contract on the connected chain validates the transfer against GMP-delivered IntentRequirements on-chain. The fulfillment reverts if amounts don't match._
- The solver doesn't receive the correct amount from escrow on Hub chain.
  - _Mitigation: The request-intent is created with the correct offered amount. If the amount is incorrect the request-intent will fail to be created. This is also protected on contract side through checking the signature of the solver._
- The solver is not notified of new request-intent events.
  - _Mitigation: Coordinator monitors intent events and can be queried by the solver._
- The solver attempts to fulfill an intent that wasn't reserved for them.
  - _Mitigation: The contract rejects the fulfillment if the intent is not reserved for the solver._
- The solver provides the wrong token type on connected chain.
  - _Mitigation: The validation contract on the connected chain validates the token against GMP-delivered IntentRequirements on-chain. The fulfillment reverts if the token type is incorrect._
- The GMP FulfillmentProof is not delivered to the hub.
  - _Mitigation: Hub escrow remains locked until a valid GMP FulfillmentProof is delivered or the escrow expires. On-chain expiry handles stuck intents._

### The requester is adverse

0. Given the adversary takes the requester role to do a swap
1. When the adversary wants to extract more funds than the adversary has provided
   - Then the adversary sends a request-intent Tx to the M1 chain with less tokens in escrow than declared.
   - Then the adversary hopes to get more USDcon on the connected chain than they have provided on the hub.
   - _Mitigation: The escrow amount is locked at request-intent creation. The contract enforces the offered amount._
2. When the adversary attempts to stall the request-intent holding solver funds hostage.
   - Then the adversary creates the intent
   - Then the adversary takes no action
   - _Mitigation: The solver observes the request-intent event before fulfilling on the desired connected chain. If the requester doesn't create the request-intent, the solver simply doesn't fulfill._

### The solver is adverse

0. Given the adversary takes the solver role to resolve an intent
1. When the adversary attempts to transfer less than the desired amount
   - Then the adversary reserves the request-intent
   - Then the adversary transfers less funds than expected to the requester account on connected chain.
   - Then the adversary hopes that the escrow is released.
   - _Mitigation: The validation contract on the connected chain validates the transfer amount and type against GMP-delivered IntentRequirements on-chain. The fulfillment reverts if amount or type is incorrect._
2. When the adversary attempts to stall the request-intent.
   - Then the adversary reserves the request-intent
   - Then the adversary takes no action
   - _Mitigation: The request-intent is protected by a timeout mechanism. After timeout, the request-intent is cancelled and the funds are returned to the requester._

## Error Cases

- **Connected-chain fulfillment failure**: Solver call to validation contract fails or reverts; no GMP FulfillmentProof is sent, hub escrow remains locked until expiry.
- **Transfer mismatch**: Transfer amount, recipient, or token metadata does not match the GMP-delivered IntentRequirements; validation contract reverts the fulfillment.
- **GMP message not delivered**: Integrated-gmp relay fails to deliver a message; on-chain expiry handles stuck intents.
- **Expiry reached**: Hub escrow cannot be released after expiry; requester can cancel instead.

## Protocol steps details

Steps 1-3 are generic to all flows. See [conception_generic.md](conception_generic.md#generic-protocol-steps) for details. Apart from step 3, which in addition to the generic steps, adds the following step 3a).

### 3a) Requester locks offered amount on Hub chain

The request-intent serves a dual purpose: it is the intent to be fulfilled and it is the escrow for the offered amount + fee tokens.
The request-intent is created with the correct offered amount + fee tokens.

### 5) Solver detects and verifies intent

The solver monitors request-intent events on Hub chain to detect when the requester has created the request-intent. The solver verifies that the requester has locked the correct funds in the request-intent and that the intent is reserved for the solver.

Alternatively, the coordinator monitors the intent events and the solver can query the coordinator.

### 6) Solver fulfills on connected chain

The solver transfers the desired amount to the requester on the connected chain.

The solver calls the validation contract's `fulfillIntent` function, which validates the fulfillment against GMP-delivered IntentRequirements, pulls tokens from the solver, forwards them to the requester, and sends a GMP FulfillmentProof to the hub.

### 7) Validation contract validates and sends GMP FulfillmentProof

The validation contract on the connected chain validates the solver's fulfillment on-chain:

1. **Requirements check**: Validates that GMP-delivered IntentRequirements exist for the `intent_id`.

2. **Fulfillment validation**: Validates that the solver is the authorized solver, the amount matches, and the token matches the stored requirements.

3. **Token transfer**: Pulls tokens from the solver via `transferFrom`, forwards to the requester's wallet.

After successful validation, the contract sends a GMP FulfillmentProof message to the hub chain.

### 8) Hub receives FulfillmentProof and auto-releases escrow

The hub receives the GMP FulfillmentProof from the connected chain. The escrow auto-releases: offered amount + solver fee is transferred to the solver account, and collateral is released.

(Optional) Deducts fixed protocol fee → Treasury.

### 9) Intent closed

The intent is marked as closed on-chain when the escrow is released.
