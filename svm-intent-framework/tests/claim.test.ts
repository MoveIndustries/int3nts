import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { expect } from "chai";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
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

describe("IntentEscrow - Claim", function () {
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

    // Create escrow
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
  });

  // ============================================================================
  // SIGNATURE VERIFICATION TESTS
  // ============================================================================

  /// Test: Valid Claim with Verifier Signature
  /// Verifies that solvers can claim escrow funds with valid verifier signature.
  /// Why: Claiming is the core fulfillment mechanism.
  ///
  /// Note: This test uses Ed25519 instruction introspection. The verifier signs
  /// the intent_id, and we include the Ed25519 verify instruction in the transaction.
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

    // Create transaction with Ed25519 verify instruction first
    const tx = new Transaction()
      .add(ed25519Instruction)
      .add(claimIx);

    // Send transaction (no additional signers needed, provider handles fee payer)
    const txSig = await ctx.provider.sendAndConfirm(tx, []);

    // Verify funds transferred to solver
    const solverBalance = await getTokenBalance(ctx.provider, ctx.solverTokenAccount);
    expect(solverBalance).to.equal(amount.toNumber());

    // Verify vault is empty
    const vaultBalance = await getTokenBalance(ctx.provider, vaultPda);
    expect(vaultBalance).to.equal(0);

    // Verify escrow state
    const escrow = await ctx.program.account.escrow.fetch(escrowPda);
    expect(escrow.isClaimed).to.equal(true);
    expect(escrow.amount.toNumber()).to.equal(0);
  });

  /// Test: Signature Replay Prevention
  /// Verifies that a signature for one intent_id cannot be reused on a different escrow.
  /// Why: Signatures must be bound to specific intent_ids to prevent replay attacks.
  it("Should prevent signature replay across different intent_ids", async function () {
    // Create a second escrow with a different intent_id
    const intentIdB = generateIntentId();
    const [escrowPdaB] = getEscrowPda(ctx.program.programId, intentIdB);
    const [vaultPdaB] = getVaultPda(ctx.program.programId, intentIdB);

    await ctx.program.methods
      .createEscrow(Array.from(intentIdB), amount, null)
      .accounts({
        escrow: escrowPdaB,
        requester: ctx.requester.publicKey,
        tokenMint: ctx.tokenMint,
        requesterTokenAccount: ctx.requesterTokenAccount,
        escrowVault: vaultPdaB,
        reservedSolver: ctx.solver.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([ctx.requester])
      .rpc();

    // Create a VALID signature for intent_id A (the first escrow)
    const messageA = Buffer.from(intentId);
    const signatureForA = nacl.sign.detached(messageA, ctx.verifier.secretKey);

    // Create Ed25519 instruction for intent A signature
    const ed25519Instruction = Ed25519Program.createInstructionWithPublicKey({
      publicKey: ctx.verifier.publicKey.toBytes(),
      message: messageA,
      signature: signatureForA,
    });

    // Try to use the signature for intent_id A on escrow B
    // This should fail because the message (intent_id) doesn't match
    const claimIx = await ctx.program.methods
      .claim(Array.from(intentIdB), Array.from(signatureForA))
      .accounts({
        escrow: escrowPdaB,
        state: ctx.statePda,
        escrowVault: vaultPdaB,
        solverTokenAccount: ctx.solverTokenAccount,
        instructionSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
        tokenProgram: TOKEN_PROGRAM_ID,
        clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
      })
      .instruction();

    const tx = new Transaction()
      .add(ed25519Instruction)
      .add(claimIx);

    try {
      await ctx.provider.sendAndConfirm(tx, []);
      expect.fail("Should have thrown an error");
    } catch (err) {
      expect(err.toString()).to.include("InvalidSignature");
    }
  });

  /// Test: Invalid Signature Rejection
  /// Verifies that claims with invalid signatures are rejected.
  /// Why: Security requirement - only verifier-approved claims should succeed.
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

    const claimIx = await ctx.program.methods
      .claim(Array.from(intentId), Array.from(wrongSignature))
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

    const tx = new Transaction()
      .add(ed25519Instruction)
      .add(claimIx);

    try {
      await ctx.provider.sendAndConfirm(tx, []);
      expect.fail("Should have thrown an error");
    } catch (err) {
      expect(err.toString()).to.include("UnauthorizedVerifier");
    }
  });

  /// Test: Duplicate Claim Prevention
  /// Verifies that attempting to claim an already-claimed escrow reverts.
  /// Why: Prevents double-spending.
  it("Should revert if escrow already claimed", async function () {
    // First claim
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

    const tx = new Transaction()
      .add(ed25519Instruction)
      .add(claimIx);

    await ctx.provider.sendAndConfirm(tx, []);

    // Second claim should fail
    const tx2 = new Transaction()
      .add(ed25519Instruction)
      .add(claimIx);

    try {
      await ctx.provider.sendAndConfirm(tx2, []);
      expect.fail("Should have thrown an error");
    } catch (err) {
      expect(err.toString()).to.include("EscrowAlreadyClaimed");
    }
  });

  /// Test: Non-Existent Escrow Rejection
  /// Verifies that claiming a non-existent escrow reverts.
  /// Why: Prevents claims on non-existent escrows.
  it("Should revert if escrow does not exist", async function () {
    const nonExistentIntentId = generateIntentId();
    const [nonExistentEscrowPda] = getEscrowPda(ctx.program.programId, nonExistentIntentId);
    const [nonExistentVaultPda] = getVaultPda(ctx.program.programId, nonExistentIntentId);

    const message = Buffer.from(nonExistentIntentId);
    const signature = nacl.sign.detached(message, ctx.verifier.secretKey);

    const ed25519Instruction = Ed25519Program.createInstructionWithPublicKey({
      publicKey: ctx.verifier.publicKey.toBytes(),
      message: message,
      signature: signature,
    });

    const claimIx = await ctx.program.methods
      .claim(Array.from(nonExistentIntentId), Array.from(signature))
      .accounts({
        escrow: nonExistentEscrowPda,
        state: ctx.statePda,
        escrowVault: nonExistentVaultPda,
        solverTokenAccount: ctx.solverTokenAccount,
        instructionSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
        tokenProgram: TOKEN_PROGRAM_ID,
        clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
      })
      .instruction();

    const tx = new Transaction()
      .add(ed25519Instruction)
      .add(claimIx);

    try {
      await ctx.provider.sendAndConfirm(tx, []);
      expect.fail("Should have thrown an error");
    } catch (err) {
      expect(err.toString()).to.include("AccountNotInitialized");
    }
  });
});
