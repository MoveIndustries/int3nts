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
  getTokenBalance,
  TOKEN_PROGRAM_ID,
  createMint,
  createTokenAccounts,
  mintTo,
} from "./helpers/token";
import * as nacl from "tweetnacl";

describe("IntentEscrow - Integration Tests", function () {
  let ctx: TestContext;
  let intentId: Uint8Array;

  beforeEach(async function () {
    ctx = await setupIntentEscrowTests();
    intentId = generateIntentId();
  });

  // ============================================================================
  // COMPLETE WORKFLOW TESTS
  // ============================================================================

  /// Test: Complete Deposit to Claim Workflow
  /// Verifies the full workflow from escrow creation through claim.
  /// Why: Integration test ensures all components work together correctly in the happy path.
  it("Should complete full deposit to claim workflow", async function () {
    const amount = new anchor.BN(1_000_000);
    const [escrowPda] = getEscrowPda(ctx.program.programId, intentId);
    const [vaultPda] = getVaultPda(ctx.program.programId, intentId);

    // Step 1: Get initial balances
    const requesterBalanceBefore = await getTokenBalance(ctx.provider, ctx.requesterTokenAccount);
    const solverBalanceBefore = await getTokenBalance(ctx.provider, ctx.solverTokenAccount);

    // Step 2: Create escrow
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

    // Step 3: Verify escrow state
    const escrowDataBefore = await ctx.program.account.escrow.fetch(escrowPda);
    expect(escrowDataBefore.requester.toBase58()).to.equal(ctx.requester.publicKey.toBase58());
    expect(escrowDataBefore.amount.toNumber()).to.equal(amount.toNumber());
    expect(escrowDataBefore.isClaimed).to.equal(false);

    const vaultBalanceBefore = await getTokenBalance(ctx.provider, vaultPda);
    expect(vaultBalanceBefore).to.equal(amount.toNumber());

    // Step 4: Generate verifier signature for claim
    const message = Buffer.from(intentId);
    const signature = nacl.sign.detached(message, ctx.verifier.secretKey);

    // Step 5: Claim escrow
    expect(solverBalanceBefore).to.equal(0);

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

    const tx = new Transaction().add(ed25519Instruction).add(claimIx);
    await ctx.provider.sendAndConfirm(tx, []);

    // Step 5: Verify final state
    const escrowDataAfter = await ctx.program.account.escrow.fetch(escrowPda);
    expect(escrowDataAfter.isClaimed).to.equal(true);
    expect(escrowDataAfter.amount.toNumber()).to.equal(0);

    const solverBalanceAfter = await getTokenBalance(ctx.provider, ctx.solverTokenAccount);
    expect(solverBalanceAfter).to.equal(amount.toNumber());

    const vaultBalanceAfter = await getTokenBalance(ctx.provider, vaultPda);
    expect(vaultBalanceAfter).to.equal(0);

    const requesterBalanceAfter = await getTokenBalance(ctx.provider, ctx.requesterTokenAccount);
    // Requester should have initial balance minus the amount that was escrowed
    expect(requesterBalanceAfter).to.equal(requesterBalanceBefore - amount.toNumber());
  });

  /// Test: Multi-Token Scenarios
  /// Verifies that the escrow works with different SPL token mints.
  /// Why: The escrow must support any SPL token, not just a single token type.
  it("Should handle multiple different SPL token mints", async function () {
    // Create additional token mints
    const tokenMint1 = await createMint(ctx.provider, ctx.requester);
    const tokenMint2 = await createMint(ctx.provider, ctx.requester);
    const tokenMint3 = await createMint(ctx.provider, ctx.requester);

    const { requesterTokenAccount: tokenAccount1 } = await createTokenAccounts(
      ctx.provider,
      tokenMint1,
      ctx.requester,
      ctx.solver
    );
    const { requesterTokenAccount: tokenAccount2 } = await createTokenAccounts(
      ctx.provider,
      tokenMint2,
      ctx.requester,
      ctx.solver
    );
    const { requesterTokenAccount: tokenAccount3 } = await createTokenAccounts(
      ctx.provider,
      tokenMint3,
      ctx.requester,
      ctx.solver
    );

    const amount1 = new anchor.BN(1_000_000);
    const amount2 = new anchor.BN(2_000_000);
    const amount3 = new anchor.BN(3_000_000);

    await mintTo(ctx.provider, tokenMint1, tokenAccount1, ctx.requester, amount1.toNumber());
    await mintTo(ctx.provider, tokenMint2, tokenAccount2, ctx.requester, amount2.toNumber());
    await mintTo(ctx.provider, tokenMint3, tokenAccount3, ctx.requester, amount3.toNumber());

    const intentId1 = generateIntentId();
    const intentId2 = generateIntentId();
    const intentId3 = generateIntentId();

    const [escrowPda1] = getEscrowPda(ctx.program.programId, intentId1);
    const [vaultPda1] = getVaultPda(ctx.program.programId, intentId1);
    const [escrowPda2] = getEscrowPda(ctx.program.programId, intentId2);
    const [vaultPda2] = getVaultPda(ctx.program.programId, intentId2);
    const [escrowPda3] = getEscrowPda(ctx.program.programId, intentId3);
    const [vaultPda3] = getVaultPda(ctx.program.programId, intentId3);

    // Create escrows with different tokens
    await ctx.program.methods
      .createEscrow(Array.from(intentId1), amount1, null)
      .accounts({
        escrow: escrowPda1,
        requester: ctx.requester.publicKey,
        tokenMint: tokenMint1,
        requesterTokenAccount: tokenAccount1,
        escrowVault: vaultPda1,
        reservedSolver: ctx.solver.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([ctx.requester])
      .rpc();

    await ctx.program.methods
      .createEscrow(Array.from(intentId2), amount2, null)
      .accounts({
        escrow: escrowPda2,
        requester: ctx.requester.publicKey,
        tokenMint: tokenMint2,
        requesterTokenAccount: tokenAccount2,
        escrowVault: vaultPda2,
        reservedSolver: ctx.solver.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([ctx.requester])
      .rpc();

    await ctx.program.methods
      .createEscrow(Array.from(intentId3), amount3, null)
      .accounts({
        escrow: escrowPda3,
        requester: ctx.requester.publicKey,
        tokenMint: tokenMint3,
        requesterTokenAccount: tokenAccount3,
        escrowVault: vaultPda3,
        reservedSolver: ctx.solver.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([ctx.requester])
      .rpc();

    // Verify all escrows were created correctly
    const escrow1 = await ctx.program.account.escrow.fetch(escrowPda1);
    const escrow2 = await ctx.program.account.escrow.fetch(escrowPda2);
    const escrow3 = await ctx.program.account.escrow.fetch(escrowPda3);

    expect(escrow1.tokenMint.toBase58()).to.equal(tokenMint1.toBase58());
    expect(escrow1.amount.toNumber()).to.equal(amount1.toNumber());
    expect(escrow2.tokenMint.toBase58()).to.equal(tokenMint2.toBase58());
    expect(escrow2.amount.toNumber()).to.equal(amount2.toNumber());
    expect(escrow3.tokenMint.toBase58()).to.equal(tokenMint3.toBase58());
    expect(escrow3.amount.toNumber()).to.equal(amount3.toNumber());

    // Verify balances
    expect(await getTokenBalance(ctx.provider, vaultPda1)).to.equal(amount1.toNumber());
    expect(await getTokenBalance(ctx.provider, vaultPda2)).to.equal(amount2.toNumber());
    expect(await getTokenBalance(ctx.provider, vaultPda3)).to.equal(amount3.toNumber());
  });

  /// Test: Complete Cancellation Workflow
  /// Verifies the full workflow from escrow creation through cancellation after expiry.
  /// Why: Integration test ensures the cancellation flow works end-to-end after expiry.
  it("Should complete full cancellation workflow", async function () {
    this.timeout(10000); // 10 second timeout

    const amount = new anchor.BN(1_000_000);
    const [escrowPda] = getEscrowPda(ctx.program.programId, intentId);
    const [vaultPda] = getVaultPda(ctx.program.programId, intentId);

    // Step 1: Create escrow with 2-second expiry
    await ctx.program.methods
      .createEscrow(Array.from(intentId), amount, new anchor.BN(2))
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

    // Step 2: Verify escrow state before expiry
    const escrowDataBefore = await ctx.program.account.escrow.fetch(escrowPda);
    expect(escrowDataBefore.requester.toBase58()).to.equal(ctx.requester.publicKey.toBase58());
    expect(escrowDataBefore.amount.toNumber()).to.equal(amount.toNumber());
    expect(escrowDataBefore.isClaimed).to.equal(false);

    const vaultBalanceBefore = await getTokenBalance(ctx.provider, vaultPda);
    expect(vaultBalanceBefore).to.equal(amount.toNumber());

    // Step 3: Wait for expiry (2 seconds + 2 second buffer)
    await new Promise((resolve) => setTimeout(resolve, 4000));

    // Step 4: Cancel escrow
    const requesterBalanceBefore = await getTokenBalance(ctx.provider, ctx.requesterTokenAccount);

    await ctx.program.methods
      .cancel(Array.from(intentId))
      .accounts({
        escrow: escrowPda,
        requester: ctx.requester.publicKey,
        escrowVault: vaultPda,
        requesterTokenAccount: ctx.requesterTokenAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
        clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
      })
      .signers([ctx.requester])
      .rpc();

    // Step 5: Verify final state
    const escrowDataAfter = await ctx.program.account.escrow.fetch(escrowPda);
    expect(escrowDataAfter.amount.toNumber()).to.equal(0);

    const requesterBalanceAfter = await getTokenBalance(ctx.provider, ctx.requesterTokenAccount);
    expect(requesterBalanceAfter).to.equal(requesterBalanceBefore + amount.toNumber());

    const vaultBalanceAfter = await getTokenBalance(ctx.provider, vaultPda);
    expect(vaultBalanceAfter).to.equal(0);
  });
});
