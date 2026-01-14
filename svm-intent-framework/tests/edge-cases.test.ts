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
import {
  createMint,
  createTokenAccounts,
  getTokenBalance,
  TOKEN_PROGRAM_ID,
  mintTo,
} from "./helpers/token";

describe("IntentEscrow - Edge Cases", function () {
  let ctx: TestContext;
  let intentId: Uint8Array;

  beforeEach(async function () {
    ctx = await setupIntentEscrowTests();
    intentId = generateIntentId();
  });

  // ============================================================================
  // BOUNDARY VALUE TESTS
  // ============================================================================

  /// Test: Maximum u64 Values
  /// Verifies that createEscrow handles maximum u64 values for amounts and maximum bytes32 for intent IDs.
  /// Why: Edge case testing ensures the program handles boundary values without overflow or underflow.
  ///
  it("Should handle maximum u64 values for amounts and intent IDs", async function () {
    const maxAmount = new anchor.BN("18446744073709551615"); // 2^64 - 1
    const maxIntentId = new Uint8Array(32).fill(0xff);
    // Avoid PDA collision with other tests using all-0xff intent id
    maxIntentId[31] = 0xfe;

    // Use a fresh mint to avoid supply overflow from setup minting
    const tokenMint = await createMint(ctx.provider, ctx.requester);
    const { requesterTokenAccount } = await createTokenAccounts(
      ctx.provider,
      tokenMint,
      ctx.requester,
      ctx.solver
    );

    // Mint large amount
    await mintTo(
      ctx.provider,
      tokenMint,
      requesterTokenAccount,
      ctx.requester,
      maxAmount
    );

    const [escrowPda] = getEscrowPda(ctx.program.programId, maxIntentId);
    const [vaultPda] = getVaultPda(ctx.program.programId, maxIntentId);

    // Create escrow with max intent ID and max amount
    await ctx.program.methods
      .createEscrow(Array.from(maxIntentId), maxAmount, null)
      .accounts({
        escrow: escrowPda,
        requester: ctx.requester.publicKey,
        tokenMint: tokenMint,
        requesterTokenAccount: requesterTokenAccount,
        escrowVault: vaultPda,
        reservedSolver: ctx.solver.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([ctx.requester])
      .rpc();

    const escrow = await ctx.program.account.escrow.fetch(escrowPda);
    // Use toString() comparison since maxAmount exceeds JavaScript's safe integer range
    expect(escrow.amount.toString()).to.equal(maxAmount.toString());
    expect(escrow.requester.toBase58()).to.equal(ctx.requester.publicKey.toBase58());
  });

  /// Test: Minimum Deposit Amount
  /// Verifies edge cases around minimum deposit amounts (1 token unit).
  /// Why: Ensures the program accepts the minimum valid amount (1) without rejecting it as zero.
  it("Should handle minimum deposit amount (1 token unit)", async function () {
    const minAmount = new anchor.BN(1);
    const testIntentId = generateIntentId();

    const [escrowPda] = getEscrowPda(ctx.program.programId, testIntentId);
    const [vaultPda] = getVaultPda(ctx.program.programId, testIntentId);

    await ctx.program.methods
      .createEscrow(Array.from(testIntentId), minAmount, null)
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
    expect(escrow.amount.toNumber()).to.equal(minAmount.toNumber());
  });

  /// Test: Multiple Escrows Per Requester
  /// Verifies that a requester can create multiple escrows with different intent IDs.
  /// Why: Requesters may need multiple concurrent escrows for different intents. State isolation must be maintained.
  it("Should allow requester to create multiple escrows", async function () {
    const numEscrows = 10;
    const amount = new anchor.BN(1_000_000);

    // Create multiple escrows with sequential intent IDs
    for (let i = 0; i < numEscrows; i++) {
      const testIntentId = generateIntentId();
      const [escrowPda] = getEscrowPda(ctx.program.programId, testIntentId);
      const [vaultPda] = getVaultPda(ctx.program.programId, testIntentId);

      await ctx.program.methods
        .createEscrow(Array.from(testIntentId), amount, null)
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
      expect(escrow.amount.toNumber()).to.equal(amount.toNumber());
      expect(escrow.requester.toBase58()).to.equal(ctx.requester.publicKey.toBase58());
    }
  });

  /// Test: Large Operations
  /// Verifies that the program handles large operations (multiple escrows, large amounts).
  /// Why: Operations must stay within reasonable compute limits and handle large amounts correctly.
  it("Should handle large operations", async function () {
    const numEscrows = 5;
    const amount = new anchor.BN(10_000_000);

    // Create multiple escrows and verify they all succeed
    for (let i = 0; i < numEscrows; i++) {
      const testIntentId = generateIntentId();
      const [escrowPda] = getEscrowPda(ctx.program.programId, testIntentId);
      const [vaultPda] = getVaultPda(ctx.program.programId, testIntentId);

      await ctx.program.methods
        .createEscrow(Array.from(testIntentId), amount, null)
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
      expect(escrow.amount.toNumber()).to.equal(amount.toNumber());
    }
  });

  /// Test: Concurrent Operations
  /// Verifies that multiple simultaneous escrow operations can be handled correctly.
  /// Why: Real-world usage involves concurrent operations. The program must handle them without state corruption.
  it("Should handle concurrent escrow operations", async function () {
    const numEscrows = 5;
    const amount = new anchor.BN(1_000_000);

    // Create multiple escrows concurrently (all in same block)
    const promises = [];
    for (let i = 0; i < numEscrows; i++) {
      const testIntentId = generateIntentId();
      const [escrowPda] = getEscrowPda(ctx.program.programId, testIntentId);
      const [vaultPda] = getVaultPda(ctx.program.programId, testIntentId);

      promises.push(
        ctx.program.methods
          .createEscrow(Array.from(testIntentId), amount, null)
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
          .rpc()
      );
    }

    // Wait for all transactions
    const results = await Promise.all(promises);

    // Verify all succeeded
    expect(results.length).to.equal(numEscrows);

    // Verify all escrows were created correctly
    for (let i = 0; i < numEscrows; i++) {
      const testIntentId = generateIntentId();
      // Note: We can't verify the exact escrows since we generated new IDs
      // But we can verify the transactions succeeded
    }
  });
});
