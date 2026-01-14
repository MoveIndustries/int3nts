import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { expect } from "chai";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
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
import {
  createMint,
  createTokenAccounts,
  getTokenBalance,
  TOKEN_PROGRAM_ID,
  mintTo,
} from "./helpers/token";
import * as nacl from "tweetnacl";

describe("IntentEscrow - Error Conditions", function () {
  let ctx: TestContext;
  let intentId: Uint8Array;
  let escrowPda: PublicKey;
  let vaultPda: PublicKey;

  beforeEach(async function () {
    ctx = await setupIntentEscrowTests();
    intentId = generateIntentId();
    [escrowPda] = getEscrowPda(ctx.program.programId, intentId);
    [vaultPda] = getVaultPda(ctx.program.programId, intentId);
  });

  // ============================================================================
  // AMOUNT VALIDATION TESTS
  // ============================================================================

  /// Test: Zero Amount Rejection
  /// Verifies that createEscrow reverts when amount is zero.
  /// Why: Zero-amount escrows are meaningless and could cause accounting issues.
  it("Should revert with zero amount in createEscrow", async function () {
    const amount = new anchor.BN(0);

    try {
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
      expect.fail("Should have thrown an error");
    } catch (err: any) {
      expect(err.toString()).to.include("InvalidAmount");
    }
  });

  /// Test: Insufficient Balance Rejection
  /// Verifies that createEscrow reverts when SPL token balance is insufficient.
  /// Why: SPL token transfers require sufficient balance. Insufficient balance must be rejected.
  it("Should revert with insufficient SPL token balance", async function () {
    const amount = new anchor.BN(1_000_000_000_000); // Very large amount

    try {
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
      expect.fail("Should have thrown an error");
    } catch (err: any) {
      // Should fail due to insufficient balance
      expect(err.toString()).to.satisfy(
        (msg: string) =>
          msg.includes("insufficient funds") ||
          msg.includes("InsufficientFunds") ||
          msg.includes("0x1")
      );
    }
  });

  /// Test: Maximum Value Edge Case
  /// Verifies that createEscrow handles maximum u64 values correctly.
  /// Why: Edge case testing ensures the program doesn't overflow or fail on boundary values.
  ///
  it("Should handle maximum u64 value in createEscrow", async function () {
    const maxAmount = new anchor.BN("18446744073709551615"); // 2^64 - 1

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

    await ctx.program.methods
      .createEscrow(Array.from(intentId), maxAmount, null)
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
  });

  // ============================================================================
  // SIGNATURE VALIDATION TESTS
  // ============================================================================

  /// Test: Invalid Signature Length Rejection
  /// Verifies that claim reverts with invalid signature length.
  /// Why: Ed25519 signatures must be exactly 64 bytes. Invalid lengths indicate malformed signatures.
  ///
  /// NOTE: Ed25519Program.createInstructionWithPublicKey validates signature length before
  /// the transaction is sent, so we can't test this at the program level. The validation
  /// happens in the client library. This test is skipped but documented for completeness.
  it.skip("Should revert with invalid signature length", async function () {
    // This test cannot be implemented because Ed25519Program.createInstructionWithPublicKey
    // validates signature length (must be 64 bytes) before the transaction is sent.
    // The validation happens in @solana/web3.js, not in our program.
    // In practice, invalid signature lengths are caught by the client library.
  });

  // ============================================================================
  // NON-EXISTENT ESCROW TESTS
  // ============================================================================

  /// Test: Non-Existent Escrow Cancellation Rejection
  /// Verifies that cancel reverts with EscrowDoesNotExist for non-existent escrows.
  /// Why: Prevents cancellation of non-existent escrows and ensures proper error handling.
  it("Should revert cancel on non-existent escrow", async function () {
    const nonExistentIntentId = generateIntentId();
    const [nonExistentEscrowPda] = getEscrowPda(ctx.program.programId, nonExistentIntentId);
    const [nonExistentVaultPda] = getVaultPda(ctx.program.programId, nonExistentIntentId);

    try {
      await ctx.program.methods
        .cancel(Array.from(nonExistentIntentId))
        .accounts({
          escrow: nonExistentEscrowPda,
          requester: ctx.requester.publicKey,
          escrowVault: nonExistentVaultPda,
          requesterTokenAccount: ctx.requesterTokenAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
          clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
        })
        .signers([ctx.requester])
        .rpc();
      expect.fail("Should have thrown an error");
    } catch (err: any) {
      expect(err.toString()).to.include("AccountNotInitialized");
    }
  });
});
