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

describe("IntentEscrow - Expiry Handling", function () {
  let ctx: TestContext;

  beforeEach(async function () {
    ctx = await setupIntentEscrowTests();
  });

  /// Test: Expired Escrow Cancellation
  /// Verifies that requesters can cancel escrows after expiry and reclaim funds.
  /// Why: Requesters need a way to reclaim funds if fulfillment doesn't occur before expiry. Cancellation before expiry is blocked to ensure funds remain locked until expiry.
  it("Should allow requester to cancel expired escrow", async function () {
    this.timeout(10000);

    const intentId = generateIntentId();
    const amount = 1_000_000n;

    const [escrowPda] = getEscrowPda(PROGRAM_ID, intentId);
    const [vaultPda] = getVaultPda(PROGRAM_ID, intentId);

    // Create escrow with short expiry (2 seconds)
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

    // Cancellation blocked before expiry
    const cancelIxEarly = buildCancelInstruction(
      intentId,
      ctx.requester.publicKey,
      ctx.requesterTokenAccount
    );
    const cancelTxEarly = new Transaction().add(cancelIxEarly);

    try {
      await sendAndConfirmTransaction(ctx.connection, cancelTxEarly, [ctx.requester]);
      expect.fail("Should have thrown an error");
    } catch (err: any) {
      expect(hasErrorCode(err, EscrowErrorCode.EscrowNotExpiredYet)).to.be.true;
    }

    // Advance time past expiry
    console.log("Waiting 4 seconds for escrow to expire...");
    await new Promise(resolve => setTimeout(resolve, 4000));

    // Cancellation allowed after expiry
    const initialBalance = await getTokenBalance(ctx.connection, ctx.requesterTokenAccount);

    const cancelIx = buildCancelInstruction(
      intentId,
      ctx.requester.publicKey,
      ctx.requesterTokenAccount
    );
    const cancelTx = new Transaction().add(cancelIx);
    await sendAndConfirmTransaction(ctx.connection, cancelTx, [ctx.requester]);

    // Verify funds returned
    const finalBalance = await getTokenBalance(ctx.connection, ctx.requesterTokenAccount);
    expect(finalBalance).to.equal(initialBalance + Number(amount));

    // Verify vault is empty
    const vaultBalance = await getTokenBalance(ctx.connection, vaultPda);
    expect(vaultBalance).to.equal(0);

    // Verify escrow state (isClaimed = true after cancel)
    const escrowData = await ctx.connection.getAccountInfo(escrowPda);
    const isClaimed = escrowData!.data[80];
    expect(isClaimed).to.equal(1);
  });

  /// Test: Expiry Timestamp Validation
  /// Verifies that expiry timestamp is correctly calculated and stored.
  /// Why: Correct expiry calculation is critical for time-based cancellation logic.
  it("Should verify expiry timestamp is stored correctly", async function () {
    const intentId = generateIntentId();
    const amount = 1_000_000n;

    const [escrowPda] = getEscrowPda(PROGRAM_ID, intentId);

    // Get current slot time before transaction
    const slot = await ctx.connection.getSlot();
    const blockTime = await ctx.connection.getBlockTime(slot);

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

    // Read escrow data
    const escrowData = await ctx.connection.getAccountInfo(escrowPda);

    // Verify requester
    const requesterBytes = escrowData!.data.slice(8, 40);
    const storedRequester = new PublicKey(requesterBytes);
    expect(storedRequester.toBase58()).to.equal(ctx.requester.publicKey.toBase58());

    // Verify token mint
    const tokenMintBytes = escrowData!.data.slice(40, 72);
    const storedTokenMint = new PublicKey(tokenMintBytes);
    expect(storedTokenMint.toBase58()).to.equal(ctx.tokenMint.toBase58());

    // Verify amount
    const amountBytes = escrowData!.data.slice(72, 80);
    const storedAmount = Buffer.from(amountBytes).readBigUInt64LE(0);
    expect(storedAmount).to.equal(amount);

    // Verify isClaimed = false
    const isClaimed = escrowData!.data[80];
    expect(isClaimed).to.equal(0);

    // Verify expiry
    const expiryBytes = escrowData!.data.slice(81, 89);
    const expiry = Buffer.from(expiryBytes).readBigInt64LE(0);
    const DEFAULT_EXPIRY_DURATION = 120n;
    expect(Number(expiry)).to.be.closeTo(
      blockTime! + Number(DEFAULT_EXPIRY_DURATION),
      10
    );
  });

  /// Test: Expired Escrow Claim Prevention
  /// Verifies that expired escrows cannot be claimed, even with valid verifier signatures.
  /// Why: Expired escrows should only be cancellable by the requester, not claimable by solvers.
  it("Should prevent claim on expired escrow", async function () {
    this.timeout(10000);

    const intentId = generateIntentId();
    const amount = 1_000_000n;

    const [escrowPda] = getEscrowPda(PROGRAM_ID, intentId);
    const [vaultPda] = getVaultPda(PROGRAM_ID, intentId);

    // Create escrow with short expiry (2 seconds)
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

    // Advance time past expiry
    console.log("Waiting 4 seconds for escrow to expire...");
    await new Promise(resolve => setTimeout(resolve, 4000));

    // Claims blocked after expiry
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

    const tx = new Transaction()
      .add(ed25519Instruction)
      .add(claimIx);

    try {
      await sendAndConfirmTransaction(ctx.connection, tx, [ctx.solver]);
      expect.fail("Should have thrown an error");
    } catch (err: any) {
      expect(hasErrorCode(err, EscrowErrorCode.EscrowExpired)).to.be.true;
    }

    // Verify vault still has funds
    const vaultBalance = await getTokenBalance(ctx.connection, vaultPda);
    expect(vaultBalance).to.equal(Number(amount));

    // Verify solver didn't receive funds
    const solverBalance = await getTokenBalance(ctx.connection, ctx.solverTokenAccount);
    expect(solverBalance).to.equal(0);

    // Verify escrow state unchanged
    const escrowData = await ctx.connection.getAccountInfo(escrowPda);
    const isClaimed = escrowData!.data[80];
    expect(isClaimed).to.equal(0);
  });
});
