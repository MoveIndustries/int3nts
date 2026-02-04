/// Intent GMP Hub Interface
///
/// Interface functions for hub operations: sending requirements/proofs to connected
/// chains and receiving confirmations/proofs from them.
///
/// MVM as Hub:
/// - Sends IntentRequirements to connected chains on intent creation
/// - Receives EscrowConfirmation from connected chains
/// - Sends FulfillmentProof to connected chains
/// - Receives FulfillmentProof from connected chains
///
module mvmt_intent::intent_gmp_hub {
    use std::signer;
    use std::vector;
    use std::error;
    use aptos_framework::event;
    use aptos_std::simple_map::{Self, SimpleMap};
    use mvmt_intent::gmp_common::{
        Self,
        EscrowConfirmation,
        FulfillmentProof,
    };
    use mvmt_intent::gmp_sender;
    use mvmt_intent::gmp_intent_state;

    // ============================================================================
    // ERROR CODES
    // ============================================================================

    const E_NOT_INITIALIZED: u64 = 1;
    const E_ALREADY_INITIALIZED: u64 = 2;
    const E_INVALID_SOURCE_CHAIN: u64 = 3;
    const E_INVALID_SOURCE_ADDRESS: u64 = 4;
    const E_INTENT_NOT_FOUND: u64 = 5;
    const E_ESCROW_MISMATCH: u64 = 6;
    const E_ALREADY_CONFIRMED: u64 = 7;
    const E_ALREADY_FULFILLED: u64 = 8;
    const E_TRUSTED_REMOTE_NOT_FOUND: u64 = 9;

    // ============================================================================
    // STATE
    // ============================================================================

    /// Configuration for GMP hub operations.
    /// Maps destination chain IDs to their trusted program addresses.
    struct GmpHubConfig has key {
        /// Admin address (can update trusted remotes)
        admin: address,
        /// Maps chain_id -> trusted program address (32 bytes)
        trusted_remotes: SimpleMap<u32, vector<u8>>,
    }

    // ============================================================================
    // EVENTS
    // ============================================================================

    #[event]
    /// Emitted when IntentRequirements is sent to a connected chain.
    struct IntentRequirementsSent has drop, store {
        intent_id: vector<u8>,
        dst_chain_id: u32,
        requester_addr: vector<u8>,
        amount_required: u64,
        token_addr: vector<u8>,
        solver_addr: vector<u8>,
        expiry: u64,
    }

    #[event]
    /// Emitted when EscrowConfirmation is received from a connected chain.
    struct EscrowConfirmationReceived has drop, store {
        intent_id: vector<u8>,
        src_chain_id: u32,
        escrow_id: vector<u8>,
        amount_escrowed: u64,
        token_addr: vector<u8>,
        creator_addr: vector<u8>,
    }

    #[event]
    /// Emitted when FulfillmentProof is sent to a connected chain.
    struct FulfillmentProofSent has drop, store {
        intent_id: vector<u8>,
        dst_chain_id: u32,
        solver_addr: vector<u8>,
        amount_fulfilled: u64,
        timestamp: u64,
    }

    #[event]
    /// Emitted when FulfillmentProof is received from a connected chain.
    struct FulfillmentProofReceived has drop, store {
        intent_id: vector<u8>,
        src_chain_id: u32,
        solver_addr: vector<u8>,
        amount_fulfilled: u64,
        timestamp: u64,
    }

    // ============================================================================
    // INITIALIZATION
    // ============================================================================

    /// Initialize the GMP hub configuration.
    /// Must be called once during deployment.
    public entry fun initialize(admin: &signer) {
        let admin_addr = signer::address_of(admin);

        assert!(
            admin_addr == @mvmt_intent,
            error::permission_denied(E_NOT_INITIALIZED)
        );

        assert!(
            !exists<GmpHubConfig>(@mvmt_intent),
            error::already_exists(E_ALREADY_INITIALIZED)
        );

        move_to(admin, GmpHubConfig {
            admin: admin_addr,
            trusted_remotes: simple_map::new(),
        });
    }

    /// Set a trusted remote program address for a destination chain.
    /// Only admin can call this.
    public entry fun set_trusted_remote(
        admin: &signer,
        chain_id: u32,
        remote_addr: vector<u8>,
    ) acquires GmpHubConfig {
        let admin_addr = signer::address_of(admin);
        let config = borrow_global_mut<GmpHubConfig>(@mvmt_intent);

        assert!(
            admin_addr == config.admin,
            error::permission_denied(E_NOT_INITIALIZED)
        );

        // Add or update the trusted remote
        if (simple_map::contains_key(&config.trusted_remotes, &chain_id)) {
            *simple_map::borrow_mut(&mut config.trusted_remotes, &chain_id) = remote_addr;
        } else {
            simple_map::add(&mut config.trusted_remotes, chain_id, remote_addr);
        }
    }

    /// Check if the GMP hub is initialized on this chain.
    public fun is_initialized(): bool {
        exists<GmpHubConfig>(@mvmt_intent)
    }

    /// Check if a source chain and address are trusted.
    fun is_trusted_source(src_chain_id: u32, src_address: &vector<u8>): bool acquires GmpHubConfig {
        if (!exists<GmpHubConfig>(@mvmt_intent)) {
            return false
        };

        let config = borrow_global<GmpHubConfig>(@mvmt_intent);

        if (!simple_map::contains_key(&config.trusted_remotes, &src_chain_id)) {
            return false
        };

        let trusted_addr = simple_map::borrow(&config.trusted_remotes, &src_chain_id);
        trusted_addr == src_address
    }

    /// Get the trusted remote address for a destination chain.
    /// Aborts if not found.
    fun get_trusted_remote(dst_chain_id: u32): vector<u8> acquires GmpHubConfig {
        let config = borrow_global<GmpHubConfig>(@mvmt_intent);

        assert!(
            simple_map::contains_key(&config.trusted_remotes, &dst_chain_id),
            error::not_found(E_TRUSTED_REMOTE_NOT_FOUND)
        );

        *simple_map::borrow(&config.trusted_remotes, &dst_chain_id)
    }

    // ============================================================================
    // OUTBOUND: Hub -> Connected Chain
    // ============================================================================

    /// Send IntentRequirements to a connected chain when an intent is created.
    ///
    /// Called by the hub when a new cross-chain intent is created. The connected
    /// chain uses this to validate escrow creation matches the intent.
    ///
    /// # Arguments
    /// - `sender`: Signer sending the message (typically @mvmt_intent)
    /// - `dst_chain_id`: LayerZero endpoint ID of destination chain
    /// - `intent_id`: 32-byte intent identifier
    /// - `requester_addr`: 32-byte requester address (on connected chain)
    /// - `amount_required`: Amount of tokens required in escrow
    /// - `token_addr`: 32-byte token address (on connected chain)
    /// - `solver_addr`: 32-byte solver address (on connected chain)
    /// - `expiry`: Unix timestamp when intent expires
    ///
    /// # Returns
    /// - Nonce assigned to the outbound message
    public fun send_intent_requirements(
        sender: &signer,
        dst_chain_id: u32,
        intent_id: vector<u8>,
        requester_addr: vector<u8>,
        amount_required: u64,
        token_addr: vector<u8>,
        solver_addr: vector<u8>,
        expiry: u64,
    ): u64 acquires GmpHubConfig {
        // Get the trusted remote address for this chain
        let dst_addr = get_trusted_remote(dst_chain_id);

        // Create the message
        let msg = gmp_common::new_intent_requirements(
            intent_id,
            requester_addr,
            amount_required,
            token_addr,
            solver_addr,
            expiry,
        );

        // Encode for transmission
        let payload = gmp_common::encode_intent_requirements(&msg);

        // Emit event for tracking
        event::emit(IntentRequirementsSent {
            intent_id: *gmp_common::intent_requirements_intent_id(&msg),
            dst_chain_id,
            requester_addr: *gmp_common::intent_requirements_requester_addr(&msg),
            amount_required: gmp_common::intent_requirements_amount_required(&msg),
            token_addr: *gmp_common::intent_requirements_token_addr(&msg),
            solver_addr: *gmp_common::intent_requirements_solver_addr(&msg),
            expiry: gmp_common::intent_requirements_expiry(&msg),
        });

        // Send via GMP sender (emits MessageSent event for relay)
        gmp_sender::lz_send(sender, dst_chain_id, dst_addr, payload)
    }

    /// Send FulfillmentProof to a connected chain when fulfillment is recorded.
    ///
    /// Called by the hub when a solver fulfills an intent. The connected chain
    /// uses this to release escrowed tokens to the solver.
    ///
    /// # Arguments
    /// - `sender`: Signer sending the message (typically @mvmt_intent)
    /// - `dst_chain_id`: LayerZero endpoint ID of destination chain
    /// - `intent_id`: 32-byte intent identifier
    /// - `solver_addr`: 32-byte solver address (on connected chain)
    /// - `amount_fulfilled`: Amount of tokens fulfilled
    /// - `timestamp`: Unix timestamp of fulfillment
    ///
    /// # Returns
    /// - Nonce assigned to the outbound message
    public fun send_fulfillment_proof(
        sender: &signer,
        dst_chain_id: u32,
        intent_id: vector<u8>,
        solver_addr: vector<u8>,
        amount_fulfilled: u64,
        timestamp: u64,
    ): u64 acquires GmpHubConfig {
        // Get the trusted remote address for this chain
        let dst_addr = get_trusted_remote(dst_chain_id);

        // Create the message
        let msg = gmp_common::new_fulfillment_proof(
            intent_id,
            solver_addr,
            amount_fulfilled,
            timestamp,
        );

        // Encode for transmission
        let payload = gmp_common::encode_fulfillment_proof(&msg);

        // Emit event for tracking
        event::emit(FulfillmentProofSent {
            intent_id: *gmp_common::fulfillment_proof_intent_id(&msg),
            dst_chain_id,
            solver_addr: *gmp_common::fulfillment_proof_solver_addr(&msg),
            amount_fulfilled: gmp_common::fulfillment_proof_amount_fulfilled(&msg),
            timestamp: gmp_common::fulfillment_proof_timestamp(&msg),
        });

        // Send via GMP sender (emits MessageSent event for relay)
        gmp_sender::lz_send(sender, dst_chain_id, dst_addr, payload)
    }

    // ============================================================================
    // INBOUND: Connected Chain -> Hub
    // ============================================================================

    /// Receive and process EscrowConfirmation from a connected chain.
    ///
    /// Called by native_gmp_endpoint when a connected chain confirms escrow creation.
    /// The hub validates the confirmation comes from a trusted source.
    ///
    /// # Arguments
    /// - `src_chain_id`: LayerZero endpoint ID of source chain
    /// - `src_address`: 32-byte source address (connected chain's program)
    /// - `payload`: Raw GMP message payload
    ///
    /// # Returns
    /// - Decoded EscrowConfirmation struct
    ///
    /// # Aborts
    /// - E_INVALID_SOURCE_CHAIN: If source chain is not trusted
    /// - EINVALID_SOURCE_ADDRESS: If source address doesn't match trusted remote
    public fun receive_escrow_confirmation(
        src_chain_id: u32,
        src_address: vector<u8>,
        payload: vector<u8>,
    ): EscrowConfirmation acquires GmpHubConfig {
        // Validate source is trusted
        assert!(
            is_trusted_source(src_chain_id, &src_address),
            error::permission_denied(E_INVALID_SOURCE_CHAIN)
        );

        // Decode the message
        let msg = gmp_common::decode_escrow_confirmation(&payload);

        let intent_id = *gmp_common::escrow_confirmation_intent_id(&msg);

        // Emit event for tracking
        event::emit(EscrowConfirmationReceived {
            intent_id: copy intent_id,
            src_chain_id,
            escrow_id: *gmp_common::escrow_confirmation_escrow_id(&msg),
            amount_escrowed: gmp_common::escrow_confirmation_amount_escrowed(&msg),
            token_addr: *gmp_common::escrow_confirmation_token_addr(&msg),
            creator_addr: *gmp_common::escrow_confirmation_creator_addr(&msg),
        });

        // Update GMP state: mark escrow as confirmed so fulfillment can proceed
        gmp_intent_state::confirm_escrow(intent_id);

        msg
    }

    /// Receive and process FulfillmentProof from a connected chain.
    ///
    /// Called by native_gmp_endpoint when a connected chain reports fulfillment.
    /// The hub validates the proof comes from a trusted source.
    ///
    /// # Arguments
    /// - `src_chain_id`: LayerZero endpoint ID of source chain
    /// - `src_address`: 32-byte source address (connected chain's program)
    /// - `payload`: Raw GMP message payload
    ///
    /// # Returns
    /// - Decoded FulfillmentProof struct
    ///
    /// # Aborts
    /// - E_INVALID_SOURCE_CHAIN: If source chain is not trusted
    /// - EINVALID_SOURCE_ADDRESS: If source address doesn't match trusted remote
    public fun receive_fulfillment_proof(
        src_chain_id: u32,
        src_address: vector<u8>,
        payload: vector<u8>,
    ): FulfillmentProof acquires GmpHubConfig {
        // Validate source is trusted
        assert!(
            is_trusted_source(src_chain_id, &src_address),
            error::permission_denied(E_INVALID_SOURCE_CHAIN)
        );

        // Decode the message
        let msg = gmp_common::decode_fulfillment_proof(&payload);

        let intent_id = *gmp_common::fulfillment_proof_intent_id(&msg);

        // Emit event for tracking
        event::emit(FulfillmentProofReceived {
            intent_id: copy intent_id,
            src_chain_id,
            solver_addr: *gmp_common::fulfillment_proof_solver_addr(&msg),
            amount_fulfilled: gmp_common::fulfillment_proof_amount_fulfilled(&msg),
            timestamp: gmp_common::fulfillment_proof_timestamp(&msg),
        });

        // Update GMP state if the intent is tracked on this chain.
        // On the hub, outflow intents are registered and need fulfillment proof recorded.
        // On connected chains, the intent may not be registered — skip gracefully.
        if (gmp_intent_state::is_initialized() && gmp_intent_state::intent_exists(intent_id)) {
            gmp_intent_state::record_fulfillment_proof(intent_id);
        };

        msg
    }

    // ============================================================================
    // HELPER FUNCTIONS
    // ============================================================================

    /// Convert an address to a 32-byte vector for GMP message encoding.
    public fun address_to_bytes32(addr: address): vector<u8> {
        let bytes = std::bcs::to_bytes(&addr);
        // BCS encodes address as 32 bytes on Aptos/Movement
        bytes
    }

    /// Create a 32-byte zero-padded vector from a shorter byte array.
    /// Pads on the left (big-endian style).
    public fun bytes_to_bytes32(input: vector<u8>): vector<u8> {
        let len = vector::length(&input);
        if (len >= 32) {
            // If already 32+ bytes, return first 32
            let result = vector::empty<u8>();
            let i = 0;
            while (i < 32) {
                vector::push_back(&mut result, *vector::borrow(&input, i));
                i = i + 1;
            };
            result
        } else {
            // Pad with zeros on the left
            let result = vector::empty<u8>();
            let padding = 32 - len;
            let i = 0;
            while (i < padding) {
                vector::push_back(&mut result, 0);
                i = i + 1;
            };
            i = 0;
            while (i < len) {
                vector::push_back(&mut result, *vector::borrow(&input, i));
                i = i + 1;
            };
            result
        }
    }

    // ============================================================================
    // TEST HELPERS
    // ============================================================================

    #[test_only]
    /// Initialize for testing with a trusted remote for dst_chain_id.
    public fun init_for_test(admin: &signer, dst_chain_id: u32, trusted_remote: vector<u8>) acquires GmpHubConfig {
        if (!exists<GmpHubConfig>(@mvmt_intent)) {
            move_to(admin, GmpHubConfig {
                admin: signer::address_of(admin),
                trusted_remotes: simple_map::new(),
            });
        };

        // Add trusted remote
        let config = borrow_global_mut<GmpHubConfig>(@mvmt_intent);
        if (!simple_map::contains_key(&config.trusted_remotes, &dst_chain_id)) {
            simple_map::add(&mut config.trusted_remotes, dst_chain_id, trusted_remote);
        };
    }
}
