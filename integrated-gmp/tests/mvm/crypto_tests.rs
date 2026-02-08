//! Unit tests for Move VM/Ed25519 cryptographic operations
//!
//! These tests verify Ed25519 signature functionality for Move VM chain compatibility.

use integrated_gmp::crypto::CryptoService;

#[path = "../mod.rs"]
mod test_helpers;
use test_helpers::{build_test_config_with_mvm, create_default_fulfillment};

/// 1. Test: Unique Key Generation
/// Verifies that each CryptoService instance creates a different Ed25519 key pair.
/// Why: Each integrated-gmp instance must have a unique cryptographic identity to prevent key collisions.
#[test]
fn test_unique_key_generation() {
    let config1 = build_test_config_with_mvm();
    let config2 = build_test_config_with_mvm();
    let service1 = CryptoService::new(&config1).unwrap();
    let service2 = CryptoService::new(&config2).unwrap();

    let public_key1 = service1.get_public_key();
    let public_key2 = service2.get_public_key();

    // Each instance should have a different key
    assert_ne!(public_key1, public_key2);
}

/// 2. Test: Signature Creation and Verification
/// Verifies that an MVM approval signature can be created and verified against the original intent ID.
/// Why: Cryptographic signatures are the core security mechanism and must round-trip correctly.
#[test]
fn test_signature_creation_and_verification() {
    let config = build_test_config_with_mvm();
    let service = CryptoService::new(&config).unwrap();

    // Create an approval signature (signs intent_id)
    let intent_id = "0x01";
    let signature_data = service.create_mvm_approval_signature(intent_id).unwrap();

    // Verify the signature - reconstruct message from intent_id
    let intent_id_hex = intent_id.strip_prefix("0x").unwrap_or(intent_id);
    let intent_id_bytes = hex::decode(intent_id_hex).unwrap();
    let mut intent_id_padded = [0u8; 32];
    intent_id_padded[32 - intent_id_bytes.len()..].copy_from_slice(&intent_id_bytes);
    let message = bcs::to_bytes(&intent_id_padded).unwrap();
    let is_valid = service
        .verify_signature(&message, &signature_data.signature)
        .unwrap();

    assert!(is_valid, "Signature should be valid");
}

/// 4. Test: Signature Verification Fails for Wrong Message
/// Verifies that a signature created for one intent ID fails verification against a different intent ID.
/// Why: Signatures must be bound to specific intent IDs to prevent replay attacks.
#[test]
fn test_signature_verification_fails_for_wrong_message() {
    let config = build_test_config_with_mvm();
    let service = CryptoService::new(&config).unwrap();

    // Create signature for intent_id
    let intent_id = "0x01";
    let signature_data = service.create_mvm_approval_signature(intent_id).unwrap();

    // Try to verify with wrong intent_id
    let wrong_intent_id = "0x02";
    let wrong_intent_id_hex = wrong_intent_id
        .strip_prefix("0x")
        .unwrap_or(wrong_intent_id);
    let wrong_intent_id_bytes = hex::decode(wrong_intent_id_hex).unwrap();
    let mut wrong_intent_id_padded = [0u8; 32];
    wrong_intent_id_padded[32 - wrong_intent_id_bytes.len()..]
        .copy_from_slice(&wrong_intent_id_bytes);
    let wrong_message = bcs::to_bytes(&wrong_intent_id_padded).unwrap();
    let is_valid = service
        .verify_signature(&wrong_message, &signature_data.signature)
        .unwrap();

    assert!(!is_valid, "Signature should fail for wrong intent_id");
}

/// 5. Test: Signatures Differ for Different Intent IDs
/// Verifies that signing two distinct intent IDs produces two distinct signatures.
/// Why: Each intent ID must yield a unique signature to prevent cross-intent replay attacks.
#[test]
fn test_signatures_differ_for_different_intent_ids() {
    let config = build_test_config_with_mvm();
    let service = CryptoService::new(&config).unwrap();

    let intent_id1 = "0x01";
    let intent_id2 = "0x02";
    let sig1 = service.create_mvm_approval_signature(intent_id1).unwrap();
    let sig2 = service.create_mvm_approval_signature(intent_id2).unwrap();

    // Signatures should be different (they sign different intent_ids)
    assert_ne!(sig1.signature, sig2.signature);
}

/// 6. Test: Escrow Approval Signature
/// Verifies that an escrow approval signature is created and validates against the reconstructed message.
/// Why: Escrow operations require cryptographic authorization and signatures must be valid on-chain.
#[test]
fn test_escrow_approval_signature() {
    let config = build_test_config_with_mvm();
    let service = CryptoService::new(&config).unwrap();

    // Create escrow approval signature (signs intent_id)
    let intent_id = "0x01";
    let signature_data = service.create_mvm_approval_signature(intent_id).unwrap();

    // Verify the signature - reconstruct message from intent_id
    let intent_id_hex = intent_id.strip_prefix("0x").unwrap_or(intent_id);
    let intent_id_bytes = hex::decode(intent_id_hex).unwrap();
    let mut intent_id_padded = [0u8; 32];
    intent_id_padded[32 - intent_id_bytes.len()..].copy_from_slice(&intent_id_bytes);
    let message = bcs::to_bytes(&intent_id_padded).unwrap();
    let is_valid = service
        .verify_signature(&message, &signature_data.signature)
        .unwrap();

    assert!(is_valid, "Escrow signature should be valid");
}

/// 7. Test: Public Key Consistency
/// Verifies that repeated calls to get_public_key on the same instance return the same key.
/// Why: The public key must remain constant for a given instance so external verifiers can rely on it.
#[test]
fn test_public_key_consistency() {
    let config = build_test_config_with_mvm();
    let service = CryptoService::new(&config).unwrap();

    let public_key1 = service.get_public_key();
    let public_key2 = service.get_public_key();

    // Public key should be the same for the same instance
    assert_eq!(public_key1, public_key2);
}

/// 8. Test: Signature Contains Timestamp
/// Verifies that the signature data includes a non-zero, recent timestamp.
/// Why: Timestamps enable replay attack prevention and provide an audit trail for approval decisions.
#[test]
fn test_signature_contains_timestamp() {
    let config = build_test_config_with_mvm();
    let service = CryptoService::new(&config).unwrap();

    let intent_id = "0x01";
    let signature_data = service.create_mvm_approval_signature(intent_id).unwrap();

    // Timestamp should be non-zero and reasonable (within last hour)
    assert!(signature_data.timestamp > 0, "Timestamp should be non-zero");

    let now = chrono::Utc::now().timestamp() as u64;
    assert!(
        signature_data.timestamp <= now,
        "Timestamp should be in the past"
    );
    assert!(
        signature_data.timestamp >= now - 3600,
        "Timestamp should be recent"
    );
}

/// 9. Test: MVM Signature Intent ID Validation
/// Verifies that valid hex intent IDs are accepted and invalid hex strings are rejected with clear errors.
/// Why: Intent ID validation must be strict to prevent malformed data from reaching on-chain operations.
#[test]
fn test_mvm_signature_intent_id_validation() {
    let config = build_test_config_with_mvm();
    let service = CryptoService::new(&config).unwrap();

    // Test with valid intent ID from default helper (should succeed)
    let default_fulfillment = create_default_fulfillment();
    let valid_intent_id = &default_fulfillment.intent_id;
    let result = service.create_mvm_approval_signature(valid_intent_id);
    assert!(
        result.is_ok(),
        "Should accept valid intent ID from default helper with even number of hex digits"
    );

    // Test with intent ID that has odd number of hex digits (now valid after padding)
    let odd_digits_intent_id = "0x123";
    let result = service.create_mvm_approval_signature(odd_digits_intent_id);
    assert!(
        result.is_ok(),
        "Should accept intent ID with odd number of hex digits after padding"
    );

    // Test with invalid hex string (non-hex characters)
    let invalid_hex = "0xinvalid_hex_string";
    let result = service.create_mvm_approval_signature(invalid_hex);
    assert!(result.is_err(), "Should reject invalid hex string");

    let error_msg = result.unwrap_err().to_string();
    assert!(
        error_msg.contains("Invalid intent_id hex"),
        "Error message should indicate invalid hex format: {}",
        error_msg
    );
}
