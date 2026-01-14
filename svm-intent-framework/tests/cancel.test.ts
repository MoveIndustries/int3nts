import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { expect } from "chai";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  Ed25519Program,
  SYSVAR_INSTRUCTIONS_PUBKEY,
} from "@solana/web3.js";
import { IntentEscrow } from "../target/types/intent_escrow";
import {
  setupIntentEscrowTests,
  generateIntentId,
  getEscrowPda,
  getVaultPda,
  advanceTime,
  TestContext,
} from "./helpers";
import { getTokenBalance, TOKEN_PROGRAM_ID } from "./helpers/token";
import * as nacl from "tweetnacl";

describe("IntentEscrow - Cancel", function () {
  let ctx: TestContext;
  let intentId: Uint8Array;
  let escrowPda: PublicKey;
  let vaultPda: PublicKey;
  const amount = new anchor.BN(1_000_000);

  beforeEach(async function () {
    ctx = await setupIntentEscrowTests();
    intentId = generateIntentId();
    [escrowPda] = getEscrowPda(ctx.program.programId, intentId);
    [vaultPda] = getVaultPda(ctx.program.programId, intentId);

    // Create escrow with default expiry (120 seconds)
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
  });

  // ============================================================================
  // EXPIRY TESTS
  // ============================================================================

  /// Test: Cancellation Before Expiry Prevention
  /// Verifies that requesters cannot cancel escrows before expiry.
  /// Why: Funds must remain locked until expiry to give solvers time to fulfill.
  it("Should revert if escrow has not expired yet", async function () {
    try {
      await ctx.program.methods
        .cancel(Array.from(intentId))
        .accounts({
          escrow: escrowPda,
          requester: ctx.requester.publicKey,
          escrowVault: vaultPda,
          requesterTokenAccount: ctx.requesterTokenAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
          clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
        })
        .signers([ctx.requester])
        .rpc();
      expect.fail("Should have thrown an error");
    } catch (err) {
      expect(err.toString()).to.include("EscrowNotExpiredYet");
    }
  });

  /// Test: Cancellation After Expiry
  /// Verifies that requesters can cancel escrows after expiry and reclaim funds.
  /// Why: Requesters need a way to reclaim funds if fulfillment doesn't occur.
  ///
    /// NOTE: This test creates its own escrow with 2-second expiry to avoid long waits.
    /// Production uses 120 seconds (matching EVM EXPIRY_DURATION).
    it("Should allow requester to cancel and reclaim funds after expiry", async function () {
      this.timeout(10000); // 10 second timeout

      // Create a NEW escrow with 2-second expiry specifically for this test
      const shortExpiryIntentId = generateIntentId();
      const [shortEscrowPda] = getEscrowPda(ctx.program.programId, shortExpiryIntentId);
      const [shortVaultPda] = getVaultPda(ctx.program.programId, shortExpiryIntentId);

      await ctx.program.methods
        .createEscrow(Array.from(shortExpiryIntentId), amount, new anchor.BN(2)) // 2 second expiry
        .accounts({
          escrow: shortEscrowPda,
          requester: ctx.requester.publicKey,
          tokenMint: ctx.tokenMint,
          requesterTokenAccount: ctx.requesterTokenAccount,
          escrowVault: shortVaultPda,
          reservedSolver: ctx.solver.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        })
        .signers([ctx.requester])
        .rpc();

      const initialBalance = await getTokenBalance(ctx.provider, ctx.requesterTokenAccount);

      // Wait for expiry (2 seconds + 1 second buffer to ensure we're past expiry)
      console.log("Waiting 3 seconds for escrow to expire...");
      await new Promise(resolve => setTimeout(resolve, 3000));

    await ctx.program.methods
      .cancel(Array.from(shortExpiryIntentId))
      .accounts({
        escrow: shortEscrowPda,
        requester: ctx.requester.publicKey,
        escrowVault: shortVaultPda,
        requesterTokenAccount: ctx.requesterTokenAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
        clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
      })
      .signers([ctx.requester])
      .rpc();

    // Verify funds returned
    const finalBalance = await getTokenBalance(ctx.provider, ctx.requesterTokenAccount);
    expect(finalBalance).to.equal(initialBalance + amount.toNumber());

    // Verify escrow state
    const escrow = await ctx.program.account.escrow.fetch(shortEscrowPda);
    expect(escrow.isClaimed).to.equal(true);
    expect(escrow.amount.toNumber()).to.equal(0);
  });

  // ============================================================================
  // AUTHORIZATION TESTS
  // ============================================================================

  /// Test: Unauthorized Cancellation Prevention
  /// Verifies that only the requester can cancel their escrow.
  /// Why: Security requirement - only the escrow creator should be able to cancel.
  it("Should revert if not requester", async function () {
    try {
      await ctx.program.methods
        .cancel(Array.from(intentId))
        .accounts({
          escrow: escrowPda,
          requester: ctx.solver.publicKey, // Wrong requester
          escrowVault: vaultPda,
          requesterTokenAccount: ctx.solverTokenAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
          clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
        })
        .signers([ctx.solver])
        .rpc();
      expect.fail("Should have thrown an error");
    } catch (err) {
      // Either constraint error or UnauthorizedRequester
      expect(err.toString()).to.satisfy(
        (msg: string) => msg.includes("Unauthorized") || msg.includes("constraint")
      );
    }
  });

  /// Test: Cancellation After Claim Prevention
  /// Verifies that attempting to cancel an already-claimed escrow reverts.
  /// Why: Once funds are claimed, they cannot be cancelled.
  it("Should revert if already claimed", async function () {
    // Claim the escrow first
    const message = Buffer.from(intentId);
    const signature = nacl.sign.detached(message, ctx.verifier.secretKey);

    const ed25519Instruction = Ed25519Program.createInstructionWithPublicKey({
      publicKey: ctx.verifier.publicKey.toBytes(),
      message: message,
      signature: signature,
    });

    const claimIx = await ctx.program.methods
      .claim(Array.from(intentId), Array.from(signature))
      .accounts({
        escrow: escrowPda,
        state: ctx.statePda,
        escrowVault: vaultPda,
        solverTokenAccount: ctx.solverTokenAccount,
        instructionSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
        tokenProgram: TOKEN_PROGRAM_ID,
        clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
      })
      .instruction();

    const tx = new Transaction()
      .add(ed25519Instruction)
      .add(claimIx);

    await ctx.provider.sendAndConfirm(tx, []);

    // Now try to cancel - should fail
    try {
      await ctx.program.methods
        .cancel(Array.from(intentId))
        .accounts({
          escrow: escrowPda,
          requester: ctx.requester.publicKey,
          escrowVault: vaultPda,
          requesterTokenAccount: ctx.requesterTokenAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
          clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
        })
        .signers([ctx.requester])
        .rpc();
      expect.fail("Should have thrown an error");
    } catch (err) {
      expect(err.toString()).to.include("EscrowAlreadyClaimed");
    }
  });

  // ============================================================================
  // NON-EXISTENT ESCROW TESTS
  // ============================================================================

  /// Test: Non-Existent Escrow Prevention
  /// Verifies that canceling a non-existent escrow reverts.
  /// Why: Prevents invalid operations on non-existent escrows.
  it("Should revert if escrow does not exist", async function () {
    const nonExistentIntentId = generateIntentId();
    const [nonExistentEscrowPda] = getEscrowPda(ctx.program.programId, nonExistentIntentId);
    const [nonExistentVaultPda] = getVaultPda(ctx.program.programId, nonExistentIntentId);

    try {
      await ctx.program.methods
        .cancel(Array.from(nonExistentIntentId))
        .accounts({
          escrow: nonExistentEscrowPda,
          requester: ctx.requester.publicKey,
          escrowVault: nonExistentVaultPda,
          requesterTokenAccount: ctx.requesterTokenAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
          clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
        })
        .signers([ctx.requester])
        .rpc();
      expect.fail("Should have thrown an error");
    } catch (err) {
      // Account does not exist error
      expect(err.toString()).to.include("AccountNotInitialized");
    }
  });
});
