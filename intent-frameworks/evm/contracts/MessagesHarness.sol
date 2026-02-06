// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./gmp-common/Messages.sol";

/// @title MessagesHarness
/// @notice Test harness to expose Messages library functions for testing
/// @dev Only used for testing - not deployed to production
contract MessagesHarness {
    // ============================================================================
    // ENCODE FUNCTIONS
    // ============================================================================

    function encodeIntentRequirements(
        bytes32 intentId,
        bytes32 requesterAddr,
        uint64 amountRequired,
        bytes32 tokenAddr,
        bytes32 solverAddr,
        uint64 expiry
    ) external pure returns (bytes memory) {
        Messages.IntentRequirements memory m = Messages.IntentRequirements({
            intentId: intentId,
            requesterAddr: requesterAddr,
            amountRequired: amountRequired,
            tokenAddr: tokenAddr,
            solverAddr: solverAddr,
            expiry: expiry
        });
        return Messages.encodeIntentRequirements(m);
    }

    function encodeEscrowConfirmation(
        bytes32 intentId,
        bytes32 escrowId,
        uint64 amountEscrowed,
        bytes32 tokenAddr,
        bytes32 creatorAddr
    ) external pure returns (bytes memory) {
        Messages.EscrowConfirmation memory m = Messages.EscrowConfirmation({
            intentId: intentId,
            escrowId: escrowId,
            amountEscrowed: amountEscrowed,
            tokenAddr: tokenAddr,
            creatorAddr: creatorAddr
        });
        return Messages.encodeEscrowConfirmation(m);
    }

    function encodeFulfillmentProof(
        bytes32 intentId,
        bytes32 solverAddr,
        uint64 amountFulfilled,
        uint64 timestamp
    ) external pure returns (bytes memory) {
        Messages.FulfillmentProof memory m = Messages.FulfillmentProof({
            intentId: intentId,
            solverAddr: solverAddr,
            amountFulfilled: amountFulfilled,
            timestamp: timestamp
        });
        return Messages.encodeFulfillmentProof(m);
    }

    // ============================================================================
    // DECODE FUNCTIONS
    // ============================================================================

    function decodeIntentRequirements(bytes memory data)
        external
        pure
        returns (bytes32 intentId, bytes32 requesterAddr, uint64 amountRequired, bytes32 tokenAddr, bytes32 solverAddr, uint64 expiry)
    {
        Messages.IntentRequirements memory m = Messages.decodeIntentRequirements(data);
        return (m.intentId, m.requesterAddr, m.amountRequired, m.tokenAddr, m.solverAddr, m.expiry);
    }

    function decodeEscrowConfirmation(bytes memory data)
        external
        pure
        returns (bytes32 intentId, bytes32 escrowId, uint64 amountEscrowed, bytes32 tokenAddr, bytes32 creatorAddr)
    {
        Messages.EscrowConfirmation memory m = Messages.decodeEscrowConfirmation(data);
        return (m.intentId, m.escrowId, m.amountEscrowed, m.tokenAddr, m.creatorAddr);
    }

    function decodeFulfillmentProof(bytes memory data)
        external
        pure
        returns (bytes32 intentId, bytes32 solverAddr, uint64 amountFulfilled, uint64 timestamp)
    {
        Messages.FulfillmentProof memory m = Messages.decodeFulfillmentProof(data);
        return (m.intentId, m.solverAddr, m.amountFulfilled, m.timestamp);
    }

    // ============================================================================
    // UTILITY FUNCTIONS
    // ============================================================================

    function peekMessageType(bytes memory data) external pure returns (uint8) {
        return Messages.peekMessageType(data);
    }

    function addressToBytes32(address addr) external pure returns (bytes32) {
        return Messages.addressToBytes32(addr);
    }

    function bytes32ToAddress(bytes32 b) external pure returns (address) {
        return Messages.bytes32ToAddress(b);
    }

    // ============================================================================
    // CONSTANTS (exposed for testing)
    // ============================================================================

    function MESSAGE_TYPE_INTENT_REQUIREMENTS() external pure returns (uint8) {
        return Messages.MESSAGE_TYPE_INTENT_REQUIREMENTS;
    }

    function MESSAGE_TYPE_ESCROW_CONFIRMATION() external pure returns (uint8) {
        return Messages.MESSAGE_TYPE_ESCROW_CONFIRMATION;
    }

    function MESSAGE_TYPE_FULFILLMENT_PROOF() external pure returns (uint8) {
        return Messages.MESSAGE_TYPE_FULFILLMENT_PROOF;
    }

    function INTENT_REQUIREMENTS_SIZE() external pure returns (uint256) {
        return Messages.INTENT_REQUIREMENTS_SIZE;
    }

    function ESCROW_CONFIRMATION_SIZE() external pure returns (uint256) {
        return Messages.ESCROW_CONFIRMATION_SIZE;
    }

    function FULFILLMENT_PROOF_SIZE() external pure returns (uint256) {
        return Messages.FULFILLMENT_PROOF_SIZE;
    }
}
