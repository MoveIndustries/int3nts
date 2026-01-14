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
  TestContext,
} from "./helpers";
import { getTokenBalance, TOKEN_PROGRAM_ID } from "./helpers/token";
import * as nacl from "tweetnacl";

describe("IntentEscrow - Expiry Handling", function () {
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
  });

  // ============================================================================
  // EXPIRY CANCELLATION TESTS
  // ============================================================================

  /// Test: Expired Escrow Cancellation
  /// Verifies that requesters can cancel escrows after expiry and reclaim funds.
  /// Why: Requesters need a way to reclaim funds if fulfillment doesn't occur before expiry.
  ///
  /// NOTE: Uses 2-second expiry for fast testing. Production uses 120 seconds.
  it("Should allow requester to cancel expired escrow", async function () {
    this.timeout(10000); // 10 second timeout

    // Create escrow with 2-second expiry
    await ctx.program.methods
      .createEscrow(Array.from(intentId), amount, new anchor.BN(2))
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

    // Cancellation blocked before expiry
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

    // Wait for expiry (2 seconds + 2 second buffer)
    await new Promise((resolve) => setTimeout(resolve, 4000));

    // Cancellation allowed after expiry
    const initialBalance = await getTokenBalance(ctx.provider, ctx.requesterTokenAccount);

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

    const finalBalance = await getTokenBalance(ctx.provider, ctx.requesterTokenAccount);
    expect(finalBalance).to.equal(initialBalance + amount.toNumber());

    const vaultBalance = await getTokenBalance(ctx.provider, vaultPda);
    expect(vaultBalance).to.equal(0);

    const escrow = await ctx.program.account.escrow.fetch(escrowPda);
    expect(escrow.isClaimed).to.equal(true);
    expect(escrow.amount.toNumber()).to.equal(0);
  });

  /// Test: Expiry Timestamp Validation
  /// Verifies that expiry timestamp is correctly calculated and stored.
  /// Why: Correct expiry calculation is critical for time-based cancellation logic.
  it("Should verify expiry timestamp is stored correctly", async function () {
    // Get current slot time before transaction
    const slot = await ctx.provider.connection.getSlot();
    const blockTime = await ctx.provider.connection.getBlockTime(slot);

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

    const escrow = await ctx.program.account.escrow.fetch(escrowPda);
    const DEFAULT_EXPIRY_DURATION = 120; // 2 minutes
    const expectedExpiry = blockTime! + DEFAULT_EXPIRY_DURATION;

    expect(escrow.expiry.toNumber()).to.be.closeTo(expectedExpiry, 10); // 10 second tolerance

    expect(escrow.requester.toBase58()).to.equal(ctx.requester.publicKey.toBase58());
    expect(escrow.tokenMint.toBase58()).to.equal(ctx.tokenMint.toBase58());
    expect(escrow.amount.toNumber()).to.equal(amount.toNumber());
    expect(escrow.isClaimed).to.equal(false);
  });

  /// Test: Expired Escrow Claim Prevention
  /// Verifies that expired escrows cannot be claimed, even with valid verifier signatures.
  /// Why: Expired escrows should only be cancellable by the requester, not claimable by solvers.
  ///
  /// NOTE: Uses 2-second expiry for fast testing. Production uses 120 seconds.
  it("Should prevent claim on expired escrow", async function () {
    this.timeout(10000); // 10 second timeout

    // Create escrow with 2-second expiry
    await ctx.program.methods
      .createEscrow(Array.from(intentId), amount, new anchor.BN(2))
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

    // Wait for expiry (2 seconds + 2 second buffer)
    await new Promise((resolve) => setTimeout(resolve, 4000));

    // Claims blocked after expiry
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

    const tx = new Transaction().add(ed25519Instruction).add(claimIx);

    try {
      await ctx.provider.sendAndConfirm(tx, []);
      expect.fail("Should have thrown an error");
    } catch (err) {
      expect(err.toString()).to.include("EscrowExpired");
    }

    const vaultBalance = await getTokenBalance(ctx.provider, vaultPda);
    expect(vaultBalance).to.equal(amount.toNumber());

    const solverBalance = await getTokenBalance(ctx.provider, ctx.solverTokenAccount);
    expect(solverBalance).to.equal(0);

    const escrow = await ctx.program.account.escrow.fetch(escrowPda);
    expect(escrow.isClaimed).to.equal(false);
    expect(escrow.amount.toNumber()).to.equal(amount.toNumber());
  });
});
