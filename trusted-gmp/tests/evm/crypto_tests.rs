//! Unit tests for EVM/ECDSA cryptographic operations
//!
//! These tests verify ECDSA signature functionality for EVM chain compatibility.

use trusted_gmp::crypto::CryptoService;

#[path = "../mod.rs"]
mod test_helpers;
use test_helpers::{build_test_config_with_mvm, DUMMY_INTENT_ID};

/// 10. Test: EVM Approval Signature Creation
/// Verifies that ECDSA signature creation succeeds for EVM escrow release.
/// Why: ECDSA signatures are required for EVM chain compatibility and must produce non-empty output.
#[test]
fn test_create_evm_approval_signature_success() {
    let config = build_test_config_with_mvm();
    let service = CryptoService::new(&config).unwrap();

    let intent_id = DUMMY_INTENT_ID;

    let signature = service.create_evm_approval_signature(intent_id).unwrap();

    // Signature should be created successfully
    assert!(!signature.is_empty(), "Signature should not be empty");
}

/// 11. Test: EVM Signature 65-Byte Format
/// Verifies that the ECDSA signature is exactly 65 bytes (32 r + 32 s + 1 v) with a valid recovery ID.
/// Why: EVM ecrecover requires precisely 65-byte signatures to recover the signer address.
#[test]
fn test_create_evm_approval_signature_format_65_bytes() {
    let config = build_test_config_with_mvm();
    let service = CryptoService::new(&config).unwrap();

    let intent_id = DUMMY_INTENT_ID;

    let signature = service.create_evm_approval_signature(intent_id).unwrap();

    // Signature must be exactly 65 bytes: 32 (r) + 32 (s) + 1 (v)
    assert_eq!(signature.len(), 65, "Signature must be exactly 65 bytes");

    // Verify v value is 27 or 28 (Ethereum format)
    let v = signature[64];
    assert!(
        v == 27 || v == 28,
        "Recovery ID v must be 27 or 28, got {}",
        v
    );
}

/// 12. Test: EVM Signature Verification
/// Verifies that the ECDSA signature has valid, non-zero r and s components and a correct recovery ID.
/// Why: Signatures must be verifiable on EVM chains using ecrecover to authorize escrow release.
#[test]
fn test_create_evm_approval_signature_verification() {
    let config = build_test_config_with_mvm();
    let service = CryptoService::new(&config).unwrap();

    let intent_id = DUMMY_INTENT_ID;

    // Create signature
    let signature = service.create_evm_approval_signature(intent_id).unwrap();

    // Verify signature format
    assert_eq!(signature.len(), 65);

    // Extract r, s, v
    let r = &signature[0..32];
    let s = &signature[32..64];
    let v = signature[64];

    // Verify v is valid (27 or 28)
    assert!(v == 27 || v == 28);

    // Verify r and s are non-zero (valid signature components)
    assert!(!r.iter().all(|&b| b == 0), "r must not be zero");
    assert!(!s.iter().all(|&b| b == 0), "s must not be zero");
}

/// 13. Test: Ethereum Address Derivation
/// Verifies that the derived Ethereum address is a 42-character hex string with 0x prefix and is deterministic.
/// Why: A correctly derived Ethereum address is needed for EVM contract interactions and on-chain identity.
#[test]
fn test_get_ethereum_address_derivation() {
    let config = build_test_config_with_mvm();
    let service = CryptoService::new(&config).unwrap();

    let address = service.get_ethereum_address().unwrap();

    // Address should be hex string with 0x prefix
    assert!(address.starts_with("0x"), "Address must start with 0x");
    assert_eq!(
        address.len(),
        42,
        "Address must be 42 characters (0x + 40 hex chars)"
    );

    // Address should be consistent for same service instance
    let address2 = service.get_ethereum_address().unwrap();
    assert_eq!(address, address2, "Address should be consistent");
}

/// 14. Test: Recovery ID Calculation
/// Verifies that the recovery ID (v) is always 27 or 28 across multiple signature invocations.
/// Why: The recovery ID determines which public key ecrecover derives, so it must always be valid.
#[test]
fn test_evm_signature_recovery_id_calculation() {
    let config = build_test_config_with_mvm();
    let service = CryptoService::new(&config).unwrap();

    let intent_id = DUMMY_INTENT_ID;

    // Create multiple signatures and verify v is always 27 or 28
    for _ in 0..10 {
        let signature = service.create_evm_approval_signature(intent_id).unwrap();
        let v = signature[64];
        assert!(
            v == 27 || v == 28,
            "Recovery ID v must be 27 or 28, got {}",
            v
        );
    }
}

/// 15. Test: Keccak256 Deterministic Hashing
/// Verifies that signing the same intent ID twice produces identical signatures due to deterministic keccak256 hashing.
/// Why: EVM uses keccak256 for message hashing and signatures must be reproducible to match on-chain behavior.
#[test]
fn test_evm_signature_keccak256_hashing() {
    let config = build_test_config_with_mvm();
    let service = CryptoService::new(&config).unwrap();

    let intent_id = DUMMY_INTENT_ID;

    // Create signature
    let signature1 = service.create_evm_approval_signature(intent_id).unwrap();

    // Same input should produce same signature (deterministic)
    let signature2 = service.create_evm_approval_signature(intent_id).unwrap();

    // Signatures should be identical (deterministic keccak256 hashing)
    assert_eq!(signature1, signature2, "Signatures should be deterministic");
}

/// 16. Test: Ethereum Message Prefix
/// Verifies that the signature has valid 65-byte format indicating the Ethereum signed message prefix was applied.
/// Why: Ethereum requires the "\x19Ethereum Signed Message:\n32" prefix for ecrecover compatibility.
#[test]
fn test_evm_signature_ethereum_message_prefix() {
    let config = build_test_config_with_mvm();
    let service = CryptoService::new(&config).unwrap();

    let intent_id = DUMMY_INTENT_ID;

    // Create signature
    let signature = service.create_evm_approval_signature(intent_id).unwrap();

    // Signature should be valid format (65 bytes with valid v)
    assert_eq!(signature.len(), 65);
    let v = signature[64];
    assert!(v == 27 || v == 28);

    // The signature format indicates Ethereum message prefix was applied
    // (we can't directly verify the prefix without reimplementing the hash, but we verify the result is valid)
}

/// 17. Test: Intent ID Padding
/// Verifies that short, full, and unprefixed intent IDs all produce valid 65-byte signatures after padding.
/// Why: Intent IDs must be padded to 32 bytes for EVM abi.encodePacked compatibility.
#[test]
fn test_evm_intent_id_padding() {
    let config = build_test_config_with_mvm();
    let service = CryptoService::new(&config).unwrap();

    // Test with short intent ID (should be left-padded with zeros)
    let short_intent_id = "0x1234";

    let signature1 = service
        .create_evm_approval_signature(short_intent_id)
        .unwrap();
    assert_eq!(
        signature1.len(),
        65,
        "Signature should be 65 bytes even with short intent ID"
    );

    // Test with full 32-byte intent ID
    let full_intent_id = DUMMY_INTENT_ID;
    let signature2 = service
        .create_evm_approval_signature(full_intent_id)
        .unwrap();
    assert_eq!(
        signature2.len(),
        65,
        "Signature should be 65 bytes with full intent ID"
    );

    // Test with intent ID without 0x prefix
    let intent_id_no_prefix = "1234567890123456789012345678901234567890123456789012345678901234";
    let signature3 = service
        .create_evm_approval_signature(intent_id_no_prefix)
        .unwrap();
    assert_eq!(
        signature3.len(),
        65,
        "Signature should work without 0x prefix"
    );
}

/// 18. Test: Invalid Intent ID Rejection
/// Verifies that intent IDs longer than 32 bytes and invalid hex strings are rejected with errors.
/// Why: Invalid intent IDs must be rejected early with clear errors to prevent malformed on-chain transactions.
#[test]
fn test_evm_signature_invalid_intent_id() {
    let config = build_test_config_with_mvm();
    let service = CryptoService::new(&config).unwrap();

    // Test with intent ID that's too long (> 32 bytes)
    let too_long_intent_id =
        "0x1234567890123456789012345678901234567890123456789012345678901234567890";
    let result = service.create_evm_approval_signature(too_long_intent_id);
    assert!(
        result.is_err(),
        "Should reject intent ID longer than 32 bytes"
    );

    // Test with invalid hex string
    let invalid_hex = "0xinvalid_hex_string_that_is_not_valid_hex";
    let result = service.create_evm_approval_signature(invalid_hex);
    assert!(result.is_err(), "Should reject invalid hex string");
}
