import { expect } from "chai";
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL,
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
import * as borsh from "borsh";

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
    // Read state account and verify verifier
    const stateData = await ctx.connection.getAccountInfo(ctx.statePda);
    expect(stateData).to.not.be.null;

    // State format: [8 bytes discriminator][32 bytes verifier]
    const verifierBytes = stateData!.data.slice(8, 40);
    const verifier = new PublicKey(verifierBytes);
    expect(verifier.toBase58()).to.equal(ctx.verifier.publicKey.toBase58());
  });

  // ============================================================================
  // ESCROW CREATION TESTS
  // ============================================================================

  /// Test: Escrow Creation
  /// Verifies that requesters can create a new escrow with funds atomically.
  /// Why: Escrow creation must be atomic and set expiry correctly.
  it("Should allow requester to create an escrow", async function () {
    const intentId = generateIntentId();
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

    // Verify escrow data by reading raw account
    const escrowData = await ctx.connection.getAccountInfo(escrowPda);
    expect(escrowData).to.not.be.null;

    // Escrow format: [8 discriminator][32 requester][32 tokenMint][8 amount][1 isClaimed][8 expiry][32 reservedSolver][32 intentId][1 bump]
    const requesterBytes = escrowData!.data.slice(8, 40);
    const requester = new PublicKey(requesterBytes);
    expect(requester.toBase58()).to.equal(ctx.requester.publicKey.toBase58());

    const amountBytes = escrowData!.data.slice(72, 80);
    const storedAmount = Buffer.from(amountBytes).readBigUInt64LE(0);
    expect(storedAmount).to.equal(amount);

    const isClaimed = escrowData!.data[80];
    expect(isClaimed).to.equal(0);

    // Verify vault balance
    const vaultBalance = await getTokenBalance(ctx.connection, vaultPda);
    expect(vaultBalance).to.equal(Number(amount));
  });

  /// Test: Duplicate Creation Prevention
  /// Verifies that attempting to create an escrow with an existing intent ID reverts.
  /// Why: Each intent ID must map to a single escrow.
  it("Should revert if escrow already exists", async function () {
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

    // Second creation with same intent ID should fail
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
      // Account already initialized error
      expect(err.toString()).to.include("already in use");
    }
  });

  /// Test: Zero Amount Prevention
  /// Verifies that escrows cannot be created with zero amount.
  /// Why: Zero-amount escrows are invalid.
  it("Should revert if amount is zero", async function () {
    const intentId = generateIntentId();
    const amount = 0n;

    const ix = buildCreateEscrowInstruction(
      intentId,
      amount,
      ctx.requester.publicKey,
      ctx.tokenMint,
      ctx.requesterTokenAccount,
      ctx.solver.publicKey
    );

    const tx = new Transaction().add(ix);

    try {
      await sendAndConfirmTransaction(ctx.connection, tx, [ctx.requester]);
      expect.fail("Should have thrown an error");
    } catch (err: any) {
      expect(err.toString()).to.include("custom program error");
    }
  });
});
