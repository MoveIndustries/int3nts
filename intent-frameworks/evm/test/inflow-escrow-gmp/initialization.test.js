const { expect } = require("chai");
const { ethers } = require("hardhat");
const {
  setupInflowEscrowGmpTests,
  addressToBytes32,
  getExpiryTimestamp,
  deliverRequirements,
  HUB_CHAIN_ID,
  HUB_GMP_ENDPOINT_ADDR,
  DEFAULT_AMOUNT
} = require("./helpers/setup");

describe("IntentInflowEscrow - Initialization", function () {
  let escrow;
  let gmpEndpoint;
  let token;
  let admin;
  let requester;
  let solver;
  let intentId;

  beforeEach(async function () {
    const fixtures = await setupInflowEscrowGmpTests();
    escrow = fixtures.escrow;
    gmpEndpoint = fixtures.gmpEndpoint;
    token = fixtures.token;
    admin = fixtures.admin;
    requester = fixtures.requester;
    solver = fixtures.solver;
    intentId = fixtures.intentId;
  });

  /// 1. Test: test_initialize_gmp_endpoint: GMP Endpoint Initialization
  /// Verifies that the escrow is deployed with the correct GMP endpoint address.
  /// Why: The GMP endpoint is critical for cross-chain message routing.
  it("Should initialize escrow with GMP endpoint address", async function () {
    expect(await escrow.gmpEndpoint()).to.equal(gmpEndpoint.target);
  });

  /// 2. Test: test_initialize_hub_chain_config: Hub Chain Configuration
  /// Verifies that the escrow is deployed with the correct hub chain ID and hub GMP endpoint address.
  /// Why: Hub chain configuration is required for validating incoming GMP messages.
  it("Should initialize escrow with hub chain configuration", async function () {
    expect(await escrow.hubChainId()).to.equal(HUB_CHAIN_ID);
    expect(await escrow.hubGmpEndpointAddr()).to.equal(HUB_GMP_ENDPOINT_ADDR);
  });

  /// 3. Test: test_create_escrow_after_requirements: Escrow Creation After Requirements
  /// Verifies that requesters can create an escrow after receiving requirements.
  /// Why: Escrow creation is the first step after hub sends IntentRequirements.
  it("Should allow requester to create an escrow after requirements received", async function () {
    const tokenAddr32 = addressToBytes32(token.target);
    const requesterAddr32 = addressToBytes32(requester.address);
    const solverAddr32 = addressToBytes32(solver.address);
    const expiry = await getExpiryTimestamp();

    // Deliver requirements from hub
    await deliverRequirements(
      gmpEndpoint,
      intentId,
      requesterAddr32,
      DEFAULT_AMOUNT,
      tokenAddr32,
      solverAddr32,
      expiry
    );

    // Create escrow
    await expect(
      escrow.connect(requester).createEscrowWithValidation(
        intentId,
        token.target,
        DEFAULT_AMOUNT
      )
    ).to.emit(escrow, "EscrowCreated");

    expect(await escrow.hasEscrow(intentId)).to.equal(true);
  });

  /// 4. Test: test_duplicate_escrow_prevention: Duplicate Escrow Prevention
  /// Verifies that attempting to create an escrow with an existing intent ID reverts.
  /// Why: Each intent ID must map to a single escrow to maintain state consistency.
  it("Should revert if escrow already exists", async function () {
    const tokenAddr32 = addressToBytes32(token.target);
    const requesterAddr32 = addressToBytes32(requester.address);
    const solverAddr32 = addressToBytes32(solver.address);
    const expiry = await getExpiryTimestamp();

    // Deliver requirements and create first escrow
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

    // Try to create second escrow with same intent ID
    await expect(
      escrow.connect(requester).createEscrowWithValidation(
        intentId,
        token.target,
        DEFAULT_AMOUNT
      )
    ).to.be.revertedWithCustomError(escrow, "E_ESCROW_ALREADY_CREATED");
  });

  /// 5. Test: test_zero_amount_prevention: Zero Amount Prevention
  /// Verifies that escrows cannot be created with zero amount.
  /// Why: Zero-amount escrows are invalid.
  it("Should revert if amount is zero", async function () {
    const tokenAddr32 = addressToBytes32(token.target);
    const requesterAddr32 = addressToBytes32(requester.address);
    const solverAddr32 = addressToBytes32(solver.address);
    const expiry = await getExpiryTimestamp();
    const zeroAmount = 0n;

    // Deliver requirements with zero amount
    await deliverRequirements(
      gmpEndpoint,
      intentId,
      requesterAddr32,
      zeroAmount,
      tokenAddr32,
      solverAddr32,
      expiry
    );

    await expect(
      escrow.connect(requester).createEscrowWithValidation(
        intentId,
        token.target,
        zeroAmount
      )
    ).to.be.revertedWithCustomError(escrow, "E_ZERO_AMOUNT");
  });
});
