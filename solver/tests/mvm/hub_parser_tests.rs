//! Unit tests for hub-chain JSON parser helpers
//!
//! Tests the public parser helpers in `solver::chains::hub` that decode the
//! Move VM's JSON wire formats: `vector<u8>` (0x-prefixed hex string) and
//! `Option<T>` (`{"vec": []}` for None, `{"vec": [value]}` for Some).
//!
//! Hub-side tests are not in extension-checklist.md (the checklist covers
//! cross-VM connected-chain tests only).

use serde_json::json;
use solver::chains::hub::{parse_hex_from_json, parse_optional_address, parse_optional_hex};

// ============================================================================
// JSON HEX PARSING TESTS
// ============================================================================

// 1. Test: parse_hex_from_json strips the 0x prefix and decodes the bytes
// Verifies that parse_hex_from_json decodes a "0x"-prefixed hex string into the
// matching byte vector.
// Why: the Move VM serializes vector<u8> as a 0x-prefixed hex string; the parser
// must accept that exact format produced by the node.
#[test]
fn test_parse_hex_from_json_with_prefix() {
    let value = json!("0x11223344");
    let result = parse_hex_from_json(&value);
    assert_eq!(result, vec![0x11, 0x22, 0x33, 0x44]);
}

// 2. Test: parse_hex_from_json decodes hex without the 0x prefix
// Verifies that parse_hex_from_json accepts an un-prefixed hex string.
// Why: some upstream JSON encodings strip the 0x prefix; the parser tolerates both.
#[test]
fn test_parse_hex_from_json_without_prefix() {
    let value = json!("22334455");
    let result = parse_hex_from_json(&value);
    assert_eq!(result, vec![0x22, 0x33, 0x44, 0x55]);
}

// 3. Test: parse_hex_from_json returns an empty vector for an empty string
// Verifies that parse_hex_from_json returns Vec::new() when the input string is empty.
// Why: the node serializes empty vector<u8> as the empty string; the parser must
// not panic and must return an empty result.
#[test]
fn test_parse_hex_from_json_empty() {
    let value = json!("");
    let result = parse_hex_from_json(&value);
    assert_eq!(result, Vec::<u8>::new());
}

// 4. Test: parse_hex_from_json returns an empty vector for a non-string JSON value
// Verifies that parse_hex_from_json defaults to Vec::new() when the JSON value
// is not a string (number, object, etc.).
// Why: malformed or unexpected payloads must not crash the solver — the parser
// returns an empty vector rather than panicking on a type mismatch.
#[test]
fn test_parse_hex_from_json_not_string() {
    let value = json!(123);
    let result = parse_hex_from_json(&value);
    assert_eq!(result, Vec::<u8>::new());
}

// ============================================================================
// OPTIONAL ADDRESS PARSING TESTS
// ============================================================================

// 5. Test: parse_optional_address extracts the address from Move's Some encoding
// Verifies that parse_optional_address returns Some(address) when the JSON
// encodes a populated Move Option (`{"vec": ["0x..."]}`).
// Why: Move's Option<address> serializes via a single-element vec; the parser
// must unwrap that representation back to an Option<String>.
#[test]
fn test_parse_optional_address_some() {
    let value =
        json!({"vec": ["0x3333333333333333333333333333333333333333333333333333333333333333"]});
    let result = parse_optional_address(&value);
    assert_eq!(
        result,
        Some("0x3333333333333333333333333333333333333333333333333333333333333333".to_string())
    );
}

// 6. Test: parse_optional_address returns None for Move's None encoding
// Verifies that parse_optional_address returns None for an empty Move Option
// (`{"vec": []}`).
// Why: Move's Option<address> for None serializes as a zero-element vec; the
// parser must distinguish that from a populated vec.
#[test]
fn test_parse_optional_address_none() {
    let value = json!({"vec": []});
    let result = parse_optional_address(&value);
    assert_eq!(result, None);
}

// 7. Test: parse_optional_address returns None for malformed input
// Verifies that parse_optional_address returns None when the JSON is not the
// expected Move Option shape (e.g. a bare string).
// Why: malformed payloads should fail soft to None rather than panicking, since
// upstream JSON can have schema drift.
#[test]
fn test_parse_optional_address_invalid() {
    let value = json!("not an option");
    let result = parse_optional_address(&value);
    assert_eq!(result, None);
}

// ============================================================================
// OPTIONAL HEX PARSING TESTS
// ============================================================================

// 8. Test: parse_optional_hex extracts the bytes from Move's Some encoding
// Verifies that parse_optional_hex returns the decoded bytes when the JSON
// encodes a populated Move Option<vector<u8>> (`{"vec": ["0x..."]}`).
// Why: Move's Option<vector<u8>> wraps the hex string in a single-element vec;
// the parser must unwrap and decode in one step.
#[test]
fn test_parse_optional_hex_some() {
    let value = json!({"vec": ["0x44556677"]});
    let result = parse_optional_hex(&value);
    assert_eq!(result, vec![0x44, 0x55, 0x66, 0x77]);
}

// 9. Test: parse_optional_hex returns an empty vector for Move's None encoding
// Verifies that parse_optional_hex returns Vec::new() for an empty Move Option
// (`{"vec": []}`).
// Why: empty vec must produce empty bytes; callers downstream rely on length
// checks to distinguish present vs absent values.
#[test]
fn test_parse_optional_hex_none() {
    let value = json!({"vec": []});
    let result = parse_optional_hex(&value);
    assert_eq!(result, Vec::<u8>::new());
}

// 10. Test: parse_optional_hex returns an empty vector for malformed input
// Verifies that parse_optional_hex returns Vec::new() when the JSON is not
// the expected Move Option shape.
// Why: schema drift in upstream payloads must not panic; callers see an empty
// vector and can decide how to handle it.
#[test]
fn test_parse_optional_hex_invalid() {
    let value = json!("not an option");
    let result = parse_optional_hex(&value);
    assert_eq!(result, Vec::<u8>::new());
}

// 11. Test: parse_optional_hex round-trips a 32-byte SVM-style address
// Verifies that parse_optional_hex correctly decodes a 32-byte hex string
// (typical SVM address length) without truncation or padding.
// Why: SVM addresses come through this code path as Option<vector<u8>>; getting
// the length wrong would silently route messages to the wrong account.
#[test]
fn test_parse_optional_hex_32_byte_address() {
    let svm_hex = "5555555555555555555555555555555555555555555555555555555555555555";
    let value = json!({"vec": [format!("0x{}", svm_hex)]});
    let result = parse_optional_hex(&value);
    assert_eq!(result.len(), 32);
    assert_eq!(hex::encode(&result), svm_hex);
}
