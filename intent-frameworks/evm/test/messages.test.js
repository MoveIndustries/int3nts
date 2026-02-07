const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Messages", function () {
  let harness;

  before(async function () {
    const MessagesHarness = await ethers.getContractFactory("MessagesHarness");
    harness = await MessagesHarness.deploy();
    await harness.waitForDeployment();
  });

  // ============================================================================
  // IntentRequirements (0x01)
  // ============================================================================

  describe("IntentRequirements", function () {
    /// 1. Test: test_intent_requirements_encode_size: Encoded Size
    /// Verifies IntentRequirements encodes to exactly 145 bytes.
    /// Why: Fixed-width encoding is required for cross-chain compatibility with MVM/SVM.
    it("should encode to 145 bytes", async function () {
      const intentId = "0xaa000000000000000000000000000000000000000000000000000000000000bb";
      const requesterAddr = "0x1100000000000000000000000000000000000000000000000000000000002200";
      const amountRequired = BigInt(1000000);
      const tokenAddr = "0x3300000000000000000000000000000000000000000000000000000000004400";
      const solverAddr = "0x5500000000000000000000000000000000000000000000000000000000006600";
      const expiry = BigInt(1000);

      const encoded = await harness.encodeIntentRequirements(
        intentId, requesterAddr, amountRequired, tokenAddr, solverAddr, expiry
      );

      expect((encoded.length - 2) / 2).to.equal(145);
    });

    /// 2. Test: test_intent_requirements_discriminator: Discriminator Byte
    /// Verifies IntentRequirements has 0x01 as first byte.
    /// Why: Message type discriminator must be at byte 0 for routing.
    it("should have 0x01 as discriminator byte", async function () {
      const intentId = "0xaa000000000000000000000000000000000000000000000000000000000000bb";
      const requesterAddr = "0x1100000000000000000000000000000000000000000000000000000000002200";
      const amountRequired = BigInt(1000000);
      const tokenAddr = "0x3300000000000000000000000000000000000000000000000000000000004400";
      const solverAddr = "0x5500000000000000000000000000000000000000000000000000000000006600";
      const expiry = BigInt(1000);

      const encoded = await harness.encodeIntentRequirements(
        intentId, requesterAddr, amountRequired, tokenAddr, solverAddr, expiry
      );

      expect(encoded.slice(0, 4)).to.equal("0x01");
    });

    /// 3. Test: test_intent_requirements_roundtrip: Encode/Decode Roundtrip
    /// Verifies IntentRequirements can be encoded then decoded without data loss.
    /// Why: Roundtrip integrity is essential for cross-chain message handling.
    it("should roundtrip encode/decode", async function () {
      const intentId = "0xaa000000000000000000000000000000000000000000000000000000000000bb";
      const requesterAddr = "0x1100000000000000000000000000000000000000000000000000000000002200";
      const amountRequired = BigInt(1000000);
      const tokenAddr = "0x3300000000000000000000000000000000000000000000000000000000004400";
      const solverAddr = "0x5500000000000000000000000000000000000000000000000000000000006600";
      const expiry = BigInt(1000);

      const encoded = await harness.encodeIntentRequirements(
        intentId, requesterAddr, amountRequired, tokenAddr, solverAddr, expiry
      );

      const [dIntentId, dRequesterAddr, dAmountRequired, dTokenAddr, dSolverAddr, dExpiry] =
        await harness.decodeIntentRequirements(encoded);

      expect(dIntentId.toLowerCase()).to.equal(intentId.toLowerCase());
      expect(dRequesterAddr.toLowerCase()).to.equal(requesterAddr.toLowerCase());
      expect(dAmountRequired).to.equal(amountRequired);
      expect(dTokenAddr.toLowerCase()).to.equal(tokenAddr.toLowerCase());
      expect(dSolverAddr.toLowerCase()).to.equal(solverAddr.toLowerCase());
      expect(dExpiry).to.equal(expiry);
    });

    /// 4. Test: test_intent_requirements_big_endian_amount: Big-Endian Amount
    /// Verifies amount_required is encoded as big-endian uint64.
    /// Why: Cross-chain encoding must match MVM/SVM byte ordering.
    it("should encode amount as big-endian uint64", async function () {
      const intentId = "0x0000000000000000000000000000000000000000000000000000000000000001";
      const requesterAddr = "0x0000000000000000000000000000000000000000000000000000000000000000";
      const amountRequired = BigInt("0x0102030405060708");
      const tokenAddr = "0x0000000000000000000000000000000000000000000000000000000000000000";
      const solverAddr = "0x0000000000000000000000000000000000000000000000000000000000000000";
      const expiry = BigInt(0);

      const encoded = await harness.encodeIntentRequirements(
        intentId, requesterAddr, amountRequired, tokenAddr, solverAddr, expiry
      );

      // Amount starts at byte 65 (1 + 32 + 32)
      // Encoded hex: 0x... + 130 chars (65 bytes) + amount bytes
      const amountHex = encoded.slice(2 + 130, 2 + 130 + 16);
      expect(amountHex).to.equal("0102030405060708");
    });

    /// 5. Test: test_intent_requirements_big_endian_expiry: Big-Endian Expiry
    /// Verifies expiry is encoded as big-endian uint64.
    /// Why: Cross-chain encoding must match MVM/SVM byte ordering.
    it("should encode expiry as big-endian uint64", async function () {
      const intentId = "0x0000000000000000000000000000000000000000000000000000000000000001";
      const requesterAddr = "0x0000000000000000000000000000000000000000000000000000000000000000";
      const amountRequired = BigInt(0);
      const tokenAddr = "0x0000000000000000000000000000000000000000000000000000000000000000";
      const solverAddr = "0x0000000000000000000000000000000000000000000000000000000000000000";
      const expiry = BigInt("0x0a0b0c0d0e0f1011");

      const encoded = await harness.encodeIntentRequirements(
        intentId, requesterAddr, amountRequired, tokenAddr, solverAddr, expiry
      );

      // Expiry starts at byte 137 (1 + 32 + 32 + 8 + 32 + 32)
      // Encoded hex: 0x... + 274 chars (137 bytes) + expiry bytes
      const expiryHex = encoded.slice(2 + 274, 2 + 274 + 16);
      expect(expiryHex).to.equal("0a0b0c0d0e0f1011");
    });

    /// 6. Test: test_intent_requirements_field_offsets: Field Offsets
    /// Verifies all fields are at correct byte offsets.
    /// Why: Wire format must match MVM/SVM exactly for cross-chain compatibility.
    it("should have correct field offsets", async function () {
      const intentId = "0xff00000000000000000000000000000000000000000000000000000000000001";
      const requesterAddr = "0xee00000000000000000000000000000000000000000000000000000000000002";
      const amountRequired = BigInt("0x1122334455667788");
      const tokenAddr = "0xdd00000000000000000000000000000000000000000000000000000000000003";
      const solverAddr = "0xcc00000000000000000000000000000000000000000000000000000000000004";
      const expiry = BigInt("0xaabbccddeeff0011");

      const encoded = await harness.encodeIntentRequirements(
        intentId, requesterAddr, amountRequired, tokenAddr, solverAddr, expiry
      );

      const hex = encoded.slice(2); // Remove 0x prefix

      // Byte 0: message type
      expect(hex.slice(0, 2)).to.equal("01");
      // Bytes 1-32: intent_id
      expect(hex.slice(2, 66)).to.equal("ff00000000000000000000000000000000000000000000000000000000000001");
      // Bytes 33-64: requester_addr
      expect(hex.slice(66, 130)).to.equal("ee00000000000000000000000000000000000000000000000000000000000002");
      // Bytes 65-72: amount (big-endian)
      expect(hex.slice(130, 146)).to.equal("1122334455667788");
      // Bytes 73-104: token_addr
      expect(hex.slice(146, 210)).to.equal("dd00000000000000000000000000000000000000000000000000000000000003");
      // Bytes 105-136: solver_addr
      expect(hex.slice(210, 274)).to.equal("cc00000000000000000000000000000000000000000000000000000000000004");
      // Bytes 137-144: expiry (big-endian)
      expect(hex.slice(274, 290)).to.equal("aabbccddeeff0011");
    });

    /// 7. Test: test_intent_requirements_evm_address: EVM Address Encoding
    /// Verifies 20-byte EVM addresses are correctly padded to 32 bytes.
    /// Why: GMP uses 32-byte addresses; EVM addresses must be left-padded.
    it("should correctly encode EVM addresses to bytes32", async function () {
      const addr = "0x1234567890123456789012345678901234567890";
      const result = await harness.addressToBytes32(addr);
      expect(result).to.equal("0x0000000000000000000000001234567890123456789012345678901234567890");
    });
  });

  // ============================================================================
  // EscrowConfirmation (0x02)
  // ============================================================================

  describe("EscrowConfirmation", function () {
    /// 8. Test: test_escrow_confirmation_encode_size: Encoded Size
    /// Verifies EscrowConfirmation encodes to exactly 137 bytes.
    /// Why: Fixed-width encoding is required for cross-chain compatibility.
    it("should encode to 137 bytes", async function () {
      const intentId = "0xaa000000000000000000000000000000000000000000000000000000000000bb";
      const escrowId = "0x1100000000000000000000000000000000000000000000000000000000002200";
      const amountEscrowed = BigInt(1000000);
      const tokenAddr = "0x3300000000000000000000000000000000000000000000000000000000004400";
      const creatorAddr = "0x5500000000000000000000000000000000000000000000000000000000006600";

      const encoded = await harness.encodeEscrowConfirmation(
        intentId, escrowId, amountEscrowed, tokenAddr, creatorAddr
      );

      expect((encoded.length - 2) / 2).to.equal(137);
    });

    /// 9. Test: test_escrow_confirmation_discriminator: Discriminator Byte
    /// Verifies EscrowConfirmation has 0x02 as first byte.
    /// Why: Message type discriminator must be at byte 0 for routing.
    it("should have 0x02 as discriminator byte", async function () {
      const intentId = "0xaa000000000000000000000000000000000000000000000000000000000000bb";
      const escrowId = "0x1100000000000000000000000000000000000000000000000000000000002200";
      const amountEscrowed = BigInt(1000000);
      const tokenAddr = "0x3300000000000000000000000000000000000000000000000000000000004400";
      const creatorAddr = "0x5500000000000000000000000000000000000000000000000000000000006600";

      const encoded = await harness.encodeEscrowConfirmation(
        intentId, escrowId, amountEscrowed, tokenAddr, creatorAddr
      );

      expect(encoded.slice(0, 4)).to.equal("0x02");
    });

    /// 10. Test: test_escrow_confirmation_roundtrip: Encode/Decode Roundtrip
    /// Verifies EscrowConfirmation can be encoded then decoded without data loss.
    /// Why: Roundtrip integrity is essential for cross-chain message handling.
    it("should roundtrip encode/decode", async function () {
      const intentId = "0xaa000000000000000000000000000000000000000000000000000000000000bb";
      const escrowId = "0x1100000000000000000000000000000000000000000000000000000000002200";
      const amountEscrowed = BigInt(1000000);
      const tokenAddr = "0x3300000000000000000000000000000000000000000000000000000000004400";
      const creatorAddr = "0x5500000000000000000000000000000000000000000000000000000000006600";

      const encoded = await harness.encodeEscrowConfirmation(
        intentId, escrowId, amountEscrowed, tokenAddr, creatorAddr
      );

      const [dIntentId, dEscrowId, dAmountEscrowed, dTokenAddr, dCreatorAddr] =
        await harness.decodeEscrowConfirmation(encoded);

      expect(dIntentId.toLowerCase()).to.equal(intentId.toLowerCase());
      expect(dEscrowId.toLowerCase()).to.equal(escrowId.toLowerCase());
      expect(dAmountEscrowed).to.equal(amountEscrowed);
      expect(dTokenAddr.toLowerCase()).to.equal(tokenAddr.toLowerCase());
      expect(dCreatorAddr.toLowerCase()).to.equal(creatorAddr.toLowerCase());
    });

    /// 11. Test: test_escrow_confirmation_big_endian_amount: Big-Endian Amount
    /// Verifies amount_escrowed is encoded as big-endian uint64.
    /// Why: Cross-chain encoding must match MVM/SVM byte ordering.
    it("should encode amount as big-endian uint64", async function () {
      const intentId = "0x0000000000000000000000000000000000000000000000000000000000000001";
      const escrowId = "0x0000000000000000000000000000000000000000000000000000000000000000";
      const amountEscrowed = BigInt("0x0102030405060708");
      const tokenAddr = "0x0000000000000000000000000000000000000000000000000000000000000000";
      const creatorAddr = "0x0000000000000000000000000000000000000000000000000000000000000000";

      const encoded = await harness.encodeEscrowConfirmation(
        intentId, escrowId, amountEscrowed, tokenAddr, creatorAddr
      );

      // Amount starts at byte 65 (1 + 32 + 32)
      const amountHex = encoded.slice(2 + 130, 2 + 130 + 16);
      expect(amountHex).to.equal("0102030405060708");
    });

    /// 12. Test: test_escrow_confirmation_field_offsets: Field Offsets
    /// Verifies all fields are at correct byte offsets.
    /// Why: Wire format must match MVM/SVM exactly for cross-chain compatibility.
    it("should have correct field offsets", async function () {
      const intentId = "0xff00000000000000000000000000000000000000000000000000000000000001";
      const escrowId = "0xee00000000000000000000000000000000000000000000000000000000000002";
      const amountEscrowed = BigInt("0x1122334455667788");
      const tokenAddr = "0xdd00000000000000000000000000000000000000000000000000000000000003";
      const creatorAddr = "0xcc00000000000000000000000000000000000000000000000000000000000004";

      const encoded = await harness.encodeEscrowConfirmation(
        intentId, escrowId, amountEscrowed, tokenAddr, creatorAddr
      );

      const hex = encoded.slice(2);

      // Byte 0: message type
      expect(hex.slice(0, 2)).to.equal("02");
      // Bytes 1-32: intent_id
      expect(hex.slice(2, 66)).to.equal("ff00000000000000000000000000000000000000000000000000000000000001");
      // Bytes 33-64: escrow_id
      expect(hex.slice(66, 130)).to.equal("ee00000000000000000000000000000000000000000000000000000000000002");
      // Bytes 65-72: amount (big-endian)
      expect(hex.slice(130, 146)).to.equal("1122334455667788");
      // Bytes 73-104: token_addr
      expect(hex.slice(146, 210)).to.equal("dd00000000000000000000000000000000000000000000000000000000000003");
      // Bytes 105-136: creator_addr
      expect(hex.slice(210, 274)).to.equal("cc00000000000000000000000000000000000000000000000000000000000004");
    });
  });

  // ============================================================================
  // FulfillmentProof (0x03)
  // ============================================================================

  describe("FulfillmentProof", function () {
    /// 13. Test: test_fulfillment_proof_encode_size: Encoded Size
    /// Verifies FulfillmentProof encodes to exactly 81 bytes.
    /// Why: Fixed-width encoding is required for cross-chain compatibility.
    it("should encode to 81 bytes", async function () {
      const intentId = "0xaa000000000000000000000000000000000000000000000000000000000000bb";
      const solverAddr = "0x1100000000000000000000000000000000000000000000000000000000002200";
      const amountFulfilled = BigInt(1000000);
      const timestamp = BigInt(1000);

      const encoded = await harness.encodeFulfillmentProof(
        intentId, solverAddr, amountFulfilled, timestamp
      );

      expect((encoded.length - 2) / 2).to.equal(81);
    });

    /// 14. Test: test_fulfillment_proof_discriminator: Discriminator Byte
    /// Verifies FulfillmentProof has 0x03 as first byte.
    /// Why: Message type discriminator must be at byte 0 for routing.
    it("should have 0x03 as discriminator byte", async function () {
      const intentId = "0xaa000000000000000000000000000000000000000000000000000000000000bb";
      const solverAddr = "0x1100000000000000000000000000000000000000000000000000000000002200";
      const amountFulfilled = BigInt(1000000);
      const timestamp = BigInt(1000);

      const encoded = await harness.encodeFulfillmentProof(
        intentId, solverAddr, amountFulfilled, timestamp
      );

      expect(encoded.slice(0, 4)).to.equal("0x03");
    });

    /// 15. Test: test_fulfillment_proof_roundtrip: Encode/Decode Roundtrip
    /// Verifies FulfillmentProof can be encoded then decoded without data loss.
    /// Why: Roundtrip integrity is essential for cross-chain message handling.
    it("should roundtrip encode/decode", async function () {
      const intentId = "0xaa000000000000000000000000000000000000000000000000000000000000bb";
      const solverAddr = "0x1100000000000000000000000000000000000000000000000000000000002200";
      const amountFulfilled = BigInt(1000000);
      const timestamp = BigInt(1000);

      const encoded = await harness.encodeFulfillmentProof(
        intentId, solverAddr, amountFulfilled, timestamp
      );

      const [dIntentId, dSolverAddr, dAmountFulfilled, dTimestamp] =
        await harness.decodeFulfillmentProof(encoded);

      expect(dIntentId.toLowerCase()).to.equal(intentId.toLowerCase());
      expect(dSolverAddr.toLowerCase()).to.equal(solverAddr.toLowerCase());
      expect(dAmountFulfilled).to.equal(amountFulfilled);
      expect(dTimestamp).to.equal(timestamp);
    });

    /// 16. Test: test_fulfillment_proof_big_endian_fields: Big-Endian Fields
    /// Verifies amount and timestamp are encoded as big-endian uint64.
    /// Why: Cross-chain encoding must match MVM/SVM byte ordering.
    it("should encode amount and timestamp as big-endian uint64", async function () {
      const intentId = "0x0000000000000000000000000000000000000000000000000000000000000001";
      const solverAddr = "0x0000000000000000000000000000000000000000000000000000000000000000";
      const amountFulfilled = BigInt("0x0102030405060708");
      const timestamp = BigInt("0x0a0b0c0d0e0f1011");

      const encoded = await harness.encodeFulfillmentProof(
        intentId, solverAddr, amountFulfilled, timestamp
      );

      const hex = encoded.slice(2);

      // Amount at bytes 65-72 (1 + 32 + 32)
      expect(hex.slice(130, 146)).to.equal("0102030405060708");
      // Timestamp at bytes 73-80
      expect(hex.slice(146, 162)).to.equal("0a0b0c0d0e0f1011");
    });

    /// 17. Test: test_fulfillment_proof_field_offsets: Field Offsets
    /// Verifies all fields are at correct byte offsets.
    /// Why: Wire format must match MVM/SVM exactly for cross-chain compatibility.
    it("should have correct field offsets", async function () {
      const intentId = "0xff00000000000000000000000000000000000000000000000000000000000001";
      const solverAddr = "0xee00000000000000000000000000000000000000000000000000000000000002";
      const amountFulfilled = BigInt("0x1122334455667788");
      const timestamp = BigInt("0xaabbccddeeff0011");

      const encoded = await harness.encodeFulfillmentProof(
        intentId, solverAddr, amountFulfilled, timestamp
      );

      const hex = encoded.slice(2);

      // Byte 0: message type
      expect(hex.slice(0, 2)).to.equal("03");
      // Bytes 1-32: intent_id
      expect(hex.slice(2, 66)).to.equal("ff00000000000000000000000000000000000000000000000000000000000001");
      // Bytes 33-64: solver_addr
      expect(hex.slice(66, 130)).to.equal("ee00000000000000000000000000000000000000000000000000000000000002");
      // Bytes 65-72: amount (big-endian)
      expect(hex.slice(130, 146)).to.equal("1122334455667788");
      // Bytes 73-80: timestamp (big-endian)
      expect(hex.slice(146, 162)).to.equal("aabbccddeeff0011");
    });
  });

  // ============================================================================
  // Peek Message Type
  // ============================================================================

  describe("peekMessageType", function () {
    /// 18. Test: test_peek_intent_requirements: Peek IntentRequirements
    /// Verifies peekMessageType returns 0x01 for IntentRequirements.
    /// Why: Message routing depends on correct type detection.
    it("should return 0x01 for IntentRequirements", async function () {
      const payload = "0x01" + "00".repeat(144);
      const msgType = await harness.peekMessageType(payload);
      expect(msgType).to.equal(0x01);
    });

    /// 19. Test: test_peek_escrow_confirmation: Peek EscrowConfirmation
    /// Verifies peekMessageType returns 0x02 for EscrowConfirmation.
    /// Why: Message routing depends on correct type detection.
    it("should return 0x02 for EscrowConfirmation", async function () {
      const payload = "0x02" + "00".repeat(136);
      const msgType = await harness.peekMessageType(payload);
      expect(msgType).to.equal(0x02);
    });

    /// 20. Test: test_peek_fulfillment_proof: Peek FulfillmentProof
    /// Verifies peekMessageType returns 0x03 for FulfillmentProof.
    /// Why: Message routing depends on correct type detection.
    it("should return 0x03 for FulfillmentProof", async function () {
      const payload = "0x03" + "00".repeat(80);
      const msgType = await harness.peekMessageType(payload);
      expect(msgType).to.equal(0x03);
    });
  });

  // ============================================================================
  // Error Conditions
  // ============================================================================

  describe("Error Conditions", function () {
    /// 21. Test: test_reject_wrong_discriminator: Reject Wrong Discriminator (IntentRequirements)
    /// Verifies decode rejects payload with wrong message type.
    /// Why: Type safety prevents misrouting of messages.
    it("should reject wrong discriminator for IntentRequirements", async function () {
      const wrongType = "0x02" + "00".repeat(144);
      await expect(
        harness.decodeIntentRequirements(wrongType)
      ).to.be.revertedWithCustomError(harness, "E_INVALID_MESSAGE_TYPE");
    });

    /// 22. Test: test_reject_wrong_length: Reject Wrong Length (IntentRequirements)
    /// Verifies decode rejects payload with wrong length.
    /// Why: Fixed-width encoding requires exact lengths.
    it("should reject wrong length for IntentRequirements", async function () {
      await expect(
        harness.decodeIntentRequirements("0x0102030405")
      ).to.be.revertedWithCustomError(harness, "E_INVALID_LENGTH");
    });

    /// 23. Test: test_reject_empty_buffer: Reject Empty Buffer
    /// Verifies decode rejects empty payload.
    /// Why: Empty payloads cannot be processed.
    it("should reject empty buffer for decode", async function () {
      await expect(
        harness.decodeIntentRequirements("0x")
      ).to.be.revertedWithCustomError(harness, "E_INVALID_LENGTH");
    });

    /// 24. Test: test_peek_reject_empty_buffer: Peek Reject Empty Buffer
    /// Verifies peekMessageType rejects empty payload.
    /// Why: Cannot peek message type from empty buffer.
    it("should reject empty buffer for peek", async function () {
      await expect(
        harness.peekMessageType("0x")
      ).to.be.revertedWithCustomError(harness, "E_EMPTY_PAYLOAD");
    });

    /// 25. Test: test_peek_reject_unknown_type: Peek Reject Unknown Type
    /// Verifies peekMessageType rejects unknown message type.
    /// Why: Unknown types cannot be routed.
    it("should reject unknown message type for peek", async function () {
      await expect(
        harness.peekMessageType("0xff")
      ).to.be.revertedWithCustomError(harness, "E_UNKNOWN_MESSAGE_TYPE");
    });

    /// 26. Test: test_reject_wrong_discriminator_escrow_confirmation: Reject Wrong Discriminator (EscrowConfirmation)
    /// Verifies decode rejects payload with wrong message type.
    /// Why: Type safety prevents misrouting of messages.
    it("should reject wrong discriminator for EscrowConfirmation", async function () {
      const wrongType = "0x01" + "00".repeat(136);
      await expect(
        harness.decodeEscrowConfirmation(wrongType)
      ).to.be.revertedWithCustomError(harness, "E_INVALID_MESSAGE_TYPE");
    });

    /// 27. Test: test_reject_wrong_discriminator_fulfillment_proof: Reject Wrong Discriminator (FulfillmentProof)
    /// Verifies decode rejects payload with wrong message type.
    /// Why: Type safety prevents misrouting of messages.
    it("should reject wrong discriminator for FulfillmentProof", async function () {
      const wrongType = "0x01" + "00".repeat(80);
      await expect(
        harness.decodeFulfillmentProof(wrongType)
      ).to.be.revertedWithCustomError(harness, "E_INVALID_MESSAGE_TYPE");
    });

    /// 28. Test: test_reject_wrong_length_escrow_confirmation: Reject Wrong Length (EscrowConfirmation)
    /// Verifies decode rejects payload with wrong length.
    /// Why: Fixed-width encoding requires exact lengths.
    it("should reject wrong length for EscrowConfirmation", async function () {
      await expect(
        harness.decodeEscrowConfirmation("0x0102030405")
      ).to.be.revertedWithCustomError(harness, "E_INVALID_LENGTH");
    });

    /// 29. Test: test_reject_wrong_length_fulfillment_proof: Reject Wrong Length (FulfillmentProof)
    /// Verifies decode rejects payload with wrong length.
    /// Why: Fixed-width encoding requires exact lengths.
    it("should reject wrong length for FulfillmentProof", async function () {
      await expect(
        harness.decodeFulfillmentProof("0x0102030405")
      ).to.be.revertedWithCustomError(harness, "E_INVALID_LENGTH");
    });

    /// 30. Test: test_reject_off_by_one_length: Reject Off-by-One Length
    /// Verifies decode rejects payload with off-by-one length.
    /// Why: Strict length validation prevents buffer overflows.
    it("should reject off-by-one length", async function () {
      // 144 bytes instead of 145
      const wrongLength = "0x01" + "00".repeat(143);
      await expect(
        harness.decodeIntentRequirements(wrongLength)
      ).to.be.revertedWithCustomError(harness, "E_INVALID_LENGTH");
    });
  });

  // ============================================================================
  // Boundary Conditions
  // ============================================================================

  describe("Boundary Conditions", function () {
    /// 34. Test: test_max_u64_amount_roundtrip: Max U64 Amount Roundtrip
    /// Verifies large amounts roundtrip correctly.
    /// Why: Must support full uint64 range for token amounts.
    it("should roundtrip with large amount values", async function () {
      const intentId = "0xaa000000000000000000000000000000000000000000000000000000000000bb";
      const solverAddr = "0x1100000000000000000000000000000000000000000000000000000000002200";
      // Use a large but JS-safe value
      const amountFulfilled = BigInt("9007199254740991");
      const timestamp = BigInt("9007199254740991");

      const encoded = await harness.encodeFulfillmentProof(
        intentId, solverAddr, amountFulfilled, timestamp
      );

      const [, , dAmountFulfilled, dTimestamp] =
        await harness.decodeFulfillmentProof(encoded);

      expect(dAmountFulfilled).to.equal(amountFulfilled);
      expect(dTimestamp).to.equal(timestamp);
    });

    /// 35. Test: test_zero_solver_addr_means_any: Zero Solver Address Means Any
    /// Verifies zero solver address roundtrips correctly.
    /// Why: Zero address has special meaning (any solver can fulfill).
    it("should roundtrip with zero values", async function () {
      const intentId = "0x0000000000000000000000000000000000000000000000000000000000000000";
      const requesterAddr = "0x0000000000000000000000000000000000000000000000000000000000000000";
      const amountRequired = BigInt(0);
      const tokenAddr = "0x0000000000000000000000000000000000000000000000000000000000000000";
      const solverAddr = "0x0000000000000000000000000000000000000000000000000000000000000000";
      const expiry = BigInt(0);

      const encoded = await harness.encodeIntentRequirements(
        intentId, requesterAddr, amountRequired, tokenAddr, solverAddr, expiry
      );

      const [dIntentId, dRequesterAddr, dAmountRequired, dTokenAddr, dSolverAddr, dExpiry] =
        await harness.decodeIntentRequirements(encoded);

      expect(dIntentId).to.equal(intentId);
      expect(dRequesterAddr).to.equal(requesterAddr);
      expect(dAmountRequired).to.equal(amountRequired);
      expect(dTokenAddr).to.equal(tokenAddr);
      expect(dSolverAddr).to.equal(solverAddr);
      expect(dExpiry).to.equal(expiry);
    });
  });

  // ============================================================================
  // Known Byte Sequences
  // ============================================================================

  describe("Known Byte Sequences", function () {
    /// 31. Test: test_decode_known_intent_requirements_bytes: Decode Known IntentRequirements Bytes
    /// Verifies decoding a hardcoded byte sequence produces the expected fields.
    /// Why: Catches encoding regressions across releases.
    /// TODO: Implement - requires known test vector bytes from gmp-encoding-test-vectors.json
    it("should decode known IntentRequirements bytes");

    /// 32. Test: test_decode_known_escrow_confirmation_bytes: Decode Known EscrowConfirmation Bytes
    /// Verifies decoding a hardcoded byte sequence produces the expected fields.
    /// Why: Catches encoding regressions across releases.
    /// TODO: Implement - requires known test vector bytes from gmp-encoding-test-vectors.json
    it("should decode known EscrowConfirmation bytes");

    /// 33. Test: test_decode_known_fulfillment_proof_bytes: Decode Known FulfillmentProof Bytes
    /// Verifies decoding a hardcoded byte sequence produces the expected fields.
    /// Why: Catches encoding regressions across releases.
    /// TODO: Implement - requires known test vector bytes from gmp-encoding-test-vectors.json
    it("should decode known FulfillmentProof bytes");
  });

  // ============================================================================
  // Cross-Chain Encoding Compatibility
  // ============================================================================

  describe("Cross-Chain Encoding Compatibility", function () {
    /// 36. Test: test_cross_chain_encoding_intent_requirements: Cross-Chain Encoding IntentRequirements
    /// Verifies encoding matches expected bytes from gmp-encoding-test-vectors.json.
    /// Why: All VMs must produce identical bytes for cross-chain compatibility.
    /// TODO: Implement - load test vectors from common/testing/gmp-encoding-test-vectors.json
    it("should match cross-chain encoding for IntentRequirements");

    /// 37. Test: test_cross_chain_encoding_escrow_confirmation: Cross-Chain Encoding EscrowConfirmation
    /// Verifies encoding matches expected bytes from gmp-encoding-test-vectors.json.
    /// Why: All VMs must produce identical bytes for cross-chain compatibility.
    /// TODO: Implement - load test vectors from common/testing/gmp-encoding-test-vectors.json
    it("should match cross-chain encoding for EscrowConfirmation");

    /// 38. Test: test_cross_chain_encoding_fulfillment_proof: Cross-Chain Encoding FulfillmentProof
    /// Verifies encoding matches expected bytes from gmp-encoding-test-vectors.json.
    /// Why: All VMs must produce identical bytes for cross-chain compatibility.
    /// TODO: Implement - load test vectors from common/testing/gmp-encoding-test-vectors.json
    it("should match cross-chain encoding for FulfillmentProof");

    /// 39. Test: test_cross_chain_encoding_intent_requirements_zeros: Cross-Chain Encoding IntentRequirements (Zeros)
    /// Verifies encoding with all-zero fields matches expected bytes.
    /// Why: Edge case - zero values must still produce valid fixed-width encoding.
    /// TODO: Implement - load test vectors from common/testing/gmp-encoding-test-vectors.json
    it("should match cross-chain encoding for IntentRequirements with zeros");

    /// 40. Test: test_cross_chain_encoding_intent_requirements_max: Cross-Chain Encoding IntentRequirements (Max)
    /// Verifies encoding with max values matches expected bytes.
    /// Why: Edge case - maximum values must not overflow fixed-width fields.
    /// TODO: Implement - load test vectors from common/testing/gmp-encoding-test-vectors.json
    it("should match cross-chain encoding for IntentRequirements with max values");
  });

  // ============================================================================
  // Address Conversion
  // ============================================================================

  describe("Address Conversion", function () {
    /// 41. Test: test_address_to_bytes32: addressToBytes32
    /// Verifies 20-byte EVM addresses are correctly left-padded to 32 bytes.
    it("should convert address to bytes32 correctly", async function () {
      const addr = "0x1234567890123456789012345678901234567890";
      const result = await harness.addressToBytes32(addr);
      expect(result).to.equal("0x0000000000000000000000001234567890123456789012345678901234567890");
    });

    /// 42. Test: test_bytes32_to_address: bytes32ToAddress
    /// Verifies 32-byte values are correctly truncated to 20-byte EVM addresses.
    it("should convert bytes32 to address correctly", async function () {
      const b32 = "0x0000000000000000000000001234567890123456789012345678901234567890";
      const result = await harness.bytes32ToAddress(b32);
      expect(result.toLowerCase()).to.equal("0x1234567890123456789012345678901234567890");
    });

    /// 43. Test: test_address_conversion_roundtrip: Roundtrip Address Conversion
    /// Verifies address conversion roundtrips without data loss.
    it("should roundtrip address conversion", async function () {
      const addr = "0x1234567890123456789012345678901234567890";
      const b32 = await harness.addressToBytes32(addr);
      const back = await harness.bytes32ToAddress(b32);
      expect(back.toLowerCase()).to.equal(addr.toLowerCase());
    });
  });

  // ============================================================================
  // Constants
  // ============================================================================

  describe("Constants", function () {
    /// 44. Test: test_message_type_constants: Message Type Constants
    /// Verifies message type constants match specification.
    it("should have correct message type constants", async function () {
      expect(await harness.MESSAGE_TYPE_INTENT_REQUIREMENTS()).to.equal(0x01);
      expect(await harness.MESSAGE_TYPE_ESCROW_CONFIRMATION()).to.equal(0x02);
      expect(await harness.MESSAGE_TYPE_FULFILLMENT_PROOF()).to.equal(0x03);
    });

    /// 45. Test: test_message_size_constants: Message Size Constants
    /// Verifies message size constants match specification.
    it("should have correct message size constants", async function () {
      expect(await harness.INTENT_REQUIREMENTS_SIZE()).to.equal(145);
      expect(await harness.ESCROW_CONFIRMATION_SIZE()).to.equal(137);
      expect(await harness.FULFILLMENT_PROOF_SIZE()).to.equal(81);
    });
  });
});
