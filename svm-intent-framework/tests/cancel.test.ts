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
  EscrowErrorCode,
  hasErrorCode,
} from "./helpers";
import { getTokenBalance } from "./helpers/token";
import * as nacl from "tweetnacl";

describe("IntentEscrow - Cancel", function () {
  let ctx: TestContext;
  let intentId: Uint8Array;
  let escrowPda: PublicKey;
  let vaultPda: PublicKey;
  const amount = 1_000_000n;

  beforeEach(async function () {
    ctx = await setupIntentEscrowTests();
    intentId = generateIntentId();
    [escrowPda] = getEscrowPda(PROGRAM_ID, intentId);
    [vaultPda] = getVaultPda(PROGRAM_ID, intentId);

    // Create escrow with default expiry (120 seconds)
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
  });

  // ============================================================================
  // EXPIRY TESTS
  // ============================================================================

  /// Test: Cancellation Before Expiry Prevention
  /// Verifies that requesters cannot cancel escrows before expiry.
  /// Why: Funds must remain locked until expiry to give solvers time to fulfill.
  it("Should revert if escrow has not expired yet", async function () {
    const cancelIx = buildCancelInstruction(
      intentId,
      ctx.requester.publicKey,
      ctx.requesterTokenAccount
    );
    const tx = new Transaction().add(cancelIx);

    try {
      await sendAndConfirmTransaction(ctx.connection, tx, [ctx.requester]);
      expect.fail("Should have thrown an error");
    } catch (err: any) {
      expect(hasErrorCode(err, EscrowErrorCode.EscrowNotExpiredYet)).to.be.true;
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
    const [shortEscrowPda] = getEscrowPda(PROGRAM_ID, shortExpiryIntentId);
    const [shortVaultPda] = getVaultPda(PROGRAM_ID, shortExpiryIntentId);

    const createIx = buildCreateEscrowInstruction(
      shortExpiryIntentId,
      amount,
      ctx.requester.publicKey,
      ctx.tokenMint,
      ctx.requesterTokenAccount,
      ctx.solver.publicKey,
      2n // 2 second expiry
    );
    const createTx = new Transaction().add(createIx);
    await sendAndConfirmTransaction(ctx.connection, createTx, [ctx.requester]);

    const initialBalance = await getTokenBalance(ctx.connection, ctx.requesterTokenAccount);

    // Wait for expiry (2 seconds + 2 second buffer to ensure we're past expiry)
    console.log("Waiting 4 seconds for escrow to expire...");
    await new Promise(resolve => setTimeout(resolve, 4000));

    const cancelIx = buildCancelInstruction(
      shortExpiryIntentId,
      ctx.requester.publicKey,
      ctx.requesterTokenAccount
    );
    const cancelTx = new Transaction().add(cancelIx);
    await sendAndConfirmTransaction(ctx.connection, cancelTx, [ctx.requester]);

    // Verify funds returned
    const finalBalance = await getTokenBalance(ctx.connection, ctx.requesterTokenAccount);
    expect(finalBalance).to.equal(initialBalance + Number(amount));

    // Verify escrow state
    const escrowData = await ctx.connection.getAccountInfo(shortEscrowPda);
    const isClaimed = escrowData!.data[80];
    expect(isClaimed).to.equal(1); // true (cancelled = claimed)
  });

  // ============================================================================
  // AUTHORIZATION TESTS
  // ============================================================================

  /// Test: Unauthorized Cancellation Prevention
  /// Verifies that only the requester can cancel their escrow.
  /// Why: Security requirement - only the escrow creator should be able to cancel.
  it("Should revert if not requester", async function () {
    const cancelIx = buildCancelInstruction(
      intentId,
      ctx.solver.publicKey, // Wrong requester
      ctx.solverTokenAccount
    );
    const tx = new Transaction().add(cancelIx);

    try {
      await sendAndConfirmTransaction(ctx.connection, tx, [ctx.solver]);
      expect.fail("Should have thrown an error");
    } catch (err: any) {
      // Either constraint error or UnauthorizedRequester
      expect(err.toString()).to.satisfy(
        (msg: string) => msg.includes("Unauthorized") || msg.includes("constraint") || msg.includes("custom program error")
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

    // Now try to cancel - should fail
    const cancelIx = buildCancelInstruction(
      intentId,
      ctx.requester.publicKey,
      ctx.requesterTokenAccount
    );
    const cancelTx = new Transaction().add(cancelIx);

    try {
      await sendAndConfirmTransaction(ctx.connection, cancelTx, [ctx.requester]);
      expect.fail("Should have thrown an error");
    } catch (err: any) {
      expect(hasErrorCode(err, EscrowErrorCode.EscrowAlreadyClaimed)).to.be.true;
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

    const cancelIx = buildCancelInstruction(
      nonExistentIntentId,
      ctx.requester.publicKey,
      ctx.requesterTokenAccount
    );
    const tx = new Transaction().add(cancelIx);

    try {
      await sendAndConfirmTransaction(ctx.connection, tx, [ctx.requester]);
      expect.fail("Should have thrown an error");
    } catch (err: any) {
      // Any error is acceptable - escrow doesn't exist so operation should fail
      expect(err).to.not.be.null;
    }
  });
});
