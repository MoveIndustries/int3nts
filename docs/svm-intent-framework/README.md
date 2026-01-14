# SVM Intent Framework

Escrow program for cross-chain intents on Solana that releases funds to solvers when verifier signatures check out.

## Overview

The `IntentEscrow` program implements a secure escrow system:

- Requesters deposit SPL tokens into escrows tied to intent IDs
- Solvers can claim funds after providing a valid verifier signature
- Verifiers sign approval messages off-chain after verifying cross-chain conditions
- Requesters can cancel and reclaim funds after expiry

## Architecture

Ed25519 signature verification similar to the Move/Aptos escrow system.

Flow:

1. Requester creates escrow and deposits funds atomically (must specify solver address)
2. Verifier monitors conditions and signs approval (off-chain)
3. Solver claims with verifier signature (funds go to reserved solver)
4. Requester can cancel and reclaim after expiry (2 minutes)

## Signature Verification

The verifier signs the `intent_id` - the signature itself is the approval.

Uses Solana's Ed25519 instruction introspection:

1. Transaction includes Ed25519 verify instruction (index 0)
2. Program reads instruction via sysvar
3. Verifies pubkey, signature, and message match expected values

## Program Interface

### Instructions

```rust
// Initialize program with verifier pubkey
fn initialize(ctx: Context<Initialize>, verifier: Pubkey) -> Result<()>

// Create escrow and deposit tokens atomically
// Expiry is set to current_time + 120 seconds (2 minutes)
fn create_escrow(ctx: Context<CreateEscrow>, intent_id: [u8; 32], amount: u64) -> Result<()>

// Claim funds with verifier signature
// Requires Ed25519 verify instruction at index 0 in transaction
fn claim(ctx: Context<Claim>, intent_id: [u8; 32], signature: [u8; 64]) -> Result<()>

// Cancel escrow and reclaim funds (requester only, after expiry)
fn cancel(ctx: Context<Cancel>, intent_id: [u8; 32]) -> Result<()>
```

### Events

- `EscrowInitialized` - Emitted when escrow is created with funds
- `EscrowClaimed` - Emitted when solver claims funds
- `EscrowCancelled` - Emitted when requester cancels after expiry

### Errors

- `EscrowAlreadyClaimed` - Escrow has already been claimed
- `EscrowDoesNotExist` - Intent ID doesn't match escrow
- `NoDeposit` - No funds in escrow
- `UnauthorizedRequester` - Caller is not the requester
- `InvalidSignature` - Signature verification failed
- `UnauthorizedVerifier` - Signer is not the authorized verifier
- `EscrowExpired` - Cannot claim after expiry
- `EscrowNotExpiredYet` - Cannot cancel before expiry

## Quick Start

See the [component README](../../svm-intent-framework/README.md) for quick start commands.

## Usage Example

```typescript
import * as anchor from "@coral-xyz/anchor";
import { Ed25519Program, SYSVAR_INSTRUCTIONS_PUBKEY } from "@solana/web3.js";
import * as nacl from "tweetnacl";

// Create escrow
await program.methods
  .createEscrow(Array.from(intentId), amount)
  .accounts({
    escrow: escrowPda,
    requester: requester.publicKey,
    tokenMint: tokenMint,
    requesterTokenAccount: requesterAta,
    escrowVault: vaultPda,
    reservedSolver: solver.publicKey,
    tokenProgram: TOKEN_PROGRAM_ID,
    systemProgram: SystemProgram.programId,
    rent: SYSVAR_RENT_PUBKEY,
  })
  .signers([requester])
  .rpc();

// Verifier signs intent_id (off-chain)
const signature = nacl.sign.detached(intentId, verifier.secretKey);

// Build claim transaction with Ed25519 instruction
const ed25519Ix = Ed25519Program.createInstructionWithPrivateKey({
  privateKey: verifier.secretKey,
  message: intentId,
});

const claimIx = await program.methods
  .claim(Array.from(intentId), Array.from(signature))
  .accounts({
    escrow: escrowPda,
    state: statePda,
    escrowVault: vaultPda,
    solverTokenAccount: solverAta,
    instructionSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
    tokenProgram: TOKEN_PROGRAM_ID,
    clock: SYSVAR_CLOCK_PUBKEY,
  })
  .instruction();

// Ed25519 instruction must be first
const tx = new Transaction().add(ed25519Ix).add(claimIx);
await provider.sendAndConfirm(tx, [solver]);
```

## Security Considerations

- Signature verification: Only authorized verifier signatures accepted (Ed25519)
- Intent ID binding: Prevents signature replay across escrows
- PDA authority: Escrow vault is controlled by escrow PDA
- Access control: Only requester can cancel (after expiry)
- Solver reservation: Required at creation, prevents unauthorized recipients

## Testing

```bash
# Build and run tests (handles dependencies and keypair setup)
./scripts/test.sh
```

Tests cover escrow initialization, deposits, claiming, cancellation, expiry enforcement, and error cases.

See [svm-intent-framework/README.md](../../svm-intent-framework/README.md) for toolchain constraints and workarounds.

### Docker Testing (CI Simulation)

To simulate the GitHub Actions CI environment locally (useful for debugging CI failures):

```bash
cd svm-intent-framework
./scripts/test-docker.sh
```

This runs tests in a Docker container with:

- `--platform linux/amd64` to match GitHub Actions (x86_64)
- `nixos/nix` image with Nix flakes support
- Sandbox disabled to avoid seccomp issues with QEMU emulation

**Requirements:** Docker Desktop running.

**Note:** On ARM Macs, this uses x86_64 emulation which is slower and may have quirks. Native Linux x86_64 systems provide the most accurate CI simulation.
