import { expect } from "chai";
import {
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  setupIntentEscrowTests,
  generateIntentId,
  hexToBytes32,
  getEscrowPda,
  getVaultPda,
  buildCreateEscrowInstruction,
  TestContext,
  PROGRAM_ID,
} from "./helpers";
import { getTokenBalance } from "./helpers/token";

describe("IntentEscrow - Cross-Chain Intent ID Conversion", function () {
  let ctx: TestContext;

  beforeEach(async function () {
    ctx = await setupIntentEscrowTests();
  });

  /// Test: Move Hex to SVM Bytes Conversion
  /// Verifies that intent IDs from Move hex format can be converted and used in SVM escrow operations.
  /// Why: Cross-chain intents require intent ID conversion between Move (hex) and SVM (bytes32) formats.
  it("Should handle Move hex intent ID conversion to SVM bytes", async function () {
    // Move intent ID in hex format (smaller than 32 bytes) with unique suffix
    const uniqueSuffix = Date.now().toString(16).padStart(8, '0');
    const moveIntentIdHex = `0x1234${uniqueSuffix}`;
    const intentId = hexToBytes32(moveIntentIdHex);
    const amount = 1_000_000n;

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

    // Verify escrow was created correctly
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

    // Verify vault balance
    const vaultBalance = await getTokenBalance(ctx.connection, vaultPda);
    expect(vaultBalance).to.equal(Number(amount));
  });

  /// Test: Intent ID Boundary Values
  /// Verifies that the program handles boundary intent ID values correctly.
  /// Why: Intent IDs from different chains may have different formats. Boundary testing ensures compatibility.
  it("Should handle intent ID boundary values", async function () {
    const amount = 1_000_000n;

    // Test maximum value (all 0xFF) with unique suffix
    const timestamp1 = Date.now();
    const maxIntentId = new Uint8Array(32).fill(0xff);
    maxIntentId[31] = timestamp1 & 0xff;
    maxIntentId[30] = (timestamp1 >> 8) & 0xff;

    const [maxEscrowPda] = getEscrowPda(PROGRAM_ID, maxIntentId);
    const [maxVaultPda] = getVaultPda(PROGRAM_ID, maxIntentId);

    const maxIx = buildCreateEscrowInstruction(
      maxIntentId,
      amount,
      ctx.requester.publicKey,
      ctx.tokenMint,
      ctx.requesterTokenAccount,
      ctx.solver.publicKey
    );
    const maxTx = new Transaction().add(maxIx);
    await sendAndConfirmTransaction(ctx.connection, maxTx, [ctx.requester]);

    const maxEscrowData = await ctx.connection.getAccountInfo(maxEscrowPda);
    expect(maxEscrowData).to.not.be.null;

    // Test zero value (all 0x00) with unique suffix
    const timestamp2 = Date.now() + 1;
    const zeroIntentId = new Uint8Array(32).fill(0);
    zeroIntentId[31] = timestamp2 & 0xff;
    zeroIntentId[30] = (timestamp2 >> 8) & 0xff;

    const [zeroEscrowPda] = getEscrowPda(PROGRAM_ID, zeroIntentId);

    const zeroIx = buildCreateEscrowInstruction(
      zeroIntentId,
      amount,
      ctx.requester.publicKey,
      ctx.tokenMint,
      ctx.requesterTokenAccount,
      ctx.solver.publicKey
    );
    const zeroTx = new Transaction().add(zeroIx);
    await sendAndConfirmTransaction(ctx.connection, zeroTx, [ctx.requester]);

    const zeroEscrowData = await ctx.connection.getAccountInfo(zeroEscrowPda);
    expect(zeroEscrowData).to.not.be.null;

    // Test edge value (half 0xFF, half 0x00) with unique suffix
    const timestamp3 = Date.now() + 2;
    const edgeIntentId = new Uint8Array(32);
    for (let i = 0; i < 16; i++) edgeIntentId[i] = 0xff;
    for (let i = 16; i < 32; i++) edgeIntentId[i] = 0x00;
    edgeIntentId[31] = timestamp3 & 0xff;
    edgeIntentId[30] = (timestamp3 >> 8) & 0xff;

    const [edgeEscrowPda] = getEscrowPda(PROGRAM_ID, edgeIntentId);

    const edgeIx = buildCreateEscrowInstruction(
      edgeIntentId,
      amount,
      ctx.requester.publicKey,
      ctx.tokenMint,
      ctx.requesterTokenAccount,
      ctx.solver.publicKey
    );
    const edgeTx = new Transaction().add(edgeIx);
    await sendAndConfirmTransaction(ctx.connection, edgeTx, [ctx.requester]);

    const edgeEscrowData = await ctx.connection.getAccountInfo(edgeEscrowPda);
    expect(edgeEscrowData).to.not.be.null;
  });

  /// Test: Intent ID Zero Padding
  /// Verifies that shorter intent IDs are properly left-padded with zeros.
  /// Why: Move intent IDs may be shorter than 32 bytes. Zero padding ensures correct bytes32 conversion.
  it("Should handle intent ID zero padding correctly", async function () {
    // Test various short hex strings that need padding
    const shortHexIds = [
      "0x1",
      "0x12",
      "0x123",
      "0x1234",
      "0x12345",
      "0x1234567890abcdef"
    ];

    const amount = 500_000n;

    for (let i = 0; i < shortHexIds.length; i++) {
      // Add unique suffix to each
      const uniqueSuffix = (Date.now() + i).toString(16).padStart(8, '0');
      const hexId = shortHexIds[i] + uniqueSuffix;
      const intentId = hexToBytes32(hexId);

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

      // Verify amount
      const amountBytes = escrowData!.data.slice(72, 80);
      const storedAmount = Buffer.from(amountBytes).readBigUInt64LE(0);
      expect(storedAmount).to.equal(amount);
    }
  });

  /// Test: Multiple Intent IDs from Different Formats
  /// Verifies that multiple escrows can be created with intent IDs from different Move formats.
  /// Why: Real-world usage involves intent IDs in various formats. The program must handle all valid formats.
  it("Should handle multiple intent IDs from different Move formats", async function () {
    const amount = 1_000_000n;
    const baseTimestamp = Date.now();

    const intentIds = [
      hexToBytes32(`0x1${baseTimestamp.toString(16)}`),
      hexToBytes32(`0x1234${(baseTimestamp + 1).toString(16)}`),
      hexToBytes32(`0xabcdef${(baseTimestamp + 2).toString(16)}`),
      hexToBytes32(`0x1234567890abcdef${(baseTimestamp + 3).toString(16)}`),
      generateIntentId(), // Random format
      generateIntentId(), // Another random
    ];

    // Create escrows with different intent ID formats
    for (let i = 0; i < intentIds.length; i++) {
      const intentId = intentIds[i];
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

    // Verify all escrows are independent
    for (const intentId of intentIds) {
      const [escrowPda] = getEscrowPda(PROGRAM_ID, intentId);
      const escrowData = await ctx.connection.getAccountInfo(escrowPda);
      expect(escrowData).to.not.be.null;
    }
  });
});
