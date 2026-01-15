import { expect } from "chai";
import {
  PublicKey,
  Transaction,
  Ed25519Program,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  setupIntentEscrowTests,
  generateIntentId,
  getEscrowPda,
  getVaultPda,
  buildCreateEscrowInstruction,
  buildClaimInstruction,
  buildCancelInstruction,
  TestContext,
  PROGRAM_ID,
} from "./helpers";
import { getTokenBalance } from "./helpers/token";
import * as nacl from "tweetnacl";

describe("IntentEscrow - Integration", function () {
  let ctx: TestContext;

  beforeEach(async function () {
    ctx = await setupIntentEscrowTests();
  });

  // ============================================================================
  // FULL LIFECYCLE TESTS
  // ============================================================================

  /// Test: Full Claim Lifecycle
  /// Verifies the complete happy path: create → claim → verify.
  /// Why: End-to-end test ensures all components work together.
  it("Should complete full create-claim lifecycle", async function () {
    const intentId = generateIntentId();
    const amount = 1_000_000n;

    const [escrowPda] = getEscrowPda(PROGRAM_ID, intentId);
    const [vaultPda] = getVaultPda(PROGRAM_ID, intentId);

    // Step 1: Create escrow
    const createIx = buildCreateEscrowInstruction(
      intentId,
      amount,
      ctx.requester.publicKey,
      ctx.tokenMint,
      ctx.requesterTokenAccount,
      ctx.solver.publicKey
    );
    const createTx = new Transaction().add(createIx);
    await sendAndConfirmTransaction(ctx.connection, createTx, [ctx.requester]);

    // Verify escrow created
    const vaultBalanceAfterCreate = await getTokenBalance(ctx.connection, vaultPda);
    expect(vaultBalanceAfterCreate).to.equal(Number(amount));

    // Step 2: Claim with verifier signature
    const message = Buffer.from(intentId);
    const signature = nacl.sign.detached(message, ctx.verifier.secretKey);

    const ed25519Instruction = Ed25519Program.createInstructionWithPublicKey({
      publicKey: ctx.verifier.publicKey.toBytes(),
      message: message,
      signature: signature,
    });

    const claimIx = buildClaimInstruction(
      intentId,
      signature,
      ctx.solverTokenAccount,
      ctx.statePda
    );

    const claimTx = new Transaction()
      .add(ed25519Instruction)
      .add(claimIx);

    await sendAndConfirmTransaction(ctx.connection, claimTx, [ctx.solver]);

    // Step 3: Verify final state
    const solverBalance = await getTokenBalance(ctx.connection, ctx.solverTokenAccount);
    expect(solverBalance).to.equal(Number(amount));

    const vaultBalanceAfterClaim = await getTokenBalance(ctx.connection, vaultPda);
    expect(vaultBalanceAfterClaim).to.equal(0);

    const escrowData = await ctx.connection.getAccountInfo(escrowPda);
    const isClaimed = escrowData!.data[80];
    expect(isClaimed).to.equal(1);
  });

  /// Test: Full Cancel Lifecycle
  /// Verifies the complete cancel path: create → wait → cancel → verify.
  /// Why: Ensures requesters can reclaim funds after expiry.
  it("Should complete full create-cancel lifecycle", async function () {
    this.timeout(10000);

    const intentId = generateIntentId();
    const amount = 1_000_000n;

    const [escrowPda] = getEscrowPda(PROGRAM_ID, intentId);
    const [vaultPda] = getVaultPda(PROGRAM_ID, intentId);

    const initialRequesterBalance = await getTokenBalance(ctx.connection, ctx.requesterTokenAccount);

    // Step 1: Create escrow with short expiry
    const createIx = buildCreateEscrowInstruction(
      intentId,
      amount,
      ctx.requester.publicKey,
      ctx.tokenMint,
      ctx.requesterTokenAccount,
      ctx.solver.publicKey,
      2n // 2 second expiry
    );
    const createTx = new Transaction().add(createIx);
    await sendAndConfirmTransaction(ctx.connection, createTx, [ctx.requester]);

    // Step 2: Wait for expiry
    console.log("Waiting 4 seconds for expiry...");
    await new Promise(resolve => setTimeout(resolve, 4000));

    // Step 3: Cancel and reclaim
    const cancelIx = buildCancelInstruction(
      intentId,
      ctx.requester.publicKey,
      ctx.requesterTokenAccount
    );
    const cancelTx = new Transaction().add(cancelIx);
    await sendAndConfirmTransaction(ctx.connection, cancelTx, [ctx.requester]);

    // Step 4: Verify final state
    const finalRequesterBalance = await getTokenBalance(ctx.connection, ctx.requesterTokenAccount);
    expect(finalRequesterBalance).to.equal(initialRequesterBalance);

    const vaultBalance = await getTokenBalance(ctx.connection, vaultPda);
    expect(vaultBalance).to.equal(0);
  });

  /// Test: Multiple Concurrent Escrows
  /// Verifies that multiple escrows can exist and be processed independently.
  /// Why: System must support high concurrency in production.
  it("Should handle multiple concurrent escrows", async function () {
    const escrows = [];
    const numEscrows = 3;

    // Create multiple escrows
    for (let i = 0; i < numEscrows; i++) {
      const intentId = generateIntentId();
      const amount = BigInt((i + 1) * 1_000_000);
      const [escrowPda] = getEscrowPda(PROGRAM_ID, intentId);
      const [vaultPda] = getVaultPda(PROGRAM_ID, intentId);

      const createIx = buildCreateEscrowInstruction(
        intentId,
        amount,
        ctx.requester.publicKey,
        ctx.tokenMint,
        ctx.requesterTokenAccount,
        ctx.solver.publicKey
      );
      const createTx = new Transaction().add(createIx);
      await sendAndConfirmTransaction(ctx.connection, createTx, [ctx.requester]);

      escrows.push({ intentId, amount, escrowPda, vaultPda });
    }

    // Verify all escrows exist with correct amounts
    for (const escrow of escrows) {
      const vaultBalance = await getTokenBalance(ctx.connection, escrow.vaultPda);
      expect(vaultBalance).to.equal(Number(escrow.amount));
    }

    // Claim first escrow
    const firstEscrow = escrows[0];
    const message = Buffer.from(firstEscrow.intentId);
    const signature = nacl.sign.detached(message, ctx.verifier.secretKey);

    const ed25519Instruction = Ed25519Program.createInstructionWithPublicKey({
      publicKey: ctx.verifier.publicKey.toBytes(),
      message: message,
      signature: signature,
    });

    const claimIx = buildClaimInstruction(
      firstEscrow.intentId,
      signature,
      ctx.solverTokenAccount,
      ctx.statePda
    );

    const claimTx = new Transaction()
      .add(ed25519Instruction)
      .add(claimIx);

    await sendAndConfirmTransaction(ctx.connection, claimTx, [ctx.solver]);

    // Verify first escrow claimed, others unchanged
    const firstVaultBalance = await getTokenBalance(ctx.connection, firstEscrow.vaultPda);
    expect(firstVaultBalance).to.equal(0);

    for (let i = 1; i < numEscrows; i++) {
      const vaultBalance = await getTokenBalance(ctx.connection, escrows[i].vaultPda);
      expect(vaultBalance).to.equal(Number(escrows[i].amount));
    }
  });
});
