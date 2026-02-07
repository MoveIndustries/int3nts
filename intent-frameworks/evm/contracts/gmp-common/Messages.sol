// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title Messages
/// @notice Fixed-width GMP message encoding library for cross-chain communication
/// @dev Message formats match MVM/SVM exactly - do not use abi.encode()
///
///      This file mirrors the structure of:
///      - SVM: gmp-common/src/messages.rs
///      - MVM: gmp_common/messages.move
library Messages {
    // ============================================================================
    // MESSAGE TYPE CONSTANTS
    // ============================================================================

    uint8 constant MESSAGE_TYPE_INTENT_REQUIREMENTS = 0x01;
    uint8 constant MESSAGE_TYPE_ESCROW_CONFIRMATION = 0x02;
    uint8 constant MESSAGE_TYPE_FULFILLMENT_PROOF = 0x03;

    // ============================================================================
    // MESSAGE SIZE CONSTANTS
    // ============================================================================

    uint256 constant INTENT_REQUIREMENTS_SIZE = 145;
    uint256 constant ESCROW_CONFIRMATION_SIZE = 137;
    uint256 constant FULFILLMENT_PROOF_SIZE = 81;

    // ============================================================================
    // STRUCTS
    // ============================================================================

    /// @notice Hub -> Connected chain. Requirements for escrow creation.
    /// Wire format (145 bytes):
    ///   type(1) + intent_id(32) + requester_addr(32) + amount(8) + token_addr(32) + solver_addr(32) + expiry(8)
    struct IntentRequirements {
        bytes32 intentId;
        bytes32 requesterAddr;
        uint64 amountRequired;
        bytes32 tokenAddr;
        bytes32 solverAddr;
        uint64 expiry;
    }

    /// @notice Connected chain -> Hub. Confirms escrow was created.
    /// Wire format (137 bytes):
    ///   type(1) + intent_id(32) + escrow_id(32) + amount(8) + token_addr(32) + creator_addr(32)
    struct EscrowConfirmation {
        bytes32 intentId;
        bytes32 escrowId;
        uint64 amountEscrowed;
        bytes32 tokenAddr;
        bytes32 creatorAddr;
    }

    /// @notice Either direction. Proves solver fulfilled intent.
    /// Wire format (81 bytes):
    ///   type(1) + intent_id(32) + solver_addr(32) + amount(8) + timestamp(8)
    struct FulfillmentProof {
        bytes32 intentId;
        bytes32 solverAddr;
        uint64 amountFulfilled;
        uint64 timestamp;
    }

    // ============================================================================
    // ERRORS
    // ============================================================================

    error E_INVALID_MESSAGE_TYPE(uint8 expected, uint8 got);
    error E_INVALID_LENGTH(uint256 expected, uint256 got);
    error E_UNKNOWN_MESSAGE_TYPE(uint8 msgType);
    error E_EMPTY_PAYLOAD();

    // ============================================================================
    // ENCODE FUNCTIONS
    // ============================================================================

    /// @notice Encode IntentRequirements to fixed-width bytes
    /// @param m The message struct to encode
    /// @return buf 145-byte encoded message
    function encodeIntentRequirements(IntentRequirements memory m) internal pure returns (bytes memory) {
        bytes memory buf = new bytes(INTENT_REQUIREMENTS_SIZE);

        // Byte 0: message type
        buf[0] = bytes1(MESSAGE_TYPE_INTENT_REQUIREMENTS);

        // Bytes 1-32: intent_id
        _writeBytes32(buf, 1, m.intentId);

        // Bytes 33-64: requester_addr
        _writeBytes32(buf, 33, m.requesterAddr);

        // Bytes 65-72: amount_required (big-endian uint64)
        _writeUint64BE(buf, 65, m.amountRequired);

        // Bytes 73-104: token_addr
        _writeBytes32(buf, 73, m.tokenAddr);

        // Bytes 105-136: solver_addr
        _writeBytes32(buf, 105, m.solverAddr);

        // Bytes 137-144: expiry (big-endian uint64)
        _writeUint64BE(buf, 137, m.expiry);

        return buf;
    }

    /// @notice Encode EscrowConfirmation to fixed-width bytes
    /// @param m The message struct to encode
    /// @return buf 137-byte encoded message
    function encodeEscrowConfirmation(EscrowConfirmation memory m) internal pure returns (bytes memory) {
        bytes memory buf = new bytes(ESCROW_CONFIRMATION_SIZE);

        // Byte 0: message type
        buf[0] = bytes1(MESSAGE_TYPE_ESCROW_CONFIRMATION);

        // Bytes 1-32: intent_id
        _writeBytes32(buf, 1, m.intentId);

        // Bytes 33-64: escrow_id
        _writeBytes32(buf, 33, m.escrowId);

        // Bytes 65-72: amount_escrowed (big-endian uint64)
        _writeUint64BE(buf, 65, m.amountEscrowed);

        // Bytes 73-104: token_addr
        _writeBytes32(buf, 73, m.tokenAddr);

        // Bytes 105-136: creator_addr
        _writeBytes32(buf, 105, m.creatorAddr);

        return buf;
    }

    /// @notice Encode FulfillmentProof to fixed-width bytes
    /// @param m The message struct to encode
    /// @return buf 81-byte encoded message
    function encodeFulfillmentProof(FulfillmentProof memory m) internal pure returns (bytes memory) {
        bytes memory buf = new bytes(FULFILLMENT_PROOF_SIZE);

        // Byte 0: message type
        buf[0] = bytes1(MESSAGE_TYPE_FULFILLMENT_PROOF);

        // Bytes 1-32: intent_id
        _writeBytes32(buf, 1, m.intentId);

        // Bytes 33-64: solver_addr
        _writeBytes32(buf, 33, m.solverAddr);

        // Bytes 65-72: amount_fulfilled (big-endian uint64)
        _writeUint64BE(buf, 65, m.amountFulfilled);

        // Bytes 73-80: timestamp (big-endian uint64)
        _writeUint64BE(buf, 73, m.timestamp);

        return buf;
    }

    // ============================================================================
    // DECODE FUNCTIONS
    // ============================================================================

    /// @notice Decode IntentRequirements from bytes
    /// @param data 145-byte encoded message
    /// @return m Decoded IntentRequirements struct
    function decodeIntentRequirements(bytes memory data) internal pure returns (IntentRequirements memory m) {
        if (data.length != INTENT_REQUIREMENTS_SIZE) {
            revert E_INVALID_LENGTH(INTENT_REQUIREMENTS_SIZE, data.length);
        }
        if (uint8(data[0]) != MESSAGE_TYPE_INTENT_REQUIREMENTS) {
            revert E_INVALID_MESSAGE_TYPE(MESSAGE_TYPE_INTENT_REQUIREMENTS, uint8(data[0]));
        }

        m.intentId = _readBytes32(data, 1);
        m.requesterAddr = _readBytes32(data, 33);
        m.amountRequired = _readUint64BE(data, 65);
        m.tokenAddr = _readBytes32(data, 73);
        m.solverAddr = _readBytes32(data, 105);
        m.expiry = _readUint64BE(data, 137);
    }

    /// @notice Decode EscrowConfirmation from bytes
    /// @param data 137-byte encoded message
    /// @return m Decoded EscrowConfirmation struct
    function decodeEscrowConfirmation(bytes memory data) internal pure returns (EscrowConfirmation memory m) {
        if (data.length != ESCROW_CONFIRMATION_SIZE) {
            revert E_INVALID_LENGTH(ESCROW_CONFIRMATION_SIZE, data.length);
        }
        if (uint8(data[0]) != MESSAGE_TYPE_ESCROW_CONFIRMATION) {
            revert E_INVALID_MESSAGE_TYPE(MESSAGE_TYPE_ESCROW_CONFIRMATION, uint8(data[0]));
        }

        m.intentId = _readBytes32(data, 1);
        m.escrowId = _readBytes32(data, 33);
        m.amountEscrowed = _readUint64BE(data, 65);
        m.tokenAddr = _readBytes32(data, 73);
        m.creatorAddr = _readBytes32(data, 105);
    }

    /// @notice Decode FulfillmentProof from bytes
    /// @param data 81-byte encoded message
    /// @return m Decoded FulfillmentProof struct
    function decodeFulfillmentProof(bytes memory data) internal pure returns (FulfillmentProof memory m) {
        if (data.length != FULFILLMENT_PROOF_SIZE) {
            revert E_INVALID_LENGTH(FULFILLMENT_PROOF_SIZE, data.length);
        }
        if (uint8(data[0]) != MESSAGE_TYPE_FULFILLMENT_PROOF) {
            revert E_INVALID_MESSAGE_TYPE(MESSAGE_TYPE_FULFILLMENT_PROOF, uint8(data[0]));
        }

        m.intentId = _readBytes32(data, 1);
        m.solverAddr = _readBytes32(data, 33);
        m.amountFulfilled = _readUint64BE(data, 65);
        m.timestamp = _readUint64BE(data, 73);
    }

    /// @notice Peek at message type without full decode
    /// @param data Encoded message (at least 1 byte)
    /// @return msgType The message type discriminator
    function peekMessageType(bytes memory data) internal pure returns (uint8 msgType) {
        if (data.length == 0) {
            revert E_EMPTY_PAYLOAD();
        }
        msgType = uint8(data[0]);
        if (
            msgType != MESSAGE_TYPE_INTENT_REQUIREMENTS && msgType != MESSAGE_TYPE_ESCROW_CONFIRMATION
                && msgType != MESSAGE_TYPE_FULFILLMENT_PROOF
        ) {
            revert E_UNKNOWN_MESSAGE_TYPE(msgType);
        }
    }

    // ============================================================================
    // ADDRESS CONVERSION HELPERS
    // ============================================================================

    /// @notice Convert 20-byte EVM address to 32-byte left-padded bytes32
    /// @dev GMP messages use 32-byte addresses; EVM addresses go in lower 20 bytes
    /// @param addr The EVM address
    /// @return b The 32-byte representation
    function addressToBytes32(address addr) internal pure returns (bytes32) {
        return bytes32(uint256(uint160(addr)));
    }

    /// @notice Convert 32-byte bytes32 to 20-byte EVM address
    /// @dev Takes lower 20 bytes (truncates upper 12 bytes)
    /// @param b The 32-byte representation
    /// @return addr The EVM address
    function bytes32ToAddress(bytes32 b) internal pure returns (address) {
        return address(uint160(uint256(b)));
    }

    // ============================================================================
    // INTERNAL HELPERS
    // ============================================================================

    /// @dev Write a bytes32 to buffer at offset
    function _writeBytes32(bytes memory buf, uint256 offset, bytes32 value) private pure {
        assembly {
            mstore(add(add(buf, 32), offset), value)
        }
    }

    /// @dev Read a bytes32 from buffer at offset
    function _readBytes32(bytes memory data, uint256 offset) private pure returns (bytes32 result) {
        assembly {
            result := mload(add(add(data, 32), offset))
        }
    }

    /// @dev Write uint64 in big-endian format
    function _writeUint64BE(bytes memory buf, uint256 offset, uint64 value) private pure {
        buf[offset] = bytes1(uint8(value >> 56));
        buf[offset + 1] = bytes1(uint8(value >> 48));
        buf[offset + 2] = bytes1(uint8(value >> 40));
        buf[offset + 3] = bytes1(uint8(value >> 32));
        buf[offset + 4] = bytes1(uint8(value >> 24));
        buf[offset + 5] = bytes1(uint8(value >> 16));
        buf[offset + 6] = bytes1(uint8(value >> 8));
        buf[offset + 7] = bytes1(uint8(value));
    }

    /// @dev Read uint64 from big-endian bytes
    function _readUint64BE(bytes memory data, uint256 offset) private pure returns (uint64) {
        return uint64(uint8(data[offset])) << 56 | uint64(uint8(data[offset + 1])) << 48
            | uint64(uint8(data[offset + 2])) << 40 | uint64(uint8(data[offset + 3])) << 32
            | uint64(uint8(data[offset + 4])) << 24 | uint64(uint8(data[offset + 5])) << 16
            | uint64(uint8(data[offset + 6])) << 8 | uint64(uint8(data[offset + 7]));
    }
}
