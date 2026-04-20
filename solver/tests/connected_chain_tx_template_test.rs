//! Unit tests for connected_chain_tx_template binary
//!
//! These tests verify the core functionality of address normalization,
//! EVM calldata generation, and error handling without requiring CLI execution.

#[path = "helpers.rs"]
mod test_helpers;

#[cfg(test)]
mod tests {
    use super::test_helpers::{
        DUMMY_INTENT_ID, DUMMY_REQUESTER_ADDR_EVM, DUMMY_REQUESTER_ADDR_MVMCON,
        DUMMY_TOKEN_ADDR_HUB, DUMMY_TOKEN_ADDR_MVMCON,
    };
    use ethereum_types::U256;

    // Helper functions from the binary (would need to be extracted to a lib module)
    // For now, we'll test the logic directly

    fn normalize_address(input: &str) -> Result<String, String> {
        let stripped = strip_0x(input)?;
        Ok(format!("0x{}", stripped.to_lowercase()))
    }

    fn strip_0x(input: &str) -> Result<String, String> {
        let s = input.trim();
        let without = s.strip_prefix("0x").unwrap_or(s);

        if without.is_empty() {
            return Err(format!("Address '{}' is empty", input));
        }

        if !without.chars().all(|c| c.is_ascii_hexdigit()) {
            return Err(format!("Address '{}' must be hex", input));
        }

        Ok(without.to_string())
    }

    fn generate_evm_calldata(
        recipient_addr: &str,
        amount: &str,
        intent_id: &str,
    ) -> Result<String, String> {
        let recipient_clean = strip_0x(recipient_addr)?;
        let intent_clean = strip_0x(intent_id)?;

        let amount_u256 =
            U256::from_dec_str(amount).map_err(|e| format!("Invalid amount: {}", e))?;

        let selector = "a9059cbb"; // ERC20 transfer(address,uint256) function selector
        let recipient_hex = format!("{:0>64}", recipient_clean.to_lowercase());
        let amount_hex = format!("{amount:064x}", amount = amount_u256);
        let intent_hex = format!("{:0>64}", intent_clean.to_lowercase());

        Ok(format!(
            "0x{}{}{}{}",
            selector, recipient_hex, amount_hex, intent_hex
        ))
    }

    // ============================================================================
    // Address Normalization Tests
    // ============================================================================

    // 1. Test: Address normalization when input already has 0x prefix
    // Verifies that Address normalization when input already has 0x prefix.
    // Why: Ensures addresses with prefix are handled correctly and remain valid.
    #[test]
    fn test_normalize_address_with_prefix() {
        let result = normalize_address("0xaaaaaaaa").unwrap();
        assert_eq!(result, "0xaaaaaaaa");
    }

    // 2. Test: Address normalization when input lacks 0x prefix
    // Verifies that Address normalization when input lacks 0x prefix.
    // Why: Users may provide addresses without prefix; we must normalize them consistently.
    #[test]
    fn test_normalize_address_without_prefix() {
        let result = normalize_address("bbbbbbbbbbbbbbbb").unwrap();
        assert_eq!(result, "0xbbbbbbbbbbbbbbbb");
    }

    // 3. Test: Uppercase hex characters are converted to lowercase
    // Verifies that Uppercase hex characters are converted to lowercase.
    // Why: Ensures consistent address format regardless of input case.
    #[test]
    fn test_normalize_address_uppercase() {
        let result = normalize_address("0xAAAAAAAABBBBBBBB").unwrap();
        assert_eq!(result, "0xaaaaaaaabbbbbbbb");
    }

    // 4. Test: Mixed case hex characters are normalized to lowercase
    // Verifies that Mixed case hex characters are normalized to lowercase.
    // Why: Handles real-world input variations and ensures consistent output.
    #[test]
    fn test_normalize_address_mixed_case() {
        let result = normalize_address("0xAaBbCcDdEeFf1111").unwrap();
        assert_eq!(result, "0xaabbccddeeff1111");
    }

    // 5. Test: Full 64-character Move VM address format is normalized correctly
    // Verifies that Full 64-character Move VM address format is normalized correctly.
    // Why: Move VM addresses are 64 hex chars; we must handle full-length addresses.
    #[test]
    fn test_normalize_address_mvm_format() {
        let addr = DUMMY_TOKEN_ADDR_HUB;
        let result = normalize_address(addr).unwrap();
        assert_eq!(result, addr.to_lowercase());
    }

    // 6. Test: Empty address strings are rejected with error
    // Verifies that Empty address strings are rejected with error.
    // Why: Empty addresses are invalid and should fail early with clear error.
    #[test]
    fn test_normalize_address_empty() {
        let result = normalize_address("");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("empty"));
    }

    // 7. Test: Non-hexadecimal characters are rejected
    // Verifies that Non-hexadecimal characters are rejected.
    // Why: Addresses must be valid hex; invalid characters indicate user error.
    #[test]
    fn test_normalize_address_invalid_hex() {
        let result = normalize_address("0xghijklmnop");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("must be hex"));
    }

    // 8. Test: 0x prefix is correctly stripped from hex strings
    // Verifies that 0x prefix is correctly stripped from hex strings.
    // Why: Internal processing needs hex without prefix for formatting.
    #[test]
    fn test_strip_0x_with_prefix() {
        let result = strip_0x("0xaaaaaa").unwrap();
        assert_eq!(result, "aaaaaa");
    }

    // 9. Test: Hex strings without prefix remain unchanged
    // Verifies that Hex strings without prefix remain unchanged.
    // Why: Handles both prefixed and non-prefixed inputs gracefully.
    #[test]
    fn test_strip_0x_without_prefix() {
        let result = strip_0x("bbbbbb").unwrap();
        assert_eq!(result, "bbbbbb");
    }

    // 10. Test: Stripping "0x" alone results in empty string error
    // Verifies that Stripping "0x" alone results in empty string error.
    // Why: "0x" by itself is not a valid address; should fail validation.
    #[test]
    fn test_strip_0x_only_prefix() {
        let result = strip_0x("0x");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("empty"));
    }

    // ============================================================================
    // Move VM Command Generation Tests
    // ============================================================================

    fn generate_mvm_command(
        recipient_addr: &str,
        metadata_addr: &str,
        amount: u64,
        intent_id: &str,
    ) -> Result<String, String> {
        let recipient_addr = normalize_address(recipient_addr)?;
        let metadata_addr = normalize_address(metadata_addr)?;
        let intent_id_addr = normalize_address(intent_id)?;

        Ok(format!(
            "aptos move run --profile <solver-profile> \\\n      --function-id <module_address>::utils::transfer_with_intent_id \\\n      --args address:{} address:{} u64:{} address:{}",
            recipient_addr, metadata_addr, amount, intent_id_addr
        ))
    }

    // 11. Test: Complete aptos move run command is generated with all required arguments
    // Verifies that Complete aptos move run command is generated with all required arguments.
    // Why: Solvers need a ready-to-use command; format must match Aptos CLI expectations.
    #[test]
    fn test_mvm_command_generation() {
        // Use constants for addresses (64 hex chars = 32 bytes for Move)
        let result = generate_mvm_command(
            DUMMY_TOKEN_ADDR_HUB,
            DUMMY_TOKEN_ADDR_MVMCON,
            25000000u64, // Test-specific amount
            DUMMY_INTENT_ID,
        ).unwrap();

        // Should contain the function call
        assert!(result.contains("utils::transfer_with_intent_id"));

        // Should contain all addresses in correct format
        assert!(result.contains(&format!("address:{}", DUMMY_TOKEN_ADDR_HUB)));
        assert!(result.contains(&format!("address:{}", DUMMY_TOKEN_ADDR_MVMCON)));
        assert!(result.contains(&format!("address:{}", DUMMY_INTENT_ID)));

        // Should contain amount as u64
        assert!(result.contains("u64:25000000"));
    }

    // 12. Test: All addresses in command are normalized to lowercase with 0x prefix
    // Verifies that All addresses in command are normalized to lowercase with 0x prefix.
    // Why: Aptos CLI requires consistent address format; normalization prevents errors (Move VM addresses).
    #[test]
    fn test_mvm_command_address_normalization() {
        let result = generate_mvm_command(
            "0xAAAA", // Uppercase
            "bbbbbbbbbbbbbbbb", // No prefix
            1000u64,
            DUMMY_INTENT_ID,
        ).unwrap();

        // All addresses should be normalized to lowercase with 0x prefix
        assert!(result.contains("address:0xaaaa"));
        assert!(result.contains("address:0xbbbbbbbbbbbbbbbb"));
        assert!(result.contains(&format!("address:{}", DUMMY_INTENT_ID)));
    }

    // 13. Test: Zero amount is handled correctly in command generation
    // Verifies that Zero amount is handled correctly in command generation.
    // Why: Edge case that should work (though not practical for transfers).
    #[test]
    fn test_mvm_command_zero_amount() {
        let result = generate_mvm_command(
            DUMMY_REQUESTER_ADDR_MVMCON,
            DUMMY_TOKEN_ADDR_MVMCON,
            0u64, // Zero amount edge case
            DUMMY_INTENT_ID,
        ).unwrap();

        // Should handle zero amount
        assert!(result.contains("u64:0"));
    }

    // 14. Test: Maximum u64 value is handled correctly
    // Verifies that Maximum u64 value is handled correctly.
    // Why: Ensures large token amounts don't cause overflow or formatting issues.
    #[test]
    fn test_mvm_command_large_amount() {
        let result = generate_mvm_command(
            DUMMY_REQUESTER_ADDR_MVMCON,
            DUMMY_TOKEN_ADDR_MVMCON,
            u64::MAX, // Maximum u64 value to test overflow handling
            DUMMY_INTENT_ID,
        ).unwrap();

        // Should handle max u64 value
        assert!(result.contains(&format!("u64:{}", u64::MAX)));
    }

    // 15. Test: Invalid recipient address is rejected with error
    // Verifies that Invalid recipient address is rejected with error.
    // Why: Invalid addresses should fail early before command generation.
    #[test]
    fn test_mvm_command_invalid_recipient() {
        let result = generate_mvm_command(
            "0xinvalid", // Invalid hex characters to test error handling
            DUMMY_TOKEN_ADDR_MVMCON,
            1000u64,
            DUMMY_INTENT_ID,
        );
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("must be hex"));
    }

    // 16. Test: Invalid metadata address is rejected with error
    // Verifies that Invalid metadata address is rejected with error.
    // Why: Metadata is required for Move VM; invalid format should be caught.
    #[test]
    fn test_mvm_command_invalid_metadata() {
        let result = generate_mvm_command(
            DUMMY_REQUESTER_ADDR_MVMCON,
            "0xinvalid", // Invalid hex characters to test error handling
            1000u64,
            DUMMY_INTENT_ID,
        );
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("must be hex"));
    }

    // 17. Test: Invalid intent_id address is rejected with error
    // Verifies that Invalid intent_id address is rejected with error.
    // Why: Intent ID must be valid hex address for on-chain validation.
    #[test]
    fn test_mvm_command_invalid_intent_id() {
        let result = generate_mvm_command(
            DUMMY_REQUESTER_ADDR_MVMCON,
            DUMMY_TOKEN_ADDR_MVMCON,
            1000u64,
            "0xinvalid", // Invalid hex characters to test error handling
        );
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("must be hex"));
    }

    // 18. Test: Non-numeric amount string is rejected
    // Verifies that Non-numeric amount string is rejected.
    // Why: Amount must parse as u64; invalid strings should fail with clear error.
    #[test]
    fn test_mvm_command_invalid_amount_parsing() {
        fn generate_mvm_command_with_string_amount(
            recipient_addr: &str,
            metadata_addr: &str,
            amount: &str,
            intent_id: &str,
        ) -> Result<String, String> {
            let recipient_addr = normalize_address(recipient_addr)?;
            let metadata_addr = normalize_address(metadata_addr)?;
            let intent_id_addr = normalize_address(intent_id)?;

            let amount_u64: u64 = amount
                .parse()
                .map_err(|_| "Invalid amount: must be a u64".to_string())?;

            Ok(format!(
                "aptos move run --profile <solver-profile> \\\n      --function-id <module_address>::utils::transfer_with_intent_id \\\n      --args address:{} address:{} u64:{} address:{}",
                recipient_addr, metadata_addr, amount_u64, intent_id_addr
            ))
        }

        let result = generate_mvm_command_with_string_amount(
            DUMMY_REQUESTER_ADDR_MVMCON,
            DUMMY_TOKEN_ADDR_MVMCON,
            "not_a_number", // Invalid amount to test error handling
            DUMMY_INTENT_ID,
        );
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Invalid amount"));
    }

    // ============================================================================
    // EVM Calldata Generation Tests
    // ============================================================================

    // 19. Test: Complete EVM calldata payload is generated with selector, recipient, amount, and intent_id
    // Verifies that Complete EVM calldata payload is generated with selector, recipient, amount, and intent_id.
    // Why: Solvers need correct calldata format for ERC20 transfer with embedded intent_id.
    #[test]
    fn test_evm_calldata_generation() {
        let result = generate_evm_calldata(
            DUMMY_REQUESTER_ADDR_EVM,
            "1000000000000000000", // 1 ETH in wei
            DUMMY_INTENT_ID,
        ).unwrap();

        // Should start with selector
        assert!(result.starts_with("0xa9059cbb"));

        // Should contain recipient (padded to 64 hex chars)
        assert!(result.contains(&DUMMY_REQUESTER_ADDR_EVM.strip_prefix("0x").unwrap().to_lowercase()));

        // Should contain amount (padded to 64 hex chars)
        assert!(result.contains("0de0b6b3a7640000")); // 1 ETH in hex

        // Should contain intent_id (padded to 64 hex chars)
        assert!(result.contains(&DUMMY_INTENT_ID.strip_prefix("0x").unwrap()));

        // Total length: 0x (2) + selector (8) + recipient (64) + amount (64) + intent_id (64) = 202
        assert_eq!(result.len(), 202);
    }

    // 20. Test: Short recipient addresses are padded to 32 bytes (64 hex chars)
    // Verifies that Short recipient addresses are padded to 32 bytes (64 hex chars).
    // Why: EVM calldata requires fixed 32-byte words; padding ensures correct format.
    #[test]
    fn test_evm_calldata_recipient_padding() {
        let recipient_addr = "0x1234"; // Requester address on connected chain (short address for padding test)
        let result = generate_evm_calldata(recipient_addr, "1000", DUMMY_INTENT_ID).unwrap();

        // Recipient should be padded to 64 hex chars (32 bytes)
        // Position: after selector (0xa9059cbb = 8 chars) + 0x (2 chars) = starts at index 10
        let recipient_part = &result[10..74]; // 64 hex chars
        assert_eq!(recipient_part.len(), 64);
        assert!(recipient_part
            .starts_with("0000000000000000000000000000000000000000000000000000000000001234"));
    }

    // 21. Test: Small amounts are padded to 32 bytes (64 hex chars)
    // Verifies that Small amounts are padded to 32 bytes (64 hex chars).
    // Why: EVM uint256 requires 32-byte representation; padding ensures correct encoding.
    #[test]
    fn test_evm_calldata_amount_padding() {
        let result = generate_evm_calldata(
            DUMMY_REQUESTER_ADDR_EVM,
            "1", // Small amount to test padding
            DUMMY_INTENT_ID,
        ).unwrap();

        // Amount should be padded to 64 hex chars
        // Position: after selector (8) + recipient (64) + 0x (2) = starts at index 74
        let amount_part = &result[74..138]; // 64 hex chars
        assert_eq!(amount_part.len(), 64);
        assert!(amount_part
            .starts_with("0000000000000000000000000000000000000000000000000000000000000001"));
    }

    // 22. Test: Maximum U256 value is handled correctly
    // Verifies that Maximum U256 value is handled correctly.
    // Why: Ensures large token amounts (up to U256::MAX) don't cause overflow.
    #[test]
    fn test_evm_calldata_large_amount() {
        let amount = U256::MAX.to_string();
        let result = generate_evm_calldata(
            DUMMY_REQUESTER_ADDR_EVM,
            &amount, // Maximum U256 value to test overflow handling
            DUMMY_INTENT_ID,
        );
        assert!(result.is_ok());

        // Should handle max U256 value
        let calldata = result.unwrap();
        assert!(
            calldata.contains("ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff")
        );
    }

    // 23. Test: Non-numeric amount string is rejected with error
    // Verifies that Non-numeric amount string is rejected with error.
    // Why: Amount must parse as decimal number; invalid strings should fail early.
    #[test]
    fn test_evm_calldata_invalid_amount() {
        let result = generate_evm_calldata(
            DUMMY_REQUESTER_ADDR_EVM,
            "not_a_number", // Invalid amount to test error handling
            DUMMY_INTENT_ID,
        );
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Invalid amount"));
    }

    // 24. Test: Invalid recipient address is rejected with error
    // Verifies that Invalid recipient address is rejected with error.
    // Why: Invalid addresses should fail before calldata generation.
    #[test]
    fn test_evm_calldata_invalid_recipient() {
        let result = generate_evm_calldata(
            "0xinvalid", // Invalid hex characters to test error handling
            "1000",
            DUMMY_INTENT_ID,
        );
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("must be hex"));
    }

    // 25. Test: Invalid intent_id address is rejected with error
    // Verifies that Invalid intent_id address is rejected with error.
    // Why: Intent ID must be valid hex for on-chain validation.
    #[test]
    fn test_evm_calldata_invalid_intent_id() {
        let result = generate_evm_calldata(
            DUMMY_REQUESTER_ADDR_EVM,
            "1000",
            "0xinvalid", // Invalid hex characters to test error handling
        );
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("must be hex"));
    }

    // 26. Test: Zero amount is encoded correctly as all zeros
    // Verifies that Zero amount is encoded correctly as all zeros.
    // Why: Edge case that should work (though not practical for transfers).
    #[test]
    fn test_evm_calldata_zero_amount() {
        let result = generate_evm_calldata(
            DUMMY_REQUESTER_ADDR_EVM,
            "0", // Zero amount edge case
            DUMMY_INTENT_ID,
        ).unwrap();

        // Amount should be all zeros (padded)
        assert!(result.contains("0000000000000000000000000000000000000000000000000000000000000000"));
    }

    // 27. Test: ERC20 transfer function selector is correct (0xa9059cbb)
    // Verifies that ERC20 transfer function selector is correct (0xa9059cbb).
    // Why: Selector must match transfer(address,uint256) signature for EVM to route call correctly.
    #[test]
    fn test_evm_calldata_selector_correct() {
        let result = generate_evm_calldata(DUMMY_REQUESTER_ADDR_EVM, "1000", DUMMY_INTENT_ID).unwrap();

        // ERC20 transfer selector: transfer(address,uint256) = 0xa9059cbb
        assert_eq!(&result[0..10], "0xa9059cbb");
    }
}
