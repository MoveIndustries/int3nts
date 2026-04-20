#[test_only]
module mvmt_intent::utils_tests {
    use std::signer;
    use aptos_framework::primary_fungible_store;
    use mvmt_intent::utils;
    use mvmt_intent::test_utils;

    // ============================================================================
    // TEST CONSTANTS
    // ============================================================================

    /// Dummy intent ID 1 (used in single-transfer tests and as first ID in multiple-transfer test)
    const DUMMY_INTENT_ID_1: address = @0x1111111111111111111111111111111111111111111111111111111111111111;

    /// Dummy intent ID 2 (used in multiple-transfer test to verify different intent IDs work correctly)
    const DUMMY_INTENT_ID_2: address = @0x2222222222222222222222222222222222222222222222222222222222222222;

    // ============================================================================
    // TESTS
    // ============================================================================

    #[test(
        aptos_framework = @0x1,
        sender = @0xcafe,
        recipient = @0xdead
    )]
    // 1. Test: transfer_with_intent_id moves tokens from sender to recipient
    // Verifies that utils::transfer_with_intent_id debits the sender's primary_fungible_store by the transferred amount and credits the recipient's store by the same amount.
    // Why: Ensure basic transfers tagged with an intent_id work correctly.
    fun test_transfer_with_intent_id_success(
        aptos_framework: &signer,
        sender: &signer,
        recipient: &signer,
    ) {
        // Register and mint tokens for sender
        let (metadata, _) = test_utils::register_and_mint_tokens(aptos_framework, sender, 100);
        
        // Initial balances
        assert!(primary_fungible_store::balance(signer::address_of(sender), metadata) == 100, 1);
        assert!(primary_fungible_store::balance(signer::address_of(recipient), metadata) == 0, 2);
        
        // Transfer 50 tokens with intent_id
        let intent_id = DUMMY_INTENT_ID_1;
        utils::transfer_with_intent_id(
            sender,
            signer::address_of(recipient),
            metadata,
            50,
            intent_id,
        );
        
        // Verify balances after transfer
        assert!(primary_fungible_store::balance(signer::address_of(sender), metadata) == 50, 3);
        assert!(primary_fungible_store::balance(signer::address_of(recipient), metadata) == 50, 4);
    }

    #[test(
        aptos_framework = @0x1,
        sender = @0xcafe,
        recipient = @0xdead
    )]
    // 2. Test: transfer_with_intent_id with zero amount leaves balances unchanged
    // Verifies that calling utils::transfer_with_intent_id with amount 0 succeeds without aborting and leaves sender and recipient primary_fungible_store balances unchanged.
    // Why: Zero-value transfers should be safe no-ops.
    fun test_transfer_with_intent_id_zero_amount(
        aptos_framework: &signer,
        sender: &signer,
        recipient: &signer,
    ) {
        // Register and mint tokens for sender
        let (metadata, _) = test_utils::register_and_mint_tokens(aptos_framework, sender, 100);
        
        // Transfer 0 tokens
        let intent_id = DUMMY_INTENT_ID_1;
        utils::transfer_with_intent_id(
            sender,
            signer::address_of(recipient),
            metadata,
            0,
            intent_id,
        );
        
        // Verify balances unchanged
        assert!(primary_fungible_store::balance(signer::address_of(sender), metadata) == 100, 1);
        assert!(primary_fungible_store::balance(signer::address_of(recipient), metadata) == 0, 2);
    }

    #[test(
        aptos_framework = @0x1,
        sender = @0xcafe,
        recipient = @0xdead
    )]
    #[expected_failure(abort_code = 65540, location = aptos_framework::fungible_asset)] // error::invalid_argument(EINSUFFICIENT_BALANCE)
    // 3. Test: transfer_with_intent_id aborts when sender balance is insufficient
    // Verifies that utils::transfer_with_intent_id aborts with error::invalid_argument(EINSUFFICIENT_BALANCE) from aptos_framework::fungible_asset when the requested amount exceeds the sender's balance.
    // Why: Prevent underfunded transfers that would overdraw the sender.
    fun test_transfer_with_intent_id_insufficient_balance(
        aptos_framework: &signer,
        sender: &signer,
        recipient: &signer,
    ) {
        // Register and mint only 50 tokens for sender
        let (metadata, _) = test_utils::register_and_mint_tokens(aptos_framework, sender, 50);
        
        // Try to transfer 100 tokens (more than available)
        let intent_id = DUMMY_INTENT_ID_1;
        utils::transfer_with_intent_id(
            sender,
            signer::address_of(recipient),
            metadata,
            100,
            intent_id,
        );
    }

    #[test(
        aptos_framework = @0x1,
        sender = @0xcafe,
        recipient = @0xdead
    )]
    // 4. Test: multiple transfers with different intent_ids are processed correctly
    // Verifies that successive utils::transfer_with_intent_id calls using distinct intent_id values each debit the sender and credit the recipient, so the final primary_fungible_store balances equal the sum of the individual transfers.
    // Why: Intent IDs should not affect normal transfer semantics across calls.
    fun test_transfer_with_intent_id_multiple_transfers(
        aptos_framework: &signer,
        sender: &signer,
        recipient: &signer,
    ) {
        // Register and mint tokens for sender
        let (metadata, _) = test_utils::register_and_mint_tokens(aptos_framework, sender, 100);
        
        // First transfer with intent_id_1
        let intent_id_1 = DUMMY_INTENT_ID_1;
        utils::transfer_with_intent_id(
            sender,
            signer::address_of(recipient),
            metadata,
            30,
            intent_id_1,
        );
        
        // Second transfer with intent_id_2
        let intent_id_2 = DUMMY_INTENT_ID_2;
        utils::transfer_with_intent_id(
            sender,
            signer::address_of(recipient),
            metadata,
            40,
            intent_id_2,
        );
        
        // Verify final balances
        assert!(primary_fungible_store::balance(signer::address_of(sender), metadata) == 30, 1);
        assert!(primary_fungible_store::balance(signer::address_of(recipient), metadata) == 70, 2);
    }
}

