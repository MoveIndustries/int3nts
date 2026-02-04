/// GMP Sender Module
///
/// Provides the `lz_send` function for sending cross-chain messages.
/// This module is intentionally kept separate from the receiver/routing
/// logic to avoid circular dependencies (following LayerZero's pattern).
///
/// ## Architecture
///
/// - gmp_sender: Send functionality only (this module)
/// - native_gmp_endpoint: Receive/routing functionality
/// - Application modules (outflow_validator, etc.): Import gmp_sender for sending
///
/// This separation allows application modules to send GMP messages without
/// creating import cycles with the receiver that routes messages to them.
module mvmt_intent::gmp_sender {
    use std::signer;
    use aptos_framework::event;

    // ============================================================================
    // EVENTS
    // ============================================================================

    #[event]
    /// Emitted when a message is sent to another chain.
    /// The GMP relay monitors these events and delivers them to the destination.
    struct MessageSent has drop, store {
        /// Destination chain endpoint ID (e.g., Solana = 30168)
        dst_chain_id: u32,
        /// Destination address (32 bytes, the receiving program)
        dst_addr: vector<u8>,
        /// Message payload (encoded GMP message)
        payload: vector<u8>,
        /// Sender address
        sender: address,
        /// Sequence number for ordering
        nonce: u64,
    }

    // ============================================================================
    // STATE
    // ============================================================================

    /// Sender configuration and nonce tracking.
    struct SenderConfig has key {
        /// Next outbound nonce
        next_nonce: u64,
        /// Admin address (can be used for future extensions)
        admin: address,
    }

    // ============================================================================
    // INITIALIZATION
    // ============================================================================

    /// Initialize the GMP sender.
    /// Called once during deployment.
    public entry fun initialize(admin: &signer) {
        let admin_addr = signer::address_of(admin);

        move_to(admin, SenderConfig {
            next_nonce: 1,
            admin: admin_addr,
        });
    }

    /// Check if the sender is initialized.
    public fun is_initialized(): bool {
        exists<SenderConfig>(@mvmt_intent)
    }

    // ============================================================================
    // SEND
    // ============================================================================

    /// Send a cross-chain message.
    ///
    /// Emits a `MessageSent` event that the GMP relay monitors.
    /// The relay picks up the event and calls `deliver_message` on the
    /// destination chain.
    ///
    /// # Arguments
    /// - `sender`: The account sending the message
    /// - `dst_chain_id`: Destination chain endpoint ID (e.g., Solana = 30168)
    /// - `dst_addr`: Destination address (32 bytes, the receiving program)
    /// - `payload`: Message payload (encoded GMP message)
    ///
    /// # Returns
    /// - Nonce assigned to this message
    public fun lz_send(
        sender: &signer,
        dst_chain_id: u32,
        dst_addr: vector<u8>,
        payload: vector<u8>,
    ): u64 acquires SenderConfig {
        let sender_addr = signer::address_of(sender);

        // Get and increment nonce
        let config = borrow_global_mut<SenderConfig>(@mvmt_intent);
        let nonce = config.next_nonce;
        config.next_nonce = nonce + 1;

        // Emit event for relay to pick up
        event::emit(MessageSent {
            dst_chain_id,
            dst_addr,
            payload,
            sender: sender_addr,
            nonce,
        });

        nonce
    }

    /// Entry function wrapper for lz_send.
    public entry fun lz_send_entry(
        sender: &signer,
        dst_chain_id: u32,
        dst_addr: vector<u8>,
        payload: vector<u8>,
    ) acquires SenderConfig {
        lz_send(sender, dst_chain_id, dst_addr, payload);
    }

    // ============================================================================
    // VIEW FUNCTIONS
    // ============================================================================

    #[view]
    /// Get the next outbound nonce.
    public fun get_next_nonce(): u64 acquires SenderConfig {
        borrow_global<SenderConfig>(@mvmt_intent).next_nonce
    }

    // ============================================================================
    // TEST HELPERS
    // ============================================================================

    #[test_only]
    /// Initialize for testing.
    public fun init_for_test(admin: &signer) {
        if (!exists<SenderConfig>(@mvmt_intent)) {
            move_to(admin, SenderConfig {
                next_nonce: 1,
                admin: signer::address_of(admin),
            });
        };
    }
}
