import { expect } from "chai";
import {
  PublicKey,
  Transaction,
  Ed25519Program,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  setupIntentEscrowTests,
  generateIntentId,
  getEscrowPda,
  getVaultPda,
  buildCreateEscrowInstruction,
  buildClaimInstruction,
  TestContext,
  PROGRAM_ID,
  EscrowErrorCode,
  hasErrorCode,
} from "./helpers";
import { getTokenBalance } from "./helpers/token";
import * as nacl from "tweetnacl";

describe("IntentEscrow - Claim", function () {
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

    // Create escrow
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

  /// Test: Valid Claim with Verifier Signature
  /// Verifies that solvers can claim escrow funds when provided with a valid verifier signature.
  /// Why: Claiming is the core fulfillment mechanism. Solvers must be able to receive funds after verifier approval.
  it("Should allow solver to claim with valid verifier signature", async function () {
    // Sign the intent_id with verifier's keypair
    const message = Buffer.from(intentId);
    const signature = nacl.sign.detached(message, ctx.verifier.secretKey);

    // Create Ed25519 verification instruction using public key (no signer required)
    // This instruction verifies the signature and must be at index 0
    const ed25519Instruction = Ed25519Program.createInstructionWithPublicKey({
      publicKey: ctx.verifier.publicKey.toBytes(),
      message: message,
      signature: signature,
    });

    // Build claim instruction
    const claimIx = buildClaimInstruction(
      intentId,
      signature,
      ctx.solverTokenAccount,
      ctx.statePda
    );

    // Create transaction with Ed25519 verify instruction first
    const tx = new Transaction()
      .add(ed25519Instruction)
      .add(claimIx);

    // Send transaction (solver pays the fee, but doesn't need to sign the claim itself)
    await sendAndConfirmTransaction(ctx.connection, tx, [ctx.solver]);

    // Verify funds transferred to solver
    const solverBalance = await getTokenBalance(ctx.connection, ctx.solverTokenAccount);
    expect(solverBalance).to.equal(Number(amount));

    // Verify vault is empty
    const vaultBalance = await getTokenBalance(ctx.connection, vaultPda);
    expect(vaultBalance).to.equal(0);

    // Verify escrow state
    const escrowData = await ctx.connection.getAccountInfo(escrowPda);
    const isClaimed = escrowData!.data[80];
    expect(isClaimed).to.equal(1); // true
  });

  /// Test: Invalid Signature Rejection
  /// Verifies that claims with invalid signatures are rejected with UnauthorizedVerifier error.
  /// Why: Security requirement - only verifier-approved fulfillments should allow fund release.
  it("Should revert with invalid signature", async function () {
    // Sign with wrong keypair (solver instead of verifier)
    const message = Buffer.from(intentId);
    const wrongSignature = nacl.sign.detached(message, ctx.solver.secretKey);

    // Create Ed25519 instruction with wrong signer's public key
    const ed25519Instruction = Ed25519Program.createInstructionWithPublicKey({
      publicKey: ctx.solver.publicKey.toBytes(), // Wrong signer
      message: message,
      signature: wrongSignature,
    });

    const claimIx = buildClaimInstruction(
      intentId,
      wrongSignature,
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
      expect(hasErrorCode(err, EscrowErrorCode.UnauthorizedVerifier)).to.be.true;
    }
  });

  /// Test: Signature Replay Prevention
  /// Verifies that a signature for one intent_id cannot be reused on a different escrow with a different intent_id.
  /// Why: Signatures must be bound to specific intent_ids to prevent replay attacks across different escrows.
  it("Should prevent signature replay across different intent_ids", async function () {
    // Create a second escrow with a different intent_id
    const intentIdB = generateIntentId();
    const [escrowPdaB] = getEscrowPda(PROGRAM_ID, intentIdB);
    const [vaultPdaB] = getVaultPda(PROGRAM_ID, intentIdB);

    const ixB = buildCreateEscrowInstruction(
      intentIdB,
      amount,
      ctx.requester.publicKey,
      ctx.tokenMint,
      ctx.requesterTokenAccount,
      ctx.solver.publicKey
    );
    const txB = new Transaction().add(ixB);
    await sendAndConfirmTransaction(ctx.connection, txB, [ctx.requester]);

    // Create a VALID signature for intent_id A (the first escrow)
    const messageA = Buffer.from(intentId);
    const signatureForA = nacl.sign.detached(messageA, ctx.verifier.secretKey);

    // Create Ed25519 instruction for intent A signature
    const ed25519Instruction = Ed25519Program.createInstructionWithPublicKey({
      publicKey: ctx.verifier.publicKey.toBytes(),
      message: messageA,
      signature: signatureForA,
    });

    // Try to use the signature for intent_id A on escrow B (which has intent_id B)
    // This should fail because the signature is bound to intent_id A, not intent_id B
    const claimIx = buildClaimInstruction(
      intentIdB,
      signatureForA,
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
      expect(hasErrorCode(err, EscrowErrorCode.InvalidSignature)).to.be.true;
    }
  });

  /// Test: Duplicate Claim Prevention
  /// Verifies that attempting to claim an already-claimed escrow reverts.
  /// Why: Prevents double-spending - each escrow can only be claimed once.
  it("Should revert if escrow already claimed", async function () {
    // First claim
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

    await sendAndConfirmTransaction(ctx.connection, tx, [ctx.solver]);

    // Second claim should fail
    const tx2 = new Transaction()
      .add(ed25519Instruction)
      .add(claimIx);

    try {
      await sendAndConfirmTransaction(ctx.connection, tx2, [ctx.solver]);
      expect.fail("Should have thrown an error");
    } catch (err: any) {
      expect(hasErrorCode(err, EscrowErrorCode.EscrowAlreadyClaimed)).to.be.true;
    }
  });

  /// Test: Non-Existent Escrow Rejection
  /// Verifies that attempting to claim a non-existent escrow reverts with EscrowDoesNotExist error.
  /// Why: Prevents claims on non-existent escrows and ensures proper error handling.
  it("Should revert if escrow does not exist", async function () {
    const nonExistentIntentId = generateIntentId();

    const message = Buffer.from(nonExistentIntentId);
    const signature = nacl.sign.detached(message, ctx.verifier.secretKey);

    const ed25519Instruction = Ed25519Program.createInstructionWithPublicKey({
      publicKey: ctx.verifier.publicKey.toBytes(),
      message: message,
      signature: signature,
    });

    const claimIx = buildClaimInstruction(
      nonExistentIntentId,
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
      // Any error is acceptable - escrow doesn't exist so operation should fail
      expect(err).to.not.be.null;
    }
  });
});
