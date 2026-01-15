import { expect } from "chai";
import {
  Keypair,
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

describe("IntentEscrow - Error Conditions", function () {
  let ctx: TestContext;

  beforeEach(async function () {
    ctx = await setupIntentEscrowTests();
  });

  // ============================================================================
  // VALIDATION ERROR TESTS
  // ============================================================================

  /// Test: Zero Amount Rejection
  /// Verifies that escrows cannot be created with zero amount.
  /// Why: Zero-amount escrows have no value and waste resources.
  it("Should reject zero amount", async function () {
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

  /// Test: Zero Solver Address Rejection
  /// Verifies that escrows cannot be created with zero/default solver address.
  /// Why: A valid solver must be specified for claims.
  it("Should reject zero solver address", async function () {
    const intentId = generateIntentId();
    const amount = 1_000_000n;

    const ix = buildCreateEscrowInstruction(
      intentId,
      amount,
      ctx.requester.publicKey,
      ctx.tokenMint,
      ctx.requesterTokenAccount,
      PublicKey.default // Zero address
    );

    const tx = new Transaction().add(ix);

    try {
      await sendAndConfirmTransaction(ctx.connection, tx, [ctx.requester]);
      expect.fail("Should have thrown an error");
    } catch (err: any) {
      expect(err.toString()).to.include("custom program error");
    }
  });

  // ============================================================================
  // DUPLICATE ESCROW TESTS
  // ============================================================================

  /// Test: Duplicate Intent ID Rejection
  /// Verifies that escrows with duplicate intent IDs are rejected.
  /// Why: Each intent ID must map to exactly one escrow.
  it("Should reject duplicate intent ID", async function () {
    const intentId = generateIntentId();
    const amount = 1_000_000n;

    // Create first escrow
    const ix1 = buildCreateEscrowInstruction(
      intentId,
      amount,
      ctx.requester.publicKey,
      ctx.tokenMint,
      ctx.requesterTokenAccount,
      ctx.solver.publicKey
    );
    const tx1 = new Transaction().add(ix1);
    await sendAndConfirmTransaction(ctx.connection, tx1, [ctx.requester]);

    // Try to create second escrow with same intent ID
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

  // ============================================================================
  // INSUFFICIENT BALANCE TESTS
  // ============================================================================

  /// Test: Insufficient Token Balance Rejection
  /// Verifies that escrow creation fails if requester has insufficient tokens.
  /// Why: Cannot deposit more tokens than available.
  it("Should reject if requester has insufficient balance", async function () {
    const intentId = generateIntentId();
    const amount = 1_000_000_000_000n; // More than minted

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
      // Token transfer error
      expect(err.toString()).to.satisfy(
        (msg: string) => msg.includes("insufficient") || msg.includes("custom program error")
      );
    }
  });

  // ============================================================================
  // ALLOWANCE TESTS
  // ============================================================================

  // Test: Insufficient Allowance Rejection
  // EVM: evm-intent-framework/test/error-conditions.test.js - "Should revert with insufficient ERC20 allowance"
  // N/A for SVM: SPL tokens don't use approve/allowance pattern like ERC20

  // ============================================================================
  // MAXIMUM VALUE TESTS
  // ============================================================================

  // Test: Maximum Value Edge Case
  // EVM: evm-intent-framework/test/error-conditions.test.js - "Should handle maximum uint256 value in createEscrow"
  // N/A for SVM: Partially covered in edge-cases.test.ts. Solana uses u64 for amounts (not uint256)

  // ============================================================================
  // NATIVE CURRENCY TESTS
  // ============================================================================

  // Test: Native Currency Escrow Creation with address(0)
  // EVM: evm-intent-framework/test/error-conditions.test.js - "Should allow ETH escrow creation with address(0)"
  // N/A for SVM: No native currency escrow equivalent - all escrows use SPL tokens

  // Test: Native Currency Amount Mismatch Rejection
  // EVM: evm-intent-framework/test/error-conditions.test.js - "Should revert with ETH amount mismatch"
  // N/A for SVM: No native currency deposits - no msg.value equivalent

  // Test: Native Currency Not Accepted for Token Escrow
  // EVM: evm-intent-framework/test/error-conditions.test.js - "Should revert when ETH sent with token address"
  // N/A for SVM: No native currency/token distinction - all escrows use SPL tokens

  // ============================================================================
  // SIGNATURE VALIDATION TESTS
  // ============================================================================

  // Test: Invalid Signature Length Rejection
  // EVM: evm-intent-framework/test/error-conditions.test.js - "Should revert with invalid signature length"
  // N/A for SVM: Signature validation handled by Ed25519Program, not the escrow program

  // ============================================================================
  // NON-EXISTENT ESCROW TESTS
  // ============================================================================

  // Test: Non-Existent Escrow Cancellation Rejection
  // EVM: evm-intent-framework/test/error-conditions.test.js - "Should revert cancel on non-existent escrow"
  // N/A for SVM: Already covered in cancel.test.ts - "Should revert if escrow does not exist"
});
