import { expect } from "chai";
import {
  Connection,
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

describe("IntentEscrow - Create Escrow (Deposit)", function () {
  let ctx: TestContext;

  beforeEach(async function () {
    ctx = await setupIntentEscrowTests();
  });

  /// Test: Token Escrow Creation
  /// Verifies that requesters can create an escrow with SPL tokens atomically.
  /// Why: Escrow creation is the first step in the intent fulfillment flow. Requesters must be able to lock funds securely.
  it("Should allow requester to create escrow with tokens", async function () {
    const intentId = generateIntentId();
    const amount = 1_000_000n;

    const [escrowPda] = getEscrowPda(PROGRAM_ID, intentId);
    const [vaultPda] = getVaultPda(PROGRAM_ID, intentId);

    // Get initial balance
    const initialRequesterBalance = await getTokenBalance(
      ctx.connection,
      ctx.requesterTokenAccount
    );

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

    // Verify requester balance decreased
    const finalRequesterBalance = await getTokenBalance(
      ctx.connection,
      ctx.requesterTokenAccount
    );
    expect(finalRequesterBalance).to.equal(initialRequesterBalance - Number(amount));

    // Verify vault balance increased
    const vaultBalance = await getTokenBalance(ctx.connection, vaultPda);
    expect(vaultBalance).to.equal(Number(amount));

    // Verify escrow data
    const escrowData = await ctx.connection.getAccountInfo(escrowPda);
    expect(escrowData).to.not.be.null;
    const amountBytes = escrowData!.data.slice(72, 80);
    const storedAmount = Buffer.from(amountBytes).readBigUInt64LE(0);
    expect(storedAmount).to.equal(amount);
  });

  /// Test: Escrow Creation After Claim Prevention
  /// Verifies that escrows cannot be created with an intent ID that was already claimed.
  /// Why: Prevents duplicate escrows and ensures each intent ID maps to a single escrow state.
  it("Should revert if escrow is already claimed", async function () {
    const intentId = generateIntentId();
    const amount = 1_000_000n;

    const ix = buildCreateEscrowInstruction(
      intentId,
      amount,
      ctx.requester.publicKey,
      ctx.tokenMint,
      ctx.requesterTokenAccount,
      ctx.solver.publicKey
    );

    // First creation should succeed
    const tx1 = new Transaction().add(ix);
    await sendAndConfirmTransaction(ctx.connection, tx1, [ctx.requester]);

    // Second creation with same intent ID should fail (escrow already exists)
    const ix2 = buildCreateEscrowInstruction(
      intentId,
      amount,
      ctx.requester.publicKey,
      ctx.tokenMint,
      ctx.requesterTokenAccount,
      ctx.solver.publicKey
    );
    const tx2 = new Transaction().add(ix2);

    try {
      await sendAndConfirmTransaction(ctx.connection, tx2, [ctx.requester]);
      expect.fail("Should have thrown an error");
    } catch (err: any) {
      expect(err.toString()).to.include("already in use");
    }
  });

  /// Test: Multiple Escrows with Different Intent IDs
  /// Verifies that multiple escrows can be created for different intent IDs.
  /// Why: System must support concurrent escrows.
  it("Should support multiple escrows with different intent IDs", async function () {
    const intentId1 = generateIntentId();
    const intentId2 = generateIntentId();
    const amount1 = 1_000_000n;
    const amount2 = 2_000_000n;

    const [vaultPda1] = getVaultPda(PROGRAM_ID, intentId1);
    const [vaultPda2] = getVaultPda(PROGRAM_ID, intentId2);

    // Create first escrow
    const ix1 = buildCreateEscrowInstruction(
      intentId1,
      amount1,
      ctx.requester.publicKey,
      ctx.tokenMint,
      ctx.requesterTokenAccount,
      ctx.solver.publicKey
    );
    const tx1 = new Transaction().add(ix1);
    await sendAndConfirmTransaction(ctx.connection, tx1, [ctx.requester]);

    // Create second escrow
    const ix2 = buildCreateEscrowInstruction(
      intentId2,
      amount2,
      ctx.requester.publicKey,
      ctx.tokenMint,
      ctx.requesterTokenAccount,
      ctx.solver.publicKey
    );
    const tx2 = new Transaction().add(ix2);
    await sendAndConfirmTransaction(ctx.connection, tx2, [ctx.requester]);

    // Verify both vaults have correct balances
    const vault1Balance = await getTokenBalance(ctx.connection, vaultPda1);
    const vault2Balance = await getTokenBalance(ctx.connection, vaultPda2);
    expect(vault1Balance).to.equal(Number(amount1));
    expect(vault2Balance).to.equal(Number(amount2));
  });

  /// Test: Escrow Expiry Timestamp
  /// Verifies that escrow expiry is set correctly (current time + EXPIRY_DURATION).
  /// Why: Expiry must be correct for time-based cancel functionality.
  it("Should set correct expiry timestamp", async function () {
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
    // Escrow format: [8 discriminator][32 requester][32 tokenMint][8 amount][1 isClaimed][8 expiry]...
    const expiryBytes = escrowData!.data.slice(81, 89);
    const expiry = Buffer.from(expiryBytes).readBigInt64LE(0);

    // DEFAULT_EXPIRY_DURATION is 120 seconds (2 minutes, matching EVM)
    const DEFAULT_EXPIRY_DURATION = 120n;

    // Expiry should be approximately blockTime + DEFAULT_EXPIRY_DURATION
    expect(Number(expiry)).to.be.closeTo(
      blockTime! + Number(DEFAULT_EXPIRY_DURATION),
      10 // 10 second tolerance
    );
  });
});
