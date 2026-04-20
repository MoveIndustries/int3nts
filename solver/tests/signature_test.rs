//! Simple test for solver signature generation
//!
//! This test verifies that the core Ed25519 signature generation works correctly
//! without requiring Aptos CLI or config files.

use ed25519_dalek::{Signer, SigningKey};
use rand::Rng;

// 1. Test: we can generate a valid Ed25519 signature
// Verifies that we can generate a valid Ed25519 signature.
// Why: see test body.
#[test]
fn test_ed25519_signature_generation() {
    // Generate a random private key (32 bytes)
    let mut rng = rand::thread_rng();
    let mut private_key_bytes = [0u8; 32];
    rng.fill(&mut private_key_bytes);

    // Create signing key
    let signing_key = SigningKey::from_bytes(&private_key_bytes);
    let verifying_key = signing_key.verifying_key();

    // Create a test message hash (simulating BCS-encoded IntentToSign)
    let message_hash = b"test message hash for intent signing";

    // Sign the message
    let signature = signing_key.sign(message_hash);
    let signature_bytes = signature.to_bytes();

    // Verify signature is 64 bytes (Ed25519 signature length)
    assert_eq!(
        signature_bytes.len(),
        64, // Ed25519 signature format requirement: 64 bytes
        "Ed25519 signature must be 64 bytes"
    );

    // Verify the signature
    verifying_key
        .verify_strict(message_hash, &signature)
        .expect("Signature should be valid");

    // Test hex encoding (as used in the binary)
    let signature_hex = format!("0x{}", hex::encode(signature_bytes));
    assert!(
        signature_hex.starts_with("0x"),
        "Hex signature should start with 0x"
    );
    assert_eq!(
        signature_hex.len(),
        130, // Format requirement: 0x prefix (2 chars) + 128 hex chars (64 bytes * 2) = 130 chars
        "Hex signature should be 130 chars (0x + 128 hex chars)"
    );
}

// 2. Test: signature verification fails with wrong message
// Verifies that signature verification fails with wrong message.
// Why: see test body.
#[test]
fn test_signature_verification_fails_wrong_message() {
    let mut rng = rand::thread_rng();
    let mut private_key_bytes = [0u8; 32];
    rng.fill(&mut private_key_bytes);

    let signing_key = SigningKey::from_bytes(&private_key_bytes);
    let verifying_key = signing_key.verifying_key();

    let message1 = b"original message";
    let message2 = b"different message";

    let signature = signing_key.sign(message1);

    // Should verify with correct message
    verifying_key
        .verify_strict(message1, &signature)
        .expect("Signature should be valid for correct message");

    // Should fail with wrong message
    let result = verifying_key.verify_strict(message2, &signature);
    assert!(
        result.is_err(),
        "Signature should fail verification with wrong message"
    );
}

// 3. Test: base64 private key parsing roundtrips
// Verifies that base64-encoded Ed25519 private keys decode back to the original 32 bytes.
// Why: get_private_key_from_profile relies on base64 encoding; a roundtrip bug would break signing.
#[test]
fn test_parse_private_key_base64() {
    use base64::{engine::general_purpose, Engine as _};

    // Generate a test private key
    let mut rng = rand::thread_rng();
    let mut private_key_bytes = [0u8; 32];
    rng.fill(&mut private_key_bytes);

    // Encode to base64
    let private_key_b64 = general_purpose::STANDARD.encode(private_key_bytes);

    // Decode back
    let decoded_bytes = general_purpose::STANDARD
        .decode(&private_key_b64)
        .expect("Should decode base64");

    assert_eq!(decoded_bytes.len(), 32, "Decoded key should be 32 bytes"); // Ed25519 private key format requirement: 32 bytes
    assert_eq!(
        decoded_bytes, private_key_bytes,
        "Decoded key should match original"
    );
}

// 4. Test: get_intent_hash rejects solver addresses without 0x prefix
// Verifies that get_intent_hash rejects solver addresses without 0x prefix.
// Why: Addresses must have 0x prefix - missing prefix indicates a bug in calling code.
#[test]
fn test_get_intent_hash_rejects_address_without_prefix() {
    use solver::crypto::get_intent_hash;

    // Address WITHOUT 0x prefix - this should be rejected early
    // Use simple repeated pattern (64 hex chars = 32 bytes for Move address)
    let solver_addr_no_prefix = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"; // Test-specific: address without 0x prefix to test validation

    let result = get_intent_hash(
        "test-profile",
        "0x123",
        "0xabc",
        1000000,
        1,
        "0xdef",
        1000000,
        2,
        1234567890,
        "0xissuer",
        solver_addr_no_prefix, // Missing 0x prefix
        500, // fee_in_offered_token
        "https://testnet.movementnetwork.xyz/v1",
        false, // e2e_mode: false (testnet mode)
    );

    assert!(result.is_err(), "Should reject address without 0x prefix");
    let err = result.unwrap_err();
    assert!(
        err.to_string().contains("must start with 0x prefix"),
        "Error should mention missing 0x prefix: {}",
        err
    );
    assert!(
        err.to_string().contains(solver_addr_no_prefix),
        "Error should include the invalid address: {}",
        err
    );
}

// 5. Test: solver address normalization strips 0x prefix
// Verifies that addresses with a 0x prefix are correctly normalized by stripping the prefix for REST API queries.
// Why: Move REST API expects addresses without the 0x prefix; normalization must be consistent.
#[test]
fn test_solver_address_normalization() {
    // Test case 1: Address with 0x prefix should have it removed
    let solver_with_prefix = "0xaaaaaaaa"; // Test-specific: short address for normalization test
    let normalized = solver_with_prefix
        .strip_prefix("0x")
        .expect("Address with 0x prefix should be valid");
    assert_eq!(normalized, "aaaaaaaa", "Should remove 0x prefix");

    // Test case 2: Move address format (64 hex chars = 32 bytes)
    // Use simple repeated pattern
    let real_addr = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"; // Test-specific: Move VM address format (64 hex chars = 32 bytes)
    let normalized2 = real_addr
        .strip_prefix("0x")
        .expect("Address should have 0x prefix");
    assert_eq!(
        normalized2, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        "Address should be normalized correctly"
    );
}
