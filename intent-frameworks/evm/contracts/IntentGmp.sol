// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./gmp-common/Messages.sol";

/// @notice Interface for GMP message handlers
interface IMessageHandler {
    function receiveIntentRequirements(
        uint32 srcChainId,
        bytes32 srcAddr,
        bytes calldata payload
    ) external;

    function receiveFulfillmentProof(
        uint32 srcChainId,
        bytes32 srcAddr,
        bytes calldata payload
    ) external;
}

/// @title IntentGmp
/// @notice GMP endpoint for cross-chain message delivery and routing on EVM connected chains
/// @dev Handles inbound message delivery from relays and routes to escrow/outflow handlers
contract IntentGmp is Ownable, ReentrancyGuard {
    // ============================================================================
    // ERRORS
    // ============================================================================

    /// @notice Caller is not an authorized relay
    error E_UNAUTHORIZED_RELAY();
    /// @notice Message nonce already used (replay attack)
    error E_NONCE_ALREADY_USED();
    /// @notice Source address is not trusted for the given chain
    error E_UNTRUSTED_REMOTE();
    /// @notice No trusted remote configured for the source chain
    error E_NO_TRUSTED_REMOTE();
    /// @notice Unknown message type in payload
    error E_UNKNOWN_MESSAGE_TYPE();
    /// @notice Invalid address (zero address)
    error E_INVALID_ADDRESS();
    /// @notice Handler not configured
    error E_HANDLER_NOT_CONFIGURED();
    /// @notice Address already in set
    error E_ALREADY_EXISTS();
    /// @notice Address not in set
    error E_NOT_FOUND();

    // ============================================================================
    // MESSAGE TYPE CONSTANTS (from GmpTypes)
    // ============================================================================

    uint8 private constant MESSAGE_TYPE_INTENT_REQUIREMENTS = 0x01;
    uint8 private constant MESSAGE_TYPE_ESCROW_CONFIRMATION = 0x02;
    uint8 private constant MESSAGE_TYPE_FULFILLMENT_PROOF = 0x03;

    // ============================================================================
    // EVENTS
    // ============================================================================

    /// @notice Emitted when a message is delivered from another chain
    event MessageDelivered(
        uint32 indexed srcChainId,
        bytes32 srcAddr,
        bytes payload,
        uint64 nonce
    );

    /// @notice Emitted when a message is sent to another chain
    event MessageSent(
        uint32 indexed dstChainId,
        bytes32 dstAddr,
        bytes payload,
        uint64 nonce
    );

    /// @notice Emitted when a relay is added
    event RelayAdded(address indexed relay);

    /// @notice Emitted when a relay is removed
    event RelayRemoved(address indexed relay);

    /// @notice Emitted when a trusted remote is set
    event TrustedRemoteSet(uint32 indexed chainId, bytes32 trustedAddr);

    /// @notice Emitted when a trusted remote is added
    event TrustedRemoteAdded(uint32 indexed chainId, bytes32 trustedAddr);

    /// @notice Emitted when handler is updated
    event EscrowHandlerSet(address indexed handler);

    /// @notice Emitted when handler is updated
    event OutflowHandlerSet(address indexed handler);

    // ============================================================================
    // STATE
    // ============================================================================

    /// @notice Authorized relay addresses that can call deliverMessage
    mapping(address => bool) public authorizedRelays;

    /// @notice Trusted remote addresses per source chain (chainId => list of trusted 32-byte addresses)
    mapping(uint32 => bytes32[]) private trustedRemotes;

    /// @notice Inbound nonces per source chain (chainId => lastNonce)
    mapping(uint32 => uint64) public inboundNonces;

    /// @notice Next outbound nonce for sending messages
    uint64 public nextOutboundNonce;

    /// @notice Escrow handler contract (receives IntentRequirements and FulfillmentProof)
    address public escrowHandler;

    /// @notice Outflow validator contract (receives IntentRequirements)
    address public outflowHandler;

    // ============================================================================
    // CONSTRUCTOR
    // ============================================================================

    /// @notice Initialize the GMP endpoint
    /// @param admin Initial admin/owner address (also initial authorized relay)
    constructor(address admin) Ownable(admin) {
        if (admin == address(0)) revert E_INVALID_ADDRESS();
        authorizedRelays[admin] = true;
        nextOutboundNonce = 1;
        emit RelayAdded(admin);
    }

    // ============================================================================
    // INBOUND: Deliver message from another chain
    // ============================================================================

    /// @notice Deliver a cross-chain message from another chain
    /// @dev Called by authorized relays after observing MessageSent on source chain
    /// @param srcChainId Source chain endpoint ID
    /// @param srcAddr Source address (32 bytes)
    /// @param payload Message payload (encoded GMP message)
    /// @param nonce Nonce from source chain for replay protection
    function deliverMessage(
        uint32 srcChainId,
        bytes32 srcAddr,
        bytes calldata payload,
        uint64 nonce
    ) external nonReentrant {
        // Verify relay is authorized
        if (!authorizedRelays[msg.sender]) revert E_UNAUTHORIZED_RELAY();

        // Verify trusted remote
        bytes32[] storage trusted = trustedRemotes[srcChainId];
        if (trusted.length == 0) revert E_NO_TRUSTED_REMOTE();
        if (!_isTrustedAddress(trusted, srcAddr)) revert E_UNTRUSTED_REMOTE();

        // Replay protection: nonce must be greater than last processed
        if (nonce <= inboundNonces[srcChainId]) revert E_NONCE_ALREADY_USED();
        inboundNonces[srcChainId] = nonce;

        // Emit delivery event
        emit MessageDelivered(srcChainId, srcAddr, payload, nonce);

        // Route message based on type
        _routeMessage(srcChainId, srcAddr, payload);
    }

    /// @notice Route a GMP message to the appropriate handler based on payload type
    /// @dev Connected chain receives IntentRequirements (0x01) and FulfillmentProof (0x03)
    function _routeMessage(
        uint32 srcChainId,
        bytes32 srcAddr,
        bytes calldata payload
    ) internal {
        uint8 msgType = Messages.peekMessageType(payload);

        if (msgType == MESSAGE_TYPE_INTENT_REQUIREMENTS) {
            // Route to both escrow and outflow handlers
            if (escrowHandler != address(0)) {
                IMessageHandler(escrowHandler).receiveIntentRequirements(
                    srcChainId,
                    srcAddr,
                    payload
                );
            }
            if (outflowHandler != address(0)) {
                IMessageHandler(outflowHandler).receiveIntentRequirements(
                    srcChainId,
                    srcAddr,
                    payload
                );
            }
        } else if (msgType == MESSAGE_TYPE_FULFILLMENT_PROOF) {
            // Route to escrow handler only (for inflow auto-release)
            if (escrowHandler == address(0)) revert E_HANDLER_NOT_CONFIGURED();
            IMessageHandler(escrowHandler).receiveFulfillmentProof(
                srcChainId,
                srcAddr,
                payload
            );
        } else {
            // Connected chain should NOT receive EscrowConfirmation (0x02)
            revert E_UNKNOWN_MESSAGE_TYPE();
        }
    }

    // ============================================================================
    // OUTBOUND: Send message to another chain
    // ============================================================================

    /// @notice Send a message to another chain
    /// @dev Emits MessageSent event for relays to observe
    /// @param dstChainId Destination chain endpoint ID
    /// @param dstAddr Destination address (32 bytes)
    /// @param payload Message payload (encoded GMP message)
    /// @return nonce The nonce assigned to this message
    function sendMessage(
        uint32 dstChainId,
        bytes32 dstAddr,
        bytes calldata payload
    ) external returns (uint64 nonce) {
        // Only handlers can send messages
        require(
            msg.sender == escrowHandler || msg.sender == outflowHandler,
            "Only handlers can send"
        );

        nonce = nextOutboundNonce++;

        emit MessageSent(dstChainId, dstAddr, payload, nonce);
    }

    // ============================================================================
    // ADMIN FUNCTIONS
    // ============================================================================

    /// @notice Set a trusted remote address for a source chain (replaces all existing)
    /// @param srcChainId Source chain endpoint ID
    /// @param trustedAddr Trusted source address (32 bytes)
    function setTrustedRemote(
        uint32 srcChainId,
        bytes32 trustedAddr
    ) external onlyOwner {
        delete trustedRemotes[srcChainId];
        trustedRemotes[srcChainId].push(trustedAddr);
        emit TrustedRemoteSet(srcChainId, trustedAddr);
    }

    /// @notice Add a trusted remote address for a source chain
    /// @param srcChainId Source chain endpoint ID
    /// @param trustedAddr Trusted source address (32 bytes) to add
    function addTrustedRemote(
        uint32 srcChainId,
        bytes32 trustedAddr
    ) external onlyOwner {
        bytes32[] storage trusted = trustedRemotes[srcChainId];
        if (_isTrustedAddress(trusted, trustedAddr)) revert E_ALREADY_EXISTS();
        trusted.push(trustedAddr);
        emit TrustedRemoteAdded(srcChainId, trustedAddr);
    }

    /// @notice Add an authorized relay
    /// @param relay Address to authorize as relay
    function addRelay(address relay) external onlyOwner {
        if (relay == address(0)) revert E_INVALID_ADDRESS();
        if (authorizedRelays[relay]) revert E_ALREADY_EXISTS();
        authorizedRelays[relay] = true;
        emit RelayAdded(relay);
    }

    /// @notice Remove an authorized relay
    /// @param relay Address to remove from authorized relays
    function removeRelay(address relay) external onlyOwner {
        if (!authorizedRelays[relay]) revert E_NOT_FOUND();
        authorizedRelays[relay] = false;
        emit RelayRemoved(relay);
    }

    /// @notice Set the escrow handler contract
    /// @param handler Address of the escrow handler
    function setEscrowHandler(address handler) external onlyOwner {
        escrowHandler = handler;
        emit EscrowHandlerSet(handler);
    }

    /// @notice Set the outflow handler contract
    /// @param handler Address of the outflow handler
    function setOutflowHandler(address handler) external onlyOwner {
        outflowHandler = handler;
        emit OutflowHandlerSet(handler);
    }

    // ============================================================================
    // VIEW FUNCTIONS
    // ============================================================================

    /// @notice Check if an address is an authorized relay
    /// @param addr Address to check
    /// @return True if authorized
    function isRelayAuthorized(address addr) external view returns (bool) {
        return authorizedRelays[addr];
    }

    /// @notice Get the trusted remote addresses for a source chain
    /// @param srcChainId Source chain endpoint ID
    /// @return List of trusted addresses
    function getTrustedRemotes(uint32 srcChainId) external view returns (bytes32[] memory) {
        return trustedRemotes[srcChainId];
    }

    /// @notice Check if a source chain has any trusted remotes configured
    /// @param srcChainId Source chain endpoint ID
    /// @return True if at least one trusted remote is configured
    function hasTrustedRemote(uint32 srcChainId) external view returns (bool) {
        return trustedRemotes[srcChainId].length > 0;
    }

    /// @notice Get the last processed inbound nonce for a source chain
    /// @param srcChainId Source chain endpoint ID
    /// @return Last processed nonce (0 if none)
    function getInboundNonce(uint32 srcChainId) external view returns (uint64) {
        return inboundNonces[srcChainId];
    }

    // ============================================================================
    // INTERNAL HELPERS
    // ============================================================================

    /// @notice Check if an address is in the trusted addresses list
    function _isTrustedAddress(
        bytes32[] storage addrs,
        bytes32 addr
    ) internal view returns (bool) {
        uint256 len = addrs.length;
        for (uint256 i = 0; i < len; i++) {
            if (addrs[i] == addr) {
                return true;
            }
        }
        return false;
    }
}
