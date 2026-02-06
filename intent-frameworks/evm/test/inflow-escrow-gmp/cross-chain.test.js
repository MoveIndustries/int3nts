const { expect } = require("chai");
const { ethers } = require("hardhat");
const {
  setupInflowEscrowGmpTests,
  addressToBytes32,
  getExpiryTimestamp,
  deliverRequirements,
  DEFAULT_AMOUNT
} = require("./helpers/setup");

describe("IntentInflowEscrow - Cross-Chain Intent ID Handling", function () {
  let escrow;
  let gmpEndpoint;
  let token;
  let requester;
  let solver;

  beforeEach(async function () {
    const fixtures = await setupInflowEscrowGmpTests();
    escrow = fixtures.escrow;
    gmpEndpoint = fixtures.gmpEndpoint;
    token = fixtures.token;
    requester = fixtures.requester;
    solver = fixtures.solver;
  });

  // ============================================================================
  // CROSS-CHAIN INTENT ID TESTS (bytes32 format)
  // ============================================================================

  /// 1. Test: Hex Intent ID Handling
  /// Verifies that intent IDs in bytes32 hex format work correctly.
  /// Why: Cross-chain intents use 32-byte identifiers for compatibility across chains.
  it("Should handle bytes32 intent ID correctly", async function () {
    // Intent ID in bytes32 hex format
    const intentId = "0x0000000000000000000000000000000000000000000000000000000000001234";

    const tokenAddr32 = addressToBytes32(token.target);
    const requesterAddr32 = addressToBytes32(requester.address);
    const solverAddr32 = addressToBytes32(solver.address);
    const expiry = await getExpiryTimestamp();

    // Deliver requirements and create escrow
    await deliverRequirements(
      gmpEndpoint,
      intentId,
      requesterAddr32,
      DEFAULT_AMOUNT,
      tokenAddr32,
      solverAddr32,
      expiry
    );

    await escrow.connect(requester).createEscrowWithValidation(
      intentId,
      token.target,
      DEFAULT_AMOUNT
    );

    // Verify escrow was created correctly
    expect(await escrow.hasEscrow(intentId)).to.equal(true);
    const escrowData = await escrow.getEscrow(intentId);
    expect(escrowData.amount).to.equal(DEFAULT_AMOUNT);
  });

  /// 2. Test: Intent ID Boundary Values
  /// Verifies that the contract handles boundary intent ID values correctly.
  /// Why: Intent IDs from different chains may have different formats. Boundary testing ensures compatibility.
  it("Should handle intent ID boundary values", async function () {
    const tokenAddr32 = addressToBytes32(token.target);
    const requesterAddr32 = addressToBytes32(requester.address);
    const solverAddr32 = addressToBytes32(solver.address);
    const expiry = await getExpiryTimestamp();

    // Test maximum bytes32 value
    const maxIntentId = "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";
    await deliverRequirements(gmpEndpoint, maxIntentId, requesterAddr32, DEFAULT_AMOUNT, tokenAddr32, solverAddr32, expiry, 1);
    await escrow.connect(requester).createEscrowWithValidation(maxIntentId, token.target, DEFAULT_AMOUNT);
    expect(await escrow.hasEscrow(maxIntentId)).to.equal(true);

    // Test zero value
    const zeroIntentId = "0x0000000000000000000000000000000000000000000000000000000000000000";
    await deliverRequirements(gmpEndpoint, zeroIntentId, requesterAddr32, DEFAULT_AMOUNT, tokenAddr32, solverAddr32, expiry, 2);
    await escrow.connect(requester).createEscrowWithValidation(zeroIntentId, token.target, DEFAULT_AMOUNT);
    expect(await escrow.hasEscrow(zeroIntentId)).to.equal(true);

    // Test mid-range value
    const midIntentId = "0x00000000000000000000000000000000ffffffffffffffffffffffffffffffff";
    await deliverRequirements(gmpEndpoint, midIntentId, requesterAddr32, DEFAULT_AMOUNT, tokenAddr32, solverAddr32, expiry, 3);
    await escrow.connect(requester).createEscrowWithValidation(midIntentId, token.target, DEFAULT_AMOUNT);
    expect(await escrow.hasEscrow(midIntentId)).to.equal(true);
  });

  /// 3. Test: Intent ID With Various Patterns
  /// Verifies that the contract handles various intent ID patterns correctly.
  /// Why: Real-world intent IDs may have various byte patterns.
  it("Should handle intent IDs with various patterns", async function () {
    const tokenAddr32 = addressToBytes32(token.target);
    const requesterAddr32 = addressToBytes32(requester.address);
    const solverAddr32 = addressToBytes32(solver.address);
    const expiry = await getExpiryTimestamp();

    const intentIds = [
      "0x0000000000000000000000000000000000000000000000000000000000000001",
      "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
      "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
      "0xaa00000000000000000000000000000000000000000000000000000000000000",
      "0x00000000000000000000000000000000000000000000000000000000000000ff"
    ];

    for (let i = 0; i < intentIds.length; i++) {
      await deliverRequirements(
        gmpEndpoint,
        intentIds[i],
        requesterAddr32,
        DEFAULT_AMOUNT,
        tokenAddr32,
        solverAddr32,
        expiry,
        i + 1
      );
      await escrow.connect(requester).createEscrowWithValidation(
        intentIds[i],
        token.target,
        DEFAULT_AMOUNT
      );
      expect(await escrow.hasEscrow(intentIds[i])).to.equal(true);
    }
  });

  /// 4. Test: Multiple Intent IDs Are Independent
  /// Verifies that multiple escrows with different intent IDs are independent.
  /// Why: Each intent ID must map to its own escrow state.
  it("Should handle multiple independent intent IDs", async function () {
    const tokenAddr32 = addressToBytes32(token.target);
    const requesterAddr32 = addressToBytes32(requester.address);
    const solverAddr32 = addressToBytes32(solver.address);
    const expiry = await getExpiryTimestamp();

    const intentId1 = "0x1111111111111111111111111111111111111111111111111111111111111111";
    const intentId2 = "0x2222222222222222222222222222222222222222222222222222222222222222";
    const intentId3 = "0x3333333333333333333333333333333333333333333333333333333333333333";

    const amount1 = DEFAULT_AMOUNT;
    const amount2 = DEFAULT_AMOUNT * 2n;
    const amount3 = DEFAULT_AMOUNT * 3n;

    // Create three independent escrows
    await deliverRequirements(gmpEndpoint, intentId1, requesterAddr32, amount1, tokenAddr32, solverAddr32, expiry, 1);
    await deliverRequirements(gmpEndpoint, intentId2, requesterAddr32, amount2, tokenAddr32, solverAddr32, expiry, 2);
    await deliverRequirements(gmpEndpoint, intentId3, requesterAddr32, amount3, tokenAddr32, solverAddr32, expiry, 3);

    await escrow.connect(requester).createEscrowWithValidation(intentId1, token.target, amount1);
    await escrow.connect(requester).createEscrowWithValidation(intentId2, token.target, amount2);
    await escrow.connect(requester).createEscrowWithValidation(intentId3, token.target, amount3);

    // Verify all escrows are independent
    const escrow1 = await escrow.getEscrow(intentId1);
    const escrow2 = await escrow.getEscrow(intentId2);
    const escrow3 = await escrow.getEscrow(intentId3);

    expect(escrow1.amount).to.equal(amount1);
    expect(escrow2.amount).to.equal(amount2);
    expect(escrow3.amount).to.equal(amount3);
  });
});
