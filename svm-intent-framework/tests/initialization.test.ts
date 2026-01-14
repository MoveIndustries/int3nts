import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { expect } from "chai";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { IntentEscrow } from "../target/types/intent_escrow";
import {
  setupIntentEscrowTests,
  generateIntentId,
  getEscrowPda,
  getVaultPda,
  TestContext,
} from "./helpers";
import { getTokenBalance, TOKEN_PROGRAM_ID } from "./helpers/token";

describe("IntentEscrow - Initialization", function () {
  let ctx: TestContext;

  beforeEach(async function () {
    ctx = await setupIntentEscrowTests();
  });

  // ============================================================================
  // VERIFIER INITIALIZATION TESTS
  // ============================================================================

  /// Test: Verifier Address Initialization
  /// Verifies that the escrow is initialized with the correct verifier address.
  /// Why: The verifier address is critical for signature validation.
  it("Should initialize escrow with verifier address", async function () {
    const state = await ctx.program.account.escrowState.fetch(ctx.statePda);
    expect(state.verifier.toBase58()).to.equal(ctx.verifier.publicKey.toBase58());
  });

  // ============================================================================
  // ESCROW CREATION TESTS
  // ============================================================================

  /// Test: Escrow Creation
  /// Verifies that requesters can create a new escrow with funds atomically.
  /// Why: Escrow creation must be atomic and set expiry correctly.
  it("Should allow requester to create an escrow", async function () {
    const intentId = generateIntentId();
    const amount = new anchor.BN(1_000_000);

    const [escrowPda] = getEscrowPda(ctx.program.programId, intentId);
    const [vaultPda] = getVaultPda(ctx.program.programId, intentId);

    await ctx.program.methods
      .createEscrow(Array.from(intentId), amount, null)
      .accounts({
        escrow: escrowPda,
        requester: ctx.requester.publicKey,
        tokenMint: ctx.tokenMint,
        requesterTokenAccount: ctx.requesterTokenAccount,
        escrowVault: vaultPda,
        reservedSolver: ctx.solver.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([ctx.requester])
      .rpc();

    // Verify escrow data
    const escrow = await ctx.program.account.escrow.fetch(escrowPda);
    expect(escrow.requester.toBase58()).to.equal(ctx.requester.publicKey.toBase58());
    expect(escrow.tokenMint.toBase58()).to.equal(ctx.tokenMint.toBase58());
    expect(escrow.amount.toNumber()).to.equal(amount.toNumber());
    expect(escrow.isClaimed).to.equal(false);
    expect(escrow.reservedSolver.toBase58()).to.equal(ctx.solver.publicKey.toBase58());

    // Verify vault balance
    const vaultBalance = await getTokenBalance(ctx.provider, vaultPda);
    expect(vaultBalance).to.equal(amount.toNumber());
  });

  /// Test: Duplicate Creation Prevention
  /// Verifies that attempting to create an escrow with an existing intent ID reverts.
  /// Why: Each intent ID must map to a single escrow.
  it("Should revert if escrow already exists", async function () {
    const intentId = generateIntentId();
    const amount = new anchor.BN(1_000_000);

    const [escrowPda] = getEscrowPda(ctx.program.programId, intentId);
    const [vaultPda] = getVaultPda(ctx.program.programId, intentId);

    // First creation should succeed
    await ctx.program.methods
      .createEscrow(Array.from(intentId), amount, null)
      .accounts({
        escrow: escrowPda,
        requester: ctx.requester.publicKey,
        tokenMint: ctx.tokenMint,
        requesterTokenAccount: ctx.requesterTokenAccount,
        escrowVault: vaultPda,
        reservedSolver: ctx.solver.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([ctx.requester])
      .rpc();

    // Second creation with same intent ID should fail
    try {
      await ctx.program.methods
        .createEscrow(Array.from(intentId), amount, null)
        .accounts({
          escrow: escrowPda,
          requester: ctx.requester.publicKey,
          tokenMint: ctx.tokenMint,
          requesterTokenAccount: ctx.requesterTokenAccount,
          escrowVault: vaultPda,
          reservedSolver: ctx.solver.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        })
        .signers([ctx.requester])
        .rpc();
      expect.fail("Should have thrown an error");
    } catch (err) {
      // Account already initialized error
      expect(err.toString()).to.include("already in use");
    }
  });

  /// Test: Zero Amount Prevention
  /// Verifies that escrows cannot be created with zero amount.
  /// Why: Zero-amount escrows are invalid.
  it("Should revert if amount is zero", async function () {
    const intentId = generateIntentId();
    const amount = new anchor.BN(0);

    const [escrowPda] = getEscrowPda(ctx.program.programId, intentId);
    const [vaultPda] = getVaultPda(ctx.program.programId, intentId);

    try {
      await ctx.program.methods
        .createEscrow(Array.from(intentId), amount, null)
        .accounts({
          escrow: escrowPda,
          requester: ctx.requester.publicKey,
          tokenMint: ctx.tokenMint,
          requesterTokenAccount: ctx.requesterTokenAccount,
          escrowVault: vaultPda,
          reservedSolver: ctx.solver.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        })
        .signers([ctx.requester])
        .rpc();
      expect.fail("Should have thrown an error");
    } catch (err) {
      expect(err.toString()).to.include("InvalidAmount");
    }
  });
});
