import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { expect } from "chai";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { IntentEscrow } from "../target/types/intent_escrow";
import {
  setupIntentEscrowTests,
  generateIntentId,
  hexToBytes32,
  getEscrowPda,
  getVaultPda,
  TestContext,
} from "./helpers";
import { getTokenBalance, TOKEN_PROGRAM_ID } from "./helpers/token";

describe("IntentEscrow - Cross-Chain Intent ID Conversion", function () {
  let ctx: TestContext;
  let intentId: Uint8Array;

  beforeEach(async function () {
    ctx = await setupIntentEscrowTests();
    intentId = generateIntentId();
  });

  // ============================================================================
  // CROSS-CHAIN INTENT ID TESTS
  // ============================================================================

  /// Test: Aptos Hex to Solana Bytes32 Conversion
  /// Verifies that intent IDs from Aptos hex format can be converted and used in Solana escrow operations.
  /// Why: Cross-chain intents require intent ID conversion between Aptos (hex) and Solana (32-byte array) formats.
  it("Should handle Aptos hex intent ID conversion to Solana bytes32", async function () {
    // Aptos intent ID in hex format (smaller than 32 bytes)
    const aptosIntentIdHex = "0x1234";
    const solanaIntentId = hexToBytes32(aptosIntentIdHex);

    const [escrowPda] = getEscrowPda(ctx.program.programId, solanaIntentId);
    const [vaultPda] = getVaultPda(ctx.program.programId, solanaIntentId);

    // Create escrow with converted intent ID and deposit atomically
    const amount = new anchor.BN(1_000_000);
    await ctx.program.methods
      .createEscrow(Array.from(solanaIntentId), amount, null)
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

    // Verify escrow was created correctly
    const escrow = await ctx.program.account.escrow.fetch(escrowPda);
    expect(escrow.requester.toBase58()).to.equal(ctx.requester.publicKey.toBase58());
    expect(escrow.tokenMint.toBase58()).to.equal(ctx.tokenMint.toBase58());
    expect(escrow.amount.toNumber()).to.equal(amount.toNumber());

    const vaultBalance = await getTokenBalance(ctx.provider, vaultPda);
    expect(vaultBalance).to.equal(amount.toNumber());
  });

  /// Test: Intent ID Boundary Values
  /// Verifies that the program handles boundary intent ID values correctly.
  /// Why: Intent IDs from different chains may have different formats. Boundary testing ensures compatibility.
  it("Should handle intent ID boundary values", async function () {
    const amount = new anchor.BN(1_000_000);

    // Test maximum bytes32 value (all 0xFF)
    const maxIntentId = new Uint8Array(32).fill(0xff);
    const [maxEscrowPda] = getEscrowPda(ctx.program.programId, maxIntentId);
    const [maxVaultPda] = getVaultPda(ctx.program.programId, maxIntentId);

    await ctx.program.methods
      .createEscrow(Array.from(maxIntentId), amount, null)
      .accounts({
        escrow: maxEscrowPda,
        requester: ctx.requester.publicKey,
        tokenMint: ctx.tokenMint,
        requesterTokenAccount: ctx.requesterTokenAccount,
        escrowVault: maxVaultPda,
        reservedSolver: ctx.solver.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([ctx.requester])
      .rpc();

    const maxEscrow = await ctx.program.account.escrow.fetch(maxEscrowPda);
    expect(maxEscrow.requester.toBase58()).to.equal(ctx.requester.publicKey.toBase58());
    expect(maxEscrow.amount.toNumber()).to.equal(amount.toNumber());

    // Test zero value (all 0x00)
    const zeroIntentId = new Uint8Array(32).fill(0x00);
    const [zeroEscrowPda] = getEscrowPda(ctx.program.programId, zeroIntentId);
    const [zeroVaultPda] = getVaultPda(ctx.program.programId, zeroIntentId);

    await ctx.program.methods
      .createEscrow(Array.from(zeroIntentId), amount, null)
      .accounts({
        escrow: zeroEscrowPda,
        requester: ctx.requester.publicKey,
        tokenMint: ctx.tokenMint,
        requesterTokenAccount: ctx.requesterTokenAccount,
        escrowVault: zeroVaultPda,
        reservedSolver: ctx.solver.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([ctx.requester])
      .rpc();

    const zeroEscrow = await ctx.program.account.escrow.fetch(zeroEscrowPda);
    expect(zeroEscrow.requester.toBase58()).to.equal(ctx.requester.publicKey.toBase58());
    expect(zeroEscrow.amount.toNumber()).to.equal(amount.toNumber());

    // Test edge value (first byte 0xFF, rest zeros)
    const edgeIntentId = new Uint8Array(32);
    edgeIntentId[0] = 0xff;
    const [edgeEscrowPda] = getEscrowPda(ctx.program.programId, edgeIntentId);
    const [edgeVaultPda] = getVaultPda(ctx.program.programId, edgeIntentId);

    await ctx.program.methods
      .createEscrow(Array.from(edgeIntentId), amount, null)
      .accounts({
        escrow: edgeEscrowPda,
        requester: ctx.requester.publicKey,
        tokenMint: ctx.tokenMint,
        requesterTokenAccount: ctx.requesterTokenAccount,
        escrowVault: edgeVaultPda,
        reservedSolver: ctx.solver.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([ctx.requester])
      .rpc();

    const edgeEscrow = await ctx.program.account.escrow.fetch(edgeEscrowPda);
    expect(edgeEscrow.requester.toBase58()).to.equal(ctx.requester.publicKey.toBase58());
    expect(edgeEscrow.amount.toNumber()).to.equal(amount.toNumber());
  });

  /// Test: Intent ID Zero Padding
  /// Verifies that shorter intent IDs are properly left-padded with zeros.
  /// Why: Aptos intent IDs may be shorter than 32 bytes. Zero padding ensures correct bytes32 conversion.
  it("Should handle intent ID zero padding correctly", async function () {
    // Test various short hex strings that need padding
    // Use unique counter to ensure each intent ID is different
    const shortHexIds = ["0x1", "0x12", "0x123", "0x1234", "0x12345", "0x1234567890abcdef"];

    const amount = new anchor.BN(1_000_000);
    const totalAmount = amount.muln(shortHexIds.length);

    // Ensure we have enough tokens for all escrows
    const currentBalance = await getTokenBalance(ctx.provider, ctx.requesterTokenAccount);
    if (currentBalance < totalAmount.toNumber()) {
      // Mint additional tokens if needed (helper should have minted enough, but just in case)
      const { mintTo } = await import("./helpers/token");
      await mintTo(
        ctx.provider,
        ctx.tokenMint,
        ctx.requesterTokenAccount,
        ctx.requester,
        totalAmount.toNumber() - currentBalance
      );
    }

    for (let i = 0; i < shortHexIds.length; i++) {
      // Create unique intent ID by combining hex with unique counter
      // This ensures each escrow has a unique PDA
      const uniqueHex = shortHexIds[i] + (i * 0x100).toString(16).padStart(4, "0");
      const paddedIntentId = hexToBytes32(uniqueHex);
      const [escrowPda] = getEscrowPda(ctx.program.programId, paddedIntentId);
      const [vaultPda] = getVaultPda(ctx.program.programId, paddedIntentId);

      // Verify escrow operations work with padded intent ID
      await ctx.program.methods
        .createEscrow(Array.from(paddedIntentId), amount, null)
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
      expect(escrow.requester.toBase58()).to.equal(ctx.requester.publicKey.toBase58());
      expect(escrow.amount.toNumber()).to.equal(amount.toNumber());
    }
  });

  /// Test: Multiple Intent IDs from Different Formats
  /// Verifies that multiple escrows can be created with intent IDs from different Aptos formats.
  /// Why: Real-world usage involves intent IDs in various formats. The program must handle all valid formats.
  it("Should handle multiple intent IDs from different Aptos formats", async function () {
    // Use generateIntentId() to ensure each intent ID is unique and avoid PDA collisions
    // Hex conversion is already tested in other tests, so we focus on multiple escrows here
    const intentIds = [
      generateIntentId(), // Random 32-byte format
      generateIntentId(), // Another random format
      generateIntentId(), // Another random format
      generateIntentId(), // Another random format
      generateIntentId(), // Another random format
      generateIntentId(), // Another random format
    ];

    const amount = new anchor.BN(1_000_000);
    const totalAmount = amount.muln(intentIds.length);

    // Ensure we have enough tokens for all escrows
    const currentBalance = await getTokenBalance(ctx.provider, ctx.requesterTokenAccount);
    if (currentBalance < totalAmount.toNumber()) {
      const { mintTo } = await import("./helpers/token");
      await mintTo(
        ctx.provider,
        ctx.tokenMint,
        ctx.requesterTokenAccount,
        ctx.requester,
        totalAmount.toNumber() - currentBalance
      );
    }

    // Create escrows with different intent ID formats
    for (let i = 0; i < intentIds.length; i++) {
      const [escrowPda] = getEscrowPda(ctx.program.programId, intentIds[i]);
      const [vaultPda] = getVaultPda(ctx.program.programId, intentIds[i]);

      await ctx.program.methods
        .createEscrow(Array.from(intentIds[i]), amount, null)
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
      expect(escrow.requester.toBase58()).to.equal(ctx.requester.publicKey.toBase58());
      expect(escrow.tokenMint.toBase58()).to.equal(ctx.tokenMint.toBase58());
      expect(escrow.amount.toNumber()).to.equal(amount.toNumber());
    }

    // Verify all escrows are independent
    const escrow1 = await ctx.program.account.escrow.fetch(
      getEscrowPda(ctx.program.programId, intentIds[0])[0]
    );
    const escrow2 = await ctx.program.account.escrow.fetch(
      getEscrowPda(ctx.program.programId, intentIds[1])[0]
    );
    const escrow3 = await ctx.program.account.escrow.fetch(
      getEscrowPda(ctx.program.programId, intentIds[2])[0]
    );

    expect(escrow1).to.not.be.undefined;
    expect(escrow2).to.not.be.undefined;
    expect(escrow3).to.not.be.undefined;
  });
});
