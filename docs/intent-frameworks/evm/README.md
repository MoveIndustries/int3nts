# EVM Intent Framework

Escrow contract for cross-chain intents that releases funds to solvers when integrated-gmp signatures check out.

## Overview

The `IntentInflowEscrow` contract implements a secure escrow system:

- Requesters deposit ERC20 tokens into escrows tied to intent IDs
- Solvers can claim funds after providing a valid integrated-gmp signature
- The integrated-gmp service signs approval messages off-chain after verifying cross-chain conditions
- Requesters can cancel and reclaim funds after expiry

## Architecture

ECDSA signature verification similar to the Aptos escrow system.

Flow:

1. Requester creates escrow and deposits funds atomically (must specify solver address)
2. Integrated-gmp service monitors conditions and signs approval (off-chain)
3. Anyone can claim with integrated-gmp signature (funds go to reserved solver)
4. Requester can cancel and reclaim after expiry

## Signature Verification

The integrated-gmp service signs the `intent_id` - the signature itself is the approval.

Message format:

```text
messageHash = keccak256(intentId)
ethSignedMessage = keccak256("\x19Ethereum Signed Message:\n32" || messageHash)
```

The contract uses `ecrecover()` to verify the signature matches the authorized integrated-gmp address.

## Contract Interface

### Functions

```solidity
// Create an escrow and deposit funds atomically (expiry is contract-defined)
// reservedSolver: Required solver address that will receive funds (must not be address(0))
function createEscrow(uint256 intentId, address token, uint256 amount, address reservedSolver) external

// Claim funds with approver signature
// Funds always go to reservedSolver address (anyone can send transaction, but recipient is fixed)
// Signature itself is the approval - approver signs the intent_id
function claim(uint256 intentId, bytes memory signature) external

// Cancel escrow and reclaim funds (requester only, after expiry)
function cancel(uint256 intentId) external

// Get escrow data
function getEscrow(uint256 intentId) external view returns (address, address, uint256, bool, uint256, address)
```

### Events

- `EscrowInitialized(uint256 indexed intentId, address indexed escrow, address indexed requester, address token, address reservedSolver)`
- `DepositMade(uint256 indexed intentId, address indexed requester, uint256 amount, uint256 total)` - `requester` is the requester who created the escrow
- `EscrowClaimed(uint256 indexed intentId, address indexed recipient, uint256 amount)`
- `EscrowCancelled(uint256 indexed intentId, address indexed requester, uint256 amount)`

## Quick Start

See the [component README](../../intent-frameworks/evm/README.md) for quick start commands.

## Usage Example

```javascript
const { ethers } = require("hardhat");

// Deploy escrow with approver address
const IntentInflowEscrow = await ethers.getContractFactory("IntentInflowEscrow");
const escrow = await IntentInflowEscrow.deploy(approverAddress);

// Requester creates escrow and deposits tokens atomically (expiry is contract-defined)
// Must specify solver address that will receive funds:
await token.connect(requester).approve(escrow.address, amount);
await escrow.connect(requester).createEscrow(intentId, tokenAddress, amount, solverAddress);

// Approver signs the intent_id (off-chain) - signature itself is the approval
const messageHash = ethers.solidityPackedKeccak256(
  ["uint256"],
  [intentId]
);
const signature = await approver.signMessage(ethers.getBytes(messageHash));

// Solver claims with signature (anyone can call, but funds go to reserved solver)
await escrow.connect(solver).claim(intentId, signature);
```

## Security Considerations

- Signature verification: Only authorized integrated-gmp signatures accepted
- Intent ID binding: Prevents signature replay across escrows
- Reentrancy protection: Uses OpenZeppelin's SafeERC20
- Access control: Only requester can cancel (after expiry)
- Immutable integrated-gmp address: Integrated-gmp address set in constructor
- Solver reservation: Required at creation, prevents unauthorized recipients

## Testing

```bash
npx hardhat test
```

Tests cover escrow initialization, deposits, claiming, cancellation, expiry enforcement, and error cases.

Test accounts: Hardhat provides 20 accounts (10000 ETH each). Account 0 is deployer/approver, Account 1 is requester, Account 2 is solver. Private keys are deterministic from mnemonic: `test test test test test test test test test test test junk`
