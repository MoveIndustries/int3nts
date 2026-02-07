//! Unit tests for CLI parsing functions

use intent_escrow_cli::{
    hex_to_bytes32, parse_32_byte_hex, parse_options, parse_u32, required_option,
};
use std::collections::HashMap;

// ============================================================================
// parse_32_byte_hex TESTS
// ============================================================================

/// What is tested: parse_32_byte_hex with full 32-byte address with 0x prefix
/// Why: This is the standard format for Move addresses. Incorrect parsing would cause transactions to target wrong addresses.
#[test]
fn test_parse_32_byte_hex_full_address() {
    // 32 bytes: 0x00 through 0x1f
    let input = "0x000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f";
    let result = parse_32_byte_hex(input).unwrap();
    assert_eq!(result[0], 0x00);
    assert_eq!(result[15], 0x0f);
    assert_eq!(result[31], 0x1f);
}

/// What is tested: parse_32_byte_hex without 0x prefix
/// Why: Users may copy addresses without the prefix. Rejecting these would cause unnecessary CLI failures.
#[test]
fn test_parse_32_byte_hex_without_0x_prefix() {
    // Same 32 bytes without 0x prefix
    let input = "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f";
    let result = parse_32_byte_hex(input).unwrap();
    assert_eq!(result[0], 0x00);
    assert_eq!(result[15], 0x0f);
    assert_eq!(result[31], 0x1f);
}

/// What is tested: parse_32_byte_hex left-pads short addresses with zeros
/// Why: Move addresses are often displayed without leading zeros. The CLI must pad these to 32 bytes.
#[test]
fn test_parse_32_byte_hex_short_address_pads_left() {
    let input = "0x1234";
    let result = parse_32_byte_hex(input).unwrap();
    for i in 0..30 {
        assert_eq!(result[i], 0, "byte {} should be 0", i);
    }
    assert_eq!(result[30], 0x12);
    assert_eq!(result[31], 0x34);
}

/// What is tested: parse_32_byte_hex handles single byte hex value
/// Why: Edge case for shortest possible input. Ensures padding logic handles extreme cases.
#[test]
fn test_parse_32_byte_hex_single_byte() {
    let input = "0xff";
    let result = parse_32_byte_hex(input).unwrap();
    for i in 0..31 {
        assert_eq!(result[i], 0, "byte {} should be 0", i);
    }
    assert_eq!(result[31], 0xff);
}

/// What is tested: parse_32_byte_hex returns all zeros for empty input
/// Why: Empty string is a valid edge case. Returning zeros is consistent with left-padding behavior.
#[test]
fn test_parse_32_byte_hex_empty_is_all_zeros() {
    let input = "";
    let result = parse_32_byte_hex(input).unwrap();
    assert_eq!(result, [0u8; 32]);
}

/// What is tested: parse_32_byte_hex rejects addresses longer than 32 bytes
/// Why: Accepting oversized input would silently truncate the address, causing transactions to target unintended addresses.
#[test]
fn test_parse_32_byte_hex_rejects_too_long() {
    // 33 bytes (66 hex chars) - one byte too many
    let input = "0x0001020304050607080910111213141516171819202122232425262728293031ff";
    let result = parse_32_byte_hex(input);
    assert!(result.is_err());
    assert!(result.unwrap_err().to_string().contains("too long"));
}

/// What is tested: parse_32_byte_hex rejects invalid hex characters
/// Why: Invalid hex must propagate as clear errors rather than producing garbage output.
#[test]
fn test_parse_32_byte_hex_rejects_invalid_hex() {
    let input = "0xGGGG";
    let result = parse_32_byte_hex(input);
    assert!(result.is_err());
}

// ============================================================================
// parse_u32 TESTS
// ============================================================================

/// What is tested: parse_u32 accepts valid u32 values including boundaries
/// Why: Chain IDs are u32. Incorrect parsing would configure the wrong chain for GMP messages.
#[test]
fn test_parse_u32_valid() {
    assert_eq!(parse_u32("0").unwrap(), 0);
    assert_eq!(parse_u32("1").unwrap(), 1);
    assert_eq!(parse_u32("4294967295").unwrap(), u32::MAX);
}

/// What is tested: parse_u32 rejects negative numbers
/// Why: Chain IDs cannot be negative. Accepting "-1" would wrap to u32::MAX, silently misconfiguring the endpoint.
#[test]
fn test_parse_u32_rejects_negative() {
    assert!(parse_u32("-1").is_err());
}

/// What is tested: parse_u32 rejects values exceeding u32::MAX
/// Why: Overflow would silently wrap, causing chain_id=4294967296 to become 0.
#[test]
fn test_parse_u32_rejects_overflow() {
    assert!(parse_u32("4294967296").is_err());
}

/// What is tested: parse_u32 rejects non-numeric input
/// Why: User typos like "four" instead of "4" must fail clearly, not silently produce a default value.
#[test]
fn test_parse_u32_rejects_non_numeric() {
    assert!(parse_u32("abc").is_err());
    assert!(parse_u32("").is_err());
}

// ============================================================================
// parse_options TESTS
// ============================================================================

/// What is tested: parse_options parses single --key value pair
/// Why: Basic CLI functionality. If this fails, no commands would work.
#[test]
fn test_parse_options_single_option() {
    let args = vec!["--rpc".to_string(), "http://localhost:8899".to_string()];
    let options = parse_options(&args).unwrap();
    assert_eq!(options.get("rpc").unwrap(), "http://localhost:8899");
}

/// What is tested: parse_options parses multiple --key value pairs
/// Why: Real CLI invocations have many options. Missing any option would cause command failures.
#[test]
fn test_parse_options_multiple_options() {
    let args = vec![
        "--gmp-program-id".to_string(),
        "ABC123".to_string(),
        "--payer".to_string(),
        "/path/to/key.json".to_string(),
        "--chain-id".to_string(),
        "4".to_string(),
    ];
    let options = parse_options(&args).unwrap();
    assert_eq!(options.get("gmp-program-id").unwrap(), "ABC123");
    assert_eq!(options.get("payer").unwrap(), "/path/to/key.json");
    assert_eq!(options.get("chain-id").unwrap(), "4");
}

/// What is tested: parse_options returns empty map for empty input
/// Why: Commands with only defaults (like help) have no args. This must not panic or error.
#[test]
fn test_parse_options_empty() {
    let args: Vec<String> = vec![];
    let options = parse_options(&args).unwrap();
    assert!(options.is_empty());
}

/// What is tested: parse_options rejects --key without a following value
/// Why: "--rpc" alone is invalid. Accepting it would cause the next option name to be interpreted as the value.
#[test]
fn test_parse_options_rejects_missing_value() {
    let args = vec!["--rpc".to_string()];
    let result = parse_options(&args);
    assert!(result.is_err());
}

/// What is tested: parse_options rejects arguments without -- prefix
/// Why: "rpc http://..." is ambiguous. Requiring -- prefix makes the CLI consistent with standard conventions.
#[test]
fn test_parse_options_rejects_no_prefix() {
    let args = vec!["rpc".to_string(), "http://localhost:8899".to_string()];
    let result = parse_options(&args);
    assert!(result.is_err());
}

// ============================================================================
// required_option TESTS
// ============================================================================

/// What is tested: required_option returns value when key is present
/// Why: Basic lookup functionality. If this fails, no required options work.
#[test]
fn test_required_option_present() {
    let mut options = HashMap::new();
    options.insert("chain-id".to_string(), "4".to_string());
    assert_eq!(required_option(&options, "chain-id").unwrap(), "4");
}

/// What is tested: required_option error includes the missing key name
/// Why: Generic "missing option" errors are unhelpful. Including the key name tells the user exactly what to add.
#[test]
fn test_required_option_missing() {
    let options: HashMap<String, String> = HashMap::new();
    let result = required_option(&options, "chain-id");
    assert!(result.is_err());
    assert!(result.unwrap_err().to_string().contains("chain-id"));
}

// ============================================================================
// hex_to_bytes32 TESTS
// ============================================================================

/// What is tested: hex_to_bytes32 converts full 64-char hex string to correct bytes
/// Why: Intent IDs are 32 bytes. Incorrect conversion would create escrows for non-existent intents.
#[test]
fn test_hex_to_bytes32_full() {
    let input = "0x0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20";
    let result = hex_to_bytes32(input);
    for i in 0..32 {
        assert_eq!(result[i], (i + 1) as u8);
    }
}

/// What is tested: hex_to_bytes32 left-pads short hex strings to 32 bytes
/// Why: Intent IDs displayed without leading zeros must still resolve to the correct 32-byte value.
#[test]
fn test_hex_to_bytes32_short_pads_left() {
    let input = "0xabcd";
    let result = hex_to_bytes32(input);
    for i in 0..30 {
        assert_eq!(result[i], 0);
    }
    assert_eq!(result[30], 0xab);
    assert_eq!(result[31], 0xcd);
}

/// What is tested: hex_to_bytes32 handles odd-length hex by prepending zero nibble
/// Why: "0xabc" is 1.5 bytes. The parser must treat it as "0x0abc" (2 bytes) or hex decode would fail.
#[test]
fn test_hex_to_bytes32_odd_length_pads_nibble() {
    let input = "0xabc";
    let result = hex_to_bytes32(input);
    assert_eq!(result[30], 0x0a);
    assert_eq!(result[31], 0xbc);
}

/// What is tested: hex_to_bytes32 panics on invalid hex characters
/// Why: hex_to_bytes32 is used for intent IDs where failure is unrecoverable. A panic with clear message is better than silent corruption.
#[test]
#[should_panic(expected = "Invalid hex string")]
fn test_hex_to_bytes32_invalid_hex_panics() {
    hex_to_bytes32("0xZZZZ");
}
