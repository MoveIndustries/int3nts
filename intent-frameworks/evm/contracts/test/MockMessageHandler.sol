// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../IntentGmp.sol";

/// @title MockMessageHandler
/// @notice Mock handler for testing IntentGmp message routing
/// @dev Only used for testing - not deployed to production
contract MockMessageHandler is IMessageHandler {
    uint32 public lastReceivedChainId;
    bytes32 public lastReceivedSrcAddr;
    bytes public lastReceivedPayload;
    bool public requirementsReceived;
    bool public fulfillmentReceived;

    function receiveIntentRequirements(
        uint32 srcChainId,
        bytes32 srcAddr,
        bytes calldata payload
    ) external override {
        lastReceivedChainId = srcChainId;
        lastReceivedSrcAddr = srcAddr;
        lastReceivedPayload = payload;
        requirementsReceived = true;
    }

    function receiveFulfillmentProof(
        uint32 srcChainId,
        bytes32 srcAddr,
        bytes calldata payload
    ) external override {
        lastReceivedChainId = srcChainId;
        lastReceivedSrcAddr = srcAddr;
        lastReceivedPayload = payload;
        fulfillmentReceived = true;
    }

    /// @notice Helper to call sendMessage on IntentGmp (for testing)
    function callSendMessage(
        address gmpEndpoint,
        uint32 dstChainId,
        bytes32 dstAddr,
        bytes calldata payload
    ) external returns (uint64) {
        return IntentGmp(gmpEndpoint).sendMessage(dstChainId, dstAddr, payload);
    }

    /// @notice Reset state for clean tests
    function reset() external {
        lastReceivedChainId = 0;
        lastReceivedSrcAddr = bytes32(0);
        lastReceivedPayload = "";
        requirementsReceived = false;
        fulfillmentReceived = false;
    }
}
