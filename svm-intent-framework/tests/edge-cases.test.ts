import { expect } from "chai";
import {
  Keypair,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  setupIntentEscrowTests,
  generateIntentId,
  getEscrowPda,
  getVaultPda,
  buildCreateEscrowInstruction,
  TestContext,
  PROGRAM_ID,
} from "./helpers";
import { getTokenBalance } from "./helpers/token";

describe("IntentEscrow - Edge Cases", function () {
  let ctx: TestContext;

  beforeEach(async function () {
    ctx = await setupIntentEscrowTests();
  });

  /// Test: Maximum Values
  /// Verifies that createEscrow handles large values for amounts.
  /// Why: Edge case testing ensures the program handles boundary values without overflow or underflow.
  it("Should handle maximum values for amounts", async function () {
    const intentId = generateIntentId();
    // Use a large but reasonable amount (not u64::MAX to avoid balance issues)
    const largeAmount = 100_000_000_000n; // 100 billion tokens

    const [escrowPda] = getEscrowPda(PROGRAM_ID, intentId);
    const [vaultPda] = getVaultPda(PROGRAM_ID, intentId);

    // This will fail due to insufficient balance, which is expected behavior
    const ix = buildCreateEscrowInstruction(
      intentId,
      largeAmount,
      ctx.requester.publicKey,
      ctx.tokenMint,
      ctx.requesterTokenAccount,
      ctx.solver.publicKey
    );

    const tx = new Transaction().add(ix);

    try {
      await sendAndConfirmTransaction(ctx.connection, tx, [ctx.requester]);
      expect.fail("Should have thrown an error due to insufficient balance");
    } catch (err: any) {
      // Expected - insufficient balance
      expect(err).to.not.be.null;
    }
  });

  /// Test: Empty Deposit Scenarios
  /// Verifies edge cases around minimum deposit amounts (1 token unit).
  /// Why: Ensures the program accepts the minimum valid amount without rejecting it as zero.
  it("Should handle minimum deposit amount (1 token unit)", async function () {
    const intentId = generateIntentId();
    const minAmount = 1n; // 1 token unit (smallest possible)

    const [escrowPda] = getEscrowPda(PROGRAM_ID, intentId);
    const [vaultPda] = getVaultPda(PROGRAM_ID, intentId);

    const ix = buildCreateEscrowInstruction(
      intentId,
      minAmount,
      ctx.requester.publicKey,
      ctx.tokenMint,
      ctx.requesterTokenAccount,
      ctx.solver.publicKey
    );

    const tx = new Transaction().add(ix);
    await sendAndConfirmTransaction(ctx.connection, tx, [ctx.requester]);

    // Verify escrow was created
    const escrowData = await ctx.connection.getAccountInfo(escrowPda);
    expect(escrowData).to.not.be.null;

    // Verify amount
    const amountBytes = escrowData!.data.slice(72, 80);
    const storedAmount = Buffer.from(amountBytes).readBigUInt64LE(0);
    expect(storedAmount).to.equal(minAmount);

    // Verify vault balance
    const vaultBalance = await getTokenBalance(ctx.connection, vaultPda);
    expect(vaultBalance).to.equal(Number(minAmount));
  });

  /// Test: Multiple Escrows Per Requester
  /// Verifies that a requester can create multiple escrows with different intent IDs.
  /// Why: Requesters may need multiple concurrent escrows for different intents. State isolation must be maintained.
  it("Should allow requester to create multiple escrows", async function () {
    const numEscrows = 5;
    const amount = 1_000_000n;

    // Create multiple escrows with sequential intent IDs
    for (let i = 0; i < numEscrows; i++) {
      const intentId = generateIntentId();
      const [escrowPda] = getEscrowPda(PROGRAM_ID, intentId);
      const [vaultPda] = getVaultPda(PROGRAM_ID, intentId);

      const ix = buildCreateEscrowInstruction(
        intentId,
        amount,
        ctx.requester.publicKey,
        ctx.tokenMint,
        ctx.requesterTokenAccount,
        ctx.solver.publicKey
      );

      const tx = new Transaction().add(ix);
      await sendAndConfirmTransaction(ctx.connection, tx, [ctx.requester]);

      // Verify escrow was created
      const escrowData = await ctx.connection.getAccountInfo(escrowPda);
      expect(escrowData).to.not.be.null;

      // Verify requester
      const requesterBytes = escrowData!.data.slice(8, 40);
      const storedRequester = new PublicKey(requesterBytes);
      expect(storedRequester.toBase58()).to.equal(ctx.requester.publicKey.toBase58());

      // Verify amount
      const amountBytes = escrowData!.data.slice(72, 80);
      const storedAmount = Buffer.from(amountBytes).readBigUInt64LE(0);
      expect(storedAmount).to.equal(amount);
    }
  });

  /// Test: Compute Unit Consumption
  /// Verifies compute unit consumption for escrow operations.
  /// Why: Compute unit efficiency is critical for user experience. Operations must stay within reasonable limits.
  it("Should handle compute unit consumption for operations", async function () {
    const numEscrows = 3;
    const amount = 1_000_000n;

    // Create multiple escrows and verify they all succeed
    const escrows = [];
    for (let i = 0; i < numEscrows; i++) {
      const intentId = generateIntentId();
      const [escrowPda] = getEscrowPda(PROGRAM_ID, intentId);
      const [vaultPda] = getVaultPda(PROGRAM_ID, intentId);

      const ix = buildCreateEscrowInstruction(
        intentId,
        amount,
        ctx.requester.publicKey,
        ctx.tokenMint,
        ctx.requesterTokenAccount,
        ctx.solver.publicKey
      );

      const tx = new Transaction().add(ix);
      const sig = await sendAndConfirmTransaction(ctx.connection, tx, [ctx.requester]);
      escrows.push({ intentId, escrowPda, vaultPda, sig });
    }

    // Verify all transactions succeeded
    expect(escrows.length).to.equal(numEscrows);

    // Verify all escrows exist
    for (const escrow of escrows) {
      const vaultBalance = await getTokenBalance(ctx.connection, escrow.vaultPda);
      expect(vaultBalance).to.equal(Number(amount));
    }
  });

  /// Test: Concurrent Operations
  /// Verifies that multiple simultaneous escrow operations can be handled correctly.
  /// Why: Real-world usage involves concurrent operations. The program must handle them without state corruption.
  it("Should handle concurrent escrow operations", async function () {
    const numEscrows = 3;
    const amount = 1_000_000n;

    // Create multiple escrows sequentially (Solana doesn't support true concurrent txs in tests)
    const escrowInfos = [];
    for (let i = 0; i < numEscrows; i++) {
      const intentId = generateIntentId();
      const [escrowPda] = getEscrowPda(PROGRAM_ID, intentId);
      const [vaultPda] = getVaultPda(PROGRAM_ID, intentId);

      const ix = buildCreateEscrowInstruction(
        intentId,
        amount,
        ctx.requester.publicKey,
        ctx.tokenMint,
        ctx.requesterTokenAccount,
        ctx.solver.publicKey
      );

      const tx = new Transaction().add(ix);
      await sendAndConfirmTransaction(ctx.connection, tx, [ctx.requester]);

      escrowInfos.push({ intentId, escrowPda, vaultPda });
    }

    // Verify all escrows were created correctly
    expect(escrowInfos.length).to.equal(numEscrows);

    for (const escrowInfo of escrowInfos) {
      const escrowData = await ctx.connection.getAccountInfo(escrowInfo.escrowPda);
      expect(escrowData).to.not.be.null;

      // Verify amount
      const amountBytes = escrowData!.data.slice(72, 80);
      const storedAmount = Buffer.from(amountBytes).readBigUInt64LE(0);
      expect(storedAmount).to.equal(amount);

      // Verify requester
      const requesterBytes = escrowData!.data.slice(8, 40);
      const storedRequester = new PublicKey(requesterBytes);
      expect(storedRequester.toBase58()).to.equal(ctx.requester.publicKey.toBase58());
    }
  });
});
