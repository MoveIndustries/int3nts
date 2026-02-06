const { expect } = require("chai");
const { ethers } = require("hardhat");
const {
  setupInflowEscrowGmpTests,
  addressToBytes32,
  getExpiryTimestamp,
  deliverRequirements,
  DEFAULT_AMOUNT
} = require("./helpers/setup");

describe("IntentInflowEscrow - Create Escrow (Deposit)", function () {
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

  /// 1. Test: Token Escrow Creation
  /// Verifies that requesters can create an escrow with ERC20 tokens after receiving requirements.
  /// Why: Escrow creation is the first step after hub sends IntentRequirements. Requesters must be able to lock funds securely.
  it("Should allow requester to create escrow with tokens", async function () {
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

    expect(await token.balanceOf(escrow.target)).to.equal(DEFAULT_AMOUNT);

    const escrowData = await escrow.getEscrow(intentId);
    expect(escrowData.amount).to.equal(DEFAULT_AMOUNT);
  });

  /// 2. Test: Escrow Creation After Escrow Exists Prevention
  /// Verifies that escrows cannot be created with an intent ID that already has an escrow.
  /// Why: Prevents duplicate escrows and ensures each intent ID maps to a single escrow state.
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

  /// 3. Test: Multiple Escrows with Different Intent IDs
  /// Verifies that multiple escrows can be created for different intent IDs.
  /// Why: System must support concurrent escrows.
  it("Should support multiple escrows with different intent IDs", async function () {
    const intentId1 = intentId;
    const intentId2 = "0xbb000000000000000000000000000000000000000000000000000000000000cc";
    const amount1 = DEFAULT_AMOUNT;
    const amount2 = DEFAULT_AMOUNT * 2n;

    const tokenAddr32 = addressToBytes32(token.target);
    const requesterAddr32 = addressToBytes32(requester.address);
    const solverAddr32 = addressToBytes32(solver.address);
    const expiry = await getExpiryTimestamp();

    // Deliver requirements for both intents
    await deliverRequirements(
      gmpEndpoint,
      intentId1,
      requesterAddr32,
      amount1,
      tokenAddr32,
      solverAddr32,
      expiry,
      1
    );
    await deliverRequirements(
      gmpEndpoint,
      intentId2,
      requesterAddr32,
      amount2,
      tokenAddr32,
      solverAddr32,
      expiry,
      2
    );

    // Create first escrow
    await escrow.connect(requester).createEscrowWithValidation(
      intentId1,
      token.target,
      amount1
    );

    // Create second escrow
    await escrow.connect(requester).createEscrowWithValidation(
      intentId2,
      token.target,
      amount2
    );

    // Verify both escrows exist with correct amounts
    const escrow1 = await escrow.getEscrow(intentId1);
    const escrow2 = await escrow.getEscrow(intentId2);

    expect(escrow1.amount).to.equal(amount1);
    expect(escrow2.amount).to.equal(amount2);
    expect(await token.balanceOf(escrow.target)).to.equal(amount1 + amount2);
  });

  /// 4. Test: Escrow Expiry From Requirements
  /// Verifies that escrow uses expiry from hub requirements.
  /// Why: Expiry is determined by the hub, not locally. The connected chain must honor hub's expiry.
  it("Should use expiry from requirements", async function () {
    const tokenAddr32 = addressToBytes32(token.target);
    const requesterAddr32 = addressToBytes32(requester.address);
    const solverAddr32 = addressToBytes32(solver.address);
    const expiry = await getExpiryTimestamp();

    // Deliver requirements with specific expiry
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
    await escrow.connect(requester).createEscrowWithValidation(
      intentId,
      token.target,
      DEFAULT_AMOUNT
    );

    // Verify expiry is stored in requirements (escrow uses requirements.expiry)
    const requirements = await escrow.getRequirements(intentId);
    expect(requirements.expiry).to.equal(expiry);
  });
});
