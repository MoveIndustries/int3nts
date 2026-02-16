# Conception - Router Flow

This document describes the Router Flow (Connected Chain → Connected Chain). For general concepts, actors, and terminology, see [conception_generic.md](conception_generic.md).

## Use cases

For general use cases applicable to all flows, see [conception_generic.md](conception_generic.md). This section focuses on router-flow-specific use cases.

### Users (Requester)

- As a requester, I want to swap some USDcon from one connected chain to another connected chain so that I get my USDcon on the destination chain fast and with low fee.

## Protocol

```mermaid
sequenceDiagram
    participant Requester
    participant SourceChain as Source Connected Chain
    participant Hub as Hub Chain
    participant IntegratedGMP as Integrated-GMP
    participant DestChain as Destination Connected Chain
    participant Solver

    Note over Requester,Solver: Off-chain negotiation
    Requester->>Requester: Create draft intent
    Requester->>Solver: Send draft
    Solver->>Solver: Solver signs (off-chain)
    Solver->>Requester: Returns signature

    Note over Requester,Solver: Intent creation on Hub + GMP to both chains
    Requester->>Hub: Create reserved intent
    Hub->>IntegratedGMP: GMP: IntentRequirements (to source)
    IntegratedGMP->>SourceChain: Deliver IntentRequirements (escrow params)
    Hub->>IntegratedGMP: GMP: IntentRequirements (to destination)
    IntegratedGMP->>DestChain: Deliver IntentRequirements (fulfillment params)

    Note over Requester,Solver: Escrow on Source Connected Chain (validated on-chain)
    Requester->>SourceChain: Create escrow (validated against GMP-delivered requirements)
    SourceChain->>IntegratedGMP: GMP: EscrowConfirmation
    IntegratedGMP->>Hub: Deliver EscrowConfirmation

    Note over Requester,Solver: Solver fulfillment on Destination Connected Chain (validated on-chain)
    Solver->>DestChain: Call validation contract (fulfillIntent)
    DestChain->>DestChain: Validate against GMP-delivered requirements
    DestChain->>IntegratedGMP: GMP: FulfillmentProof
    IntegratedGMP->>Hub: Deliver FulfillmentProof

    Note over Requester,Solver: Hub sends fulfillment proof to source chain
    Hub->>IntegratedGMP: GMP: FulfillmentProof (to source)
    IntegratedGMP->>SourceChain: Deliver FulfillmentProof

    Note over Requester,Solver: Escrow auto-release + collateral release
    SourceChain->>SourceChain: Auto-release escrow to reserved solver
    Hub->>Hub: Release collateral
```

## Scenarios

### Requester makes a router-flow swap intent

0. Given the requester
   - owns the USDcon that they want to transfer on source connected chain
   - owns some MOVE to execute Tx on M1 chain
   - can access both connected chains and M1 chain RPC

1. When the requester wants to realize a swap from source connected chain to destination connected chain
   - then the requester requests a signed quote from a solver for the intent
   - then the requester sends a request-intent Tx to the M1 chain
   - then the requester sends a Tx to source connected chain to transfer the needed USDcon + total fees to an escrow
   - then the requester waits for a confirmation of the swap
   - then the requester has received the requested amount of USDcon in their destination connected chain account.

#### Possible issues (Requester)

1. The requester initial escrow transfer is too little or too much.
    - _Mitigation: The solver verifies that the escrow transfer amount is the same as the request-intent offered amount before transferring the funds on the destination connected chain. Alternatively, the solver queries integrated-gmp which verifies that the escrow transfer amount is the same as the request-intent offered amount and informs the solver._
2. The requester didn't get the right expected amount of USDcon on the destination connected chain.
    - _Mitigation: The validation contract on the destination chain validates the transfer against GMP-delivered IntentRequirements on-chain. The fulfillment reverts if amounts don't match._
3. The escrow deposit on the source connected chain fails. How can the requester withdraw their tokens?
    - _Mitigation: The escrow eventually times out and the requester can withdraw their tokens._
4. The requester reuses a Tx already attached to another intent.
    - _Mitigation: The escrow contains the `intent_id`, ensuring each escrow is linked to a unique intent._

### Solver resolves a router-flow swap intent

0. Given the solver
   - is registered in the solver registry on Hub chain
   - owns enough USDcon on the destination connected chain
   - can access all chains' RPC

1. When the requester creates a draft intent and sends it to the solver
   - Then the solver signs the draft intent off-chain and returns signature

2. When the requester creates the reserved request-intent on Hub chain
   - Then the solver observes the request-intent event
   - Then the solver observes the escrow event on source connected chain
   - Then the solver calls the validation contract on the destination connected chain (fulfillIntent)
   - Then the validation contract sends a GMP FulfillmentProof to the hub
   - Then the hub sends a GMP FulfillmentProof to the source chain, auto-releasing the escrow

#### Possible issues (Solver)

- The solver doesn't send the right amount of desired tokens to the requester on destination chain.
  - _Mitigation: The validation contract on the destination chain validates the transfer against GMP-delivered IntentRequirements on-chain. The fulfillment reverts if amounts don't match._
- The solver doesn't receive the correct amount from escrow on source connected chain.
  - _Mitigation: The escrow contract validates the deposit against GMP-delivered IntentRequirements on-chain. Escrow creation reverts if amounts don't match._
- The solver is not notified of new request-intent events.
  - _Mitigation: Coordinator monitors intent events and can be queried by the solver._
- The solver attempts to fulfill an intent that wasn't reserved for them.
  - _Mitigation: The validation contract checks that msg.sender matches the authorized solver from GMP-delivered IntentRequirements._
- The solver provides the wrong token type on destination connected chain.
  - _Mitigation: The validation contract validates the token against GMP-delivered IntentRequirements on-chain. The fulfillment reverts if the token type is incorrect._
- The GMP FulfillmentProof is not delivered.
  - _Mitigation: Escrow remains locked until a valid GMP FulfillmentProof is delivered or the escrow expires. On-chain expiry handles stuck intents._

### The requester is adverse

0. Given the adversary takes the requester role to do a swap
1. When the adversary wants to extract more funds than the adversary has provided on the source connected chain
   - Then the adversary sends a request-intent Tx to the M1 chain.
   - Then the adversary sends a Tx to the source connected chain that transfers too little USDcon token to an escrow.
   - Then the adversary hopes to get more USDcon on the destination chain than they have provided.
      - _Mitigation: The escrow contract validates the deposit against GMP-delivered IntentRequirements on-chain. Escrow creation reverts if amounts don't match._
2. When the adversary attempts to stall the intent, holding solver funds hostage.
   - Then the adversary submits a reserved request-intent on Hub chain
   - Then the adversary takes no action
      - _Mitigation: The request-intent is protected by a timeout mechanism. After timeout, the request-intent is cancelled and the solver has no obligation to fulfill the request-intent any longer._

### The solver is adverse

0. Given the adversary takes the solver role to resolve an intent
1. When the adversary attempts to transfer less than the desired amount on the destination connected chain
   - Then the adversary reserves the request-intent
   - Then the adversary transfers less funds than expected to the requester account on the destination connected chain.
   - Then the adversary hopes that the escrow is released.
      - _Mitigation: The validation contract on the destination chain validates the transfer amount and type against GMP-delivered IntentRequirements on-chain. The fulfillment reverts if amount or type is incorrect._
2. When the adversary attempts to stall the request-intent.
   - Then the adversary reserves the request-intent
   - Then the adversary takes no action
      - _Mitigation: The request-intent and the escrow are protected by a timeout mechanism. After timeout, the request-intent and escrow are cancelled and the funds are returned to the requester._

## Error Cases

- **Source escrow amount mismatch**: Escrow on the source connected chain does not match the GMP-delivered IntentRequirements; escrow creation reverts.
- **Destination fulfillment mismatch**: Transfer amount, recipient, or token metadata on the destination chain does not match the GMP-delivered IntentRequirements; validation contract reverts the fulfillment.
- **GMP message not delivered**: Integrated-gmp relay fails to deliver a message; on-chain expiry handles stuck intents.
- **Timeouts across legs**: Escrow or intent expires before the remaining leg completes; remaining actions must cancel or wait for expiry refund.

## Protocol steps details

Steps 1-3 are generic to all flows. See [conception_generic.md](conception_generic.md#generic-protocol-steps) for details.

### 4) Requester deposit on source connected chain

Requester deposits on the source connected chain the offered amount + fee token to an escrow contract. Deposit needs to be tracked by integrated-gmp.
The requester calls the smart contract with the amount of token to swap + the pre-calculated fee.
The contract:

- verify the fee amount
- transfer the amount + fee token to the escrow pool
- use the `intent_id` (from step 3) to associate the escrow with the request-intent
- save the association with the `intent_id` and the swap amount in a table.

The `intent_id` allows to associate the request-intent with a transfer/escrow on the connected chains to verify that the requester has provided the escrow.

### 5) Solver detects and verifies escrow

The solver monitors escrow events on the source connected chain to detect when the requester has deposited funds. The solver verifies that the requester has transferred the correct funds to the escrow and that the intent's data are consistent.

Alternatively, the coordinator monitors the escrow events and the solver can query the coordinator.

### 6) Solver fulfills on destination connected chain

The solver transfers the desired amount to the requester on the destination connected chain.

To verify the Solver transfer, integrated-gmp needs a proof. We can use the transfer Tx as proof, but we need to have a way to validate that the Tx hasn't been executed for another purpose. For this purpose, we add the `intent_id` to the transfer Tx as metadata. Or we develop a specific function that does the transfer and links it to the intent.

### 7) Validation contract validates and sends GMP FulfillmentProof

The validation contract on the destination connected chain validates the solver's fulfillment on-chain:

1. **Requirements check**: Validates that GMP-delivered IntentRequirements exist for the `intent_id`.

2. **Fulfillment validation**: Validates that the solver is the authorized solver, the amount matches, and the token matches the stored requirements.

3. **Token transfer**: Pulls tokens from the solver via `transferFrom`, forwards to the requester's wallet.

After successful validation, the contract sends a GMP FulfillmentProof message to the hub chain.

### 8) Hub receives FulfillmentProof and forwards to source chain

The hub receives the GMP FulfillmentProof from the destination chain. The hub forwards a GMP FulfillmentProof to the source connected chain.

### 9) Escrow auto-release on source connected chain

The source chain receives the GMP FulfillmentProof and auto-releases the escrow. The offered amount + solver fee is transferred to the solver account.

(Optional) Deducts fixed protocol fee → Treasury.

### 10) Collateral release and intent closed

The solver's collateral is released on the Hub chain. The intent is marked as closed on-chain.
