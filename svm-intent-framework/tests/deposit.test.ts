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
import { getTokenBalance, TOKEN_PROGRAM_ID } from "./helpers/token";
import * as nacl from "tweetnacl";

describe("IntentEscrow - Deposit", function () {
  let ctx: TestContext;

  beforeEach(async function () {
    ctx = await setupIntentEscrowTests();
  });

  // ============================================================================
  // TOKEN DEPOSIT TESTS
  // ============================================================================

  /// Test: Token Deposit on Escrow Creation
  /// Verifies that tokens are correctly transferred from requester to vault on creation.
  /// Why: Atomic creation + deposit is the core escrow mechanism.
  it("Should deposit tokens to vault on escrow creation", async function () {
    const intentId = generateIntentId();
    const amount = new anchor.BN(1_000_000);

    const [escrowPda] = getEscrowPda(ctx.program.programId, intentId);
    const [vaultPda] = getVaultPda(ctx.program.programId, intentId);

    // Get initial balance
    const initialRequesterBalance = await getTokenBalance(
      ctx.provider,
      ctx.requesterTokenAccount
    );

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

    // Verify requester balance decreased
    const finalRequesterBalance = await getTokenBalance(
      ctx.provider,
      ctx.requesterTokenAccount
    );
    expect(finalRequesterBalance).to.equal(initialRequesterBalance - amount.toNumber());

    // Verify vault balance increased
    const vaultBalance = await getTokenBalance(ctx.provider, vaultPda);
    expect(vaultBalance).to.equal(amount.toNumber());
  });

  /// Test: Multiple Escrows with Different Tokens
  /// Verifies that multiple escrows can be created for different intent IDs.
  /// Why: System must support concurrent escrows.
  it("Should support multiple escrows with different intent IDs", async function () {
    const intentId1 = generateIntentId();
    const intentId2 = generateIntentId();
    const amount1 = new anchor.BN(1_000_000);
    const amount2 = new anchor.BN(2_000_000);

    const [escrowPda1] = getEscrowPda(ctx.program.programId, intentId1);
    const [vaultPda1] = getVaultPda(ctx.program.programId, intentId1);
    const [escrowPda2] = getEscrowPda(ctx.program.programId, intentId2);
    const [vaultPda2] = getVaultPda(ctx.program.programId, intentId2);

    // Create first escrow
    await ctx.program.methods
      .createEscrow(Array.from(intentId1), amount1, null)
      .accounts({
        escrow: escrowPda1,
        requester: ctx.requester.publicKey,
        tokenMint: ctx.tokenMint,
        requesterTokenAccount: ctx.requesterTokenAccount,
        escrowVault: vaultPda1,
        reservedSolver: ctx.solver.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([ctx.requester])
      .rpc();

    // Create second escrow
    await ctx.program.methods
      .createEscrow(Array.from(intentId2), amount2, null)
      .accounts({
        escrow: escrowPda2,
        requester: ctx.requester.publicKey,
        tokenMint: ctx.tokenMint,
        requesterTokenAccount: ctx.requesterTokenAccount,
        escrowVault: vaultPda2,
        reservedSolver: ctx.solver.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([ctx.requester])
      .rpc();

    // Verify both vaults have correct balances
    const vault1Balance = await getTokenBalance(ctx.provider, vaultPda1);
    const vault2Balance = await getTokenBalance(ctx.provider, vaultPda2);
    expect(vault1Balance).to.equal(amount1.toNumber());
    expect(vault2Balance).to.equal(amount2.toNumber());

    // Verify both escrows have correct data
    const escrow1 = await ctx.program.account.escrow.fetch(escrowPda1);
    const escrow2 = await ctx.program.account.escrow.fetch(escrowPda2);
    expect(escrow1.amount.toNumber()).to.equal(amount1.toNumber());
    expect(escrow2.amount.toNumber()).to.equal(amount2.toNumber());
  });

  /// Test: Escrow Expiry Timestamp
  /// Verifies that escrow expiry is set correctly (current time + EXPIRY_DURATION).
  /// Why: Expiry must be correct for time-based cancel functionality.
  it("Should set correct expiry timestamp", async function () {
    const intentId = generateIntentId();
    const amount = new anchor.BN(1_000_000);

    const [escrowPda] = getEscrowPda(ctx.program.programId, intentId);
    const [vaultPda] = getVaultPda(ctx.program.programId, intentId);

    // Get current slot time before transaction
    const slot = await ctx.provider.connection.getSlot();
    const blockTime = await ctx.provider.connection.getBlockTime(slot);

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

    const escrow = await ctx.program.account.escrow.fetch(escrowPda);
    
    // DEFAULT_EXPIRY_DURATION is 120 seconds (2 minutes, matching EVM)
    const DEFAULT_EXPIRY_DURATION = 120;
    
    // Expiry should be approximately blockTime + DEFAULT_EXPIRY_DURATION
    // Allow some tolerance for block time differences
    expect(escrow.expiry.toNumber()).to.be.closeTo(
      blockTime! + DEFAULT_EXPIRY_DURATION,
      10 // 10 second tolerance
    );
  });

  /// Test: Escrow Creation After Claim Prevention
  /// Verifies that escrows cannot be created with an intent ID that was already used.
  /// Why: Prevents duplicate escrows and ensures each intent ID maps to a single escrow state.
  it("Should revert if escrow already exists (after claim)", async function () {
    const intentId = generateIntentId();
    const amount = new anchor.BN(1_000_000);

    const [escrowPda] = getEscrowPda(ctx.program.programId, intentId);
    const [vaultPda] = getVaultPda(ctx.program.programId, intentId);

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

    // Claim the escrow
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

    // Try to create another escrow with same intent ID - should fail
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
    } catch (err) {
      // Account already exists
      expect(err.toString()).to.include("already in use");
    }
  });
});
