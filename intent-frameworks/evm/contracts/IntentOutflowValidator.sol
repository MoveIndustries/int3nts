// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./gmp-common/Messages.sol";
import "./IntentGmp.sol";

/// @title IntentOutflowValidator
/// @notice Validates and executes outflow intent fulfillments on EVM connected chain
/// @dev Outflow: tokens flow OUT of hub (Movement) TO connected chain (EVM)
contract IntentOutflowValidator is IMessageHandler, Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ============================================================================
    // ERRORS
    // ============================================================================

    /// @notice Caller is not the GMP endpoint
    error E_UNAUTHORIZED_ENDPOINT();
    /// @notice Invalid source chain
    error E_INVALID_SOURCE_CHAIN();
    /// @notice Invalid source address
    error E_INVALID_SOURCE_ADDRESS();
    /// @notice Requirements not found for intent
    error E_REQUIREMENTS_NOT_FOUND();
    /// @notice Intent already fulfilled
    error E_ALREADY_FULFILLED();
    /// @notice Intent has expired
    error E_INTENT_EXPIRED();
    /// @notice Solver is not authorized for this intent
    error E_UNAUTHORIZED_SOLVER();
    /// @notice Token does not match requirements
    error E_TOKEN_MISMATCH();
    /// @notice Invalid address
    error E_INVALID_ADDRESS();
    /// @notice Amount is zero
    error E_ZERO_AMOUNT();

    // ============================================================================
    // EVENTS
    // ============================================================================

    /// @notice Emitted when IntentRequirements is received from hub
    event IntentRequirementsReceived(
        bytes32 indexed intentId,
        uint32 srcChainId,
        bytes32 requesterAddr,
        uint64 amountRequired,
        bytes32 tokenAddr,
        bytes32 solverAddr,
        uint64 expiry
    );

    /// @notice Emitted when duplicate requirements received (idempotent)
    event IntentRequirementsDuplicate(bytes32 indexed intentId);

    /// @notice Emitted when solver successfully fulfills intent
    event FulfillmentSucceeded(
        bytes32 indexed intentId,
        address indexed solver,
        address indexed recipient,
        uint64 amount,
        address token
    );

    /// @notice Emitted when FulfillmentProof is sent to hub
    event FulfillmentProofSent(
        bytes32 indexed intentId,
        bytes32 solverAddr,
        uint64 amountFulfilled,
        uint64 timestamp,
        uint32 dstChainId
    );

    // ============================================================================
    // STRUCTS
    // ============================================================================

    /// @notice Stored requirements from hub
    struct StoredRequirements {
        bytes32 requesterAddr;
        uint64 amountRequired;
        bytes32 tokenAddr;
        bytes32 solverAddr;
        uint64 expiry;
        bool fulfilled;
    }

    // ============================================================================
    // STATE
    // ============================================================================

    /// @notice GMP endpoint address
    address public gmpEndpoint;

    /// @notice Hub chain ID
    uint32 public hubChainId;

    /// @notice Trusted hub address (32 bytes)
    bytes32 public trustedHubAddr;

    /// @notice Stored requirements (intentId => requirements)
    mapping(bytes32 => StoredRequirements) public requirements;

    /// @notice Whether requirements exist for an intent
    mapping(bytes32 => bool) public hasRequirements;

    // ============================================================================
    // CONSTRUCTOR
    // ============================================================================

    /// @notice Initialize the outflow validator
    /// @param admin Admin/owner address
    /// @param _gmpEndpoint GMP endpoint address
    /// @param _hubChainId Hub chain endpoint ID
    /// @param _trustedHubAddr Trusted hub address (32 bytes)
    constructor(
        address admin,
        address _gmpEndpoint,
        uint32 _hubChainId,
        bytes32 _trustedHubAddr
    ) Ownable(admin) {
        if (_gmpEndpoint == address(0)) revert E_INVALID_ADDRESS();
        gmpEndpoint = _gmpEndpoint;
        hubChainId = _hubChainId;
        trustedHubAddr = _trustedHubAddr;
    }

    // ============================================================================
    // MODIFIERS
    // ============================================================================

    /// @notice Only the GMP endpoint can call
    modifier onlyGmpEndpoint() {
        if (msg.sender != gmpEndpoint) revert E_UNAUTHORIZED_ENDPOINT();
        _;
    }

    // ============================================================================
    // ADMIN FUNCTIONS
    // ============================================================================

    /// @notice Update hub configuration
    /// @param _hubChainId New hub chain ID
    /// @param _trustedHubAddr New trusted hub address
    function updateHubConfig(
        uint32 _hubChainId,
        bytes32 _trustedHubAddr
    ) external onlyOwner {
        hubChainId = _hubChainId;
        trustedHubAddr = _trustedHubAddr;
    }

    /// @notice Update GMP endpoint
    /// @param _gmpEndpoint New GMP endpoint address
    function setGmpEndpoint(address _gmpEndpoint) external onlyOwner {
        if (_gmpEndpoint == address(0)) revert E_INVALID_ADDRESS();
        gmpEndpoint = _gmpEndpoint;
    }

    // ============================================================================
    // INBOUND: Hub -> Connected Chain (IntentRequirements)
    // ============================================================================

    /// @notice Receive IntentRequirements from hub
    /// @dev Called by GMP endpoint when message is delivered
    /// @param srcChainId Source chain endpoint ID
    /// @param srcAddr Source address (32 bytes)
    /// @param payload Encoded IntentRequirements
    function receiveIntentRequirements(
        uint32 srcChainId,
        bytes32 srcAddr,
        bytes calldata payload
    ) external override onlyGmpEndpoint {
        // Verify source
        if (srcChainId != hubChainId) revert E_INVALID_SOURCE_CHAIN();
        if (srcAddr != trustedHubAddr) revert E_INVALID_SOURCE_ADDRESS();

        // Decode message
        Messages.IntentRequirements memory msg_ = Messages.decodeIntentRequirements(payload);

        // Idempotency check
        if (hasRequirements[msg_.intentId]) {
            emit IntentRequirementsDuplicate(msg_.intentId);
            return;
        }

        // Store requirements
        requirements[msg_.intentId] = StoredRequirements({
            requesterAddr: msg_.requesterAddr,
            amountRequired: msg_.amountRequired,
            tokenAddr: msg_.tokenAddr,
            solverAddr: msg_.solverAddr,
            expiry: msg_.expiry,
            fulfilled: false
        });
        hasRequirements[msg_.intentId] = true;

        emit IntentRequirementsReceived(
            msg_.intentId,
            srcChainId,
            msg_.requesterAddr,
            msg_.amountRequired,
            msg_.tokenAddr,
            msg_.solverAddr,
            msg_.expiry
        );
    }

    /// @notice Stub for IMessageHandler - outflow validator doesn't receive fulfillment proofs
    function receiveFulfillmentProof(
        uint32,
        bytes32,
        bytes calldata
    ) external pure override {
        revert("Not supported");
    }

    // ============================================================================
    // FULFILLMENT
    // ============================================================================

    /// @notice Fulfill intent by transferring tokens from solver to recipient
    /// @dev Solver must be authorized and provide exact amount
    /// @param intentId 32-byte intent identifier
    /// @param token Token address to transfer
    function fulfillIntent(
        bytes32 intentId,
        address token
    ) external nonReentrant {
        // Verify requirements exist
        if (!hasRequirements[intentId]) revert E_REQUIREMENTS_NOT_FOUND();

        StoredRequirements storage req = requirements[intentId];

        // Verify not already fulfilled
        if (req.fulfilled) revert E_ALREADY_FULFILLED();

        // Verify not expired
        if (block.timestamp > req.expiry) revert E_INTENT_EXPIRED();

        // Verify solver is authorized (zero address = any solver allowed)
        bytes32 solverAddr32 = Messages.addressToBytes32(msg.sender);
        bytes32 zeroAddr32 = bytes32(0);
        if (req.solverAddr != zeroAddr32 && solverAddr32 != req.solverAddr) {
            revert E_UNAUTHORIZED_SOLVER();
        }

        // Verify token matches
        bytes32 tokenAddr32 = Messages.addressToBytes32(token);
        if (tokenAddr32 != req.tokenAddr) revert E_TOKEN_MISMATCH();

        // Get recipient from requester address
        address recipient = Messages.bytes32ToAddress(req.requesterAddr);
        uint64 amount = req.amountRequired;

        if (amount == 0) revert E_ZERO_AMOUNT();

        // Mark as fulfilled before external call
        req.fulfilled = true;

        // Transfer tokens from solver to recipient
        IERC20(token).safeTransferFrom(msg.sender, recipient, amount);

        emit FulfillmentSucceeded(intentId, msg.sender, recipient, amount, token);

        // Send FulfillmentProof to hub
        _sendFulfillmentProof(intentId, solverAddr32, amount);
    }

    /// @notice Send FulfillmentProof to hub via GMP
    function _sendFulfillmentProof(
        bytes32 intentId,
        bytes32 solverAddr,
        uint64 amount
    ) internal {
        uint64 timestamp = uint64(block.timestamp);

        Messages.FulfillmentProof memory proof = Messages.FulfillmentProof({
            intentId: intentId,
            solverAddr: solverAddr,
            amountFulfilled: amount,
            timestamp: timestamp
        });

        bytes memory payload = Messages.encodeFulfillmentProof(proof);

        IntentGmp(gmpEndpoint).sendMessage(hubChainId, trustedHubAddr, payload);

        emit FulfillmentProofSent(intentId, solverAddr, amount, timestamp, hubChainId);
    }

    // ============================================================================
    // VIEW FUNCTIONS
    // ============================================================================

    /// @notice Check if an intent has been fulfilled
    /// @param intentId Intent identifier
    /// @return True if fulfilled
    function isFulfilled(bytes32 intentId) external view returns (bool) {
        if (!hasRequirements[intentId]) return false;
        return requirements[intentId].fulfilled;
    }

    /// @notice Get amount required for an intent
    /// @param intentId Intent identifier
    /// @return Amount required
    function getAmountRequired(bytes32 intentId) external view returns (uint64) {
        return requirements[intentId].amountRequired;
    }

    /// @notice Get requirements details
    /// @param intentId Intent identifier
    /// @return Requirements details
    function getRequirements(bytes32 intentId) external view returns (StoredRequirements memory) {
        return requirements[intentId];
    }
}
