const { expect } = require("chai");
const { ethers } = require("hardhat");
const {
  setupInflowEscrowGmpTests,
  addressToBytes32,
  getExpiryTimestamp,
  deliverRequirements,
  DEFAULT_AMOUNT
} = require("./helpers/setup");

describe("IntentInflowEscrow - Edge Cases", function () {
  let escrow;
  let gmpEndpoint;
  let token;
  let requester;
  let solver;
  let intentId;

  beforeEach(async function () {
    const fixtures = await setupInflowEscrowGmpTests();
    escrow = fixtures.escrow;
    gmpEndpoint = fixtures.gmpEndpoint;
    token = fixtures.token;
    requester = fixtures.requester;
    solver = fixtures.solver;
    intentId = fixtures.intentId;
  });

  // ============================================================================
  // EDGE CASE TESTS
  // ============================================================================

  /// 1. Test: Maximum Values
  /// Verifies that createEscrowWithValidation handles maximum uint64 amount values.
  /// Why: Edge case testing ensures the contract handles boundary values correctly.
  /// Note: Amount is uint64 in GMP messages, not uint256.
  it("Should handle maximum uint64 values for amounts", async function () {
    const maxAmount = BigInt("18446744073709551615"); // Max uint64
    const maxIntentId = "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";

    const tokenAddr32 = addressToBytes32(token.target);
    const requesterAddr32 = addressToBytes32(requester.address);
    const solverAddr32 = addressToBytes32(solver.address);
    const expiry = await getExpiryTimestamp();

    // Mint maximum amount
    await token.mint(requester.address, maxAmount);
    await token.connect(requester).approve(escrow.target, maxAmount);

    // Deliver requirements and create escrow
    await deliverRequirements(
      gmpEndpoint,
      maxIntentId,
      requesterAddr32,
      maxAmount,
      tokenAddr32,
      solverAddr32,
      expiry
    );

    await expect(
      escrow.connect(requester).createEscrowWithValidation(maxIntentId, token.target, maxAmount)
    ).to.emit(escrow, "EscrowCreated");

    const escrowData = await escrow.getEscrow(maxIntentId);
    expect(escrowData.amount).to.equal(maxAmount);
  });

  /// 2. Test: Minimum Deposit Amount
  /// Verifies edge cases around minimum deposit amounts (1 unit).
  /// Why: Ensures the contract accepts the minimum valid amount without rejecting it as zero.
  it("Should handle minimum deposit amount (1 unit)", async function () {
    const minAmount = 1n;
    const testIntentId = "0xbb000000000000000000000000000000000000000000000000000000000000cc";

    const tokenAddr32 = addressToBytes32(token.target);
    const requesterAddr32 = addressToBytes32(requester.address);
    const solverAddr32 = addressToBytes32(solver.address);
    const expiry = await getExpiryTimestamp();

    await token.mint(requester.address, minAmount);
    await token.connect(requester).approve(escrow.target, minAmount);

    await deliverRequirements(
      gmpEndpoint,
      testIntentId,
      requesterAddr32,
      minAmount,
      tokenAddr32,
      solverAddr32,
      expiry
    );

    await expect(
      escrow.connect(requester).createEscrowWithValidation(testIntentId, token.target, minAmount)
    ).to.emit(escrow, "EscrowCreated");

    const escrowData = await escrow.getEscrow(testIntentId);
    expect(escrowData.amount).to.equal(minAmount);
  });

  /// 3. Test: Multiple Escrows Per Requester
  /// Verifies that a requester can create multiple escrows with different intent IDs.
  /// Why: Requesters may need multiple concurrent escrows for different intents.
  it("Should allow requester to create multiple escrows", async function () {
    const numEscrows = 10;
    const tokenAddr32 = addressToBytes32(token.target);
    const requesterAddr32 = addressToBytes32(requester.address);
    const solverAddr32 = addressToBytes32(solver.address);
    const expiry = await getExpiryTimestamp();

    // Create multiple escrows with sequential intent IDs
    for (let i = 0; i < numEscrows; i++) {
      const testIntentId = ethers.zeroPadValue(ethers.toBeHex(i + 1), 32);

      await deliverRequirements(
        gmpEndpoint,
        testIntentId,
        requesterAddr32,
        DEFAULT_AMOUNT,
        tokenAddr32,
        solverAddr32,
        expiry,
        i + 1
      );

      await expect(
        escrow.connect(requester).createEscrowWithValidation(testIntentId, token.target, DEFAULT_AMOUNT)
      ).to.emit(escrow, "EscrowCreated");

      const escrowData = await escrow.getEscrow(testIntentId);
      expect(escrowData.amount).to.equal(DEFAULT_AMOUNT);
    }
  });

  /// 4. Test: Gas Limit Scenarios
  /// Verifies gas consumption for escrow creation.
  /// Why: Gas efficiency is critical for user experience.
  it("Should handle gas consumption for escrow operations", async function () {
    const numEscrows = 5;
    const tokenAddr32 = addressToBytes32(token.target);
    const requesterAddr32 = addressToBytes32(requester.address);
    const solverAddr32 = addressToBytes32(solver.address);
    const expiry = await getExpiryTimestamp();

    const gasEstimates = [];

    for (let i = 0; i < numEscrows; i++) {
      const testIntentId = ethers.zeroPadValue(ethers.toBeHex(i + 100), 32);

      await deliverRequirements(
        gmpEndpoint,
        testIntentId,
        requesterAddr32,
        DEFAULT_AMOUNT,
        tokenAddr32,
        solverAddr32,
        expiry,
        i + 1
      );

      const tx = await escrow.connect(requester).createEscrowWithValidation(
        testIntentId,
        token.target,
        DEFAULT_AMOUNT
      );
      const receipt = await tx.wait();
      gasEstimates.push(receipt.gasUsed);
    }

    // Verify all transactions succeeded
    expect(gasEstimates.length).to.equal(numEscrows);
    // Verify gas usage is reasonable (less than 500k gas per transaction)
    gasEstimates.forEach(gas => {
      expect(gas).to.be.below(500000n);
    });
  });

  /// 5. Test: Concurrent Operations
  /// Verifies that multiple simultaneous escrow operations can be handled correctly.
  /// Why: Real-world usage involves concurrent operations.
  it("Should handle concurrent escrow operations", async function () {
    const numEscrows = 5;
    const tokenAddr32 = addressToBytes32(token.target);
    const requesterAddr32 = addressToBytes32(requester.address);
    const solverAddr32 = addressToBytes32(solver.address);
    const expiry = await getExpiryTimestamp();

    // First deliver all requirements
    for (let i = 0; i < numEscrows; i++) {
      const testIntentId = ethers.zeroPadValue(ethers.toBeHex(i + 200), 32);
      await deliverRequirements(
        gmpEndpoint,
        testIntentId,
        requesterAddr32,
        DEFAULT_AMOUNT,
        tokenAddr32,
        solverAddr32,
        expiry,
        i + 1
      );
    }

    // Create multiple escrows concurrently
    const promises = [];
    for (let i = 0; i < numEscrows; i++) {
      const testIntentId = ethers.zeroPadValue(ethers.toBeHex(i + 200), 32);
      promises.push(
        escrow.connect(requester).createEscrowWithValidation(testIntentId, token.target, DEFAULT_AMOUNT)
      );
    }

    // Wait for all transactions
    const results = await Promise.all(promises);

    // Verify all succeeded
    expect(results.length).to.equal(numEscrows);

    // Verify all escrows were created correctly
    for (let i = 0; i < numEscrows; i++) {
      const testIntentId = ethers.zeroPadValue(ethers.toBeHex(i + 200), 32);
      const escrowData = await escrow.getEscrow(testIntentId);
      expect(escrowData.amount).to.equal(DEFAULT_AMOUNT);
    }
  });
});
