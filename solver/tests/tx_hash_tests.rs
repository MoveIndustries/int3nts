//! Unit tests for transaction hash extraction from CLI output
//!
//! Tests the shared tx_hash module used by both MVM and EVM connected clients
//! to parse transaction hashes from aptos CLI and Hardhat script output.

use solver::chains::tx_hash::extract_tx_hash;

// ============================================================================
// JSON Parsing Tests
// ============================================================================

// 1. Test: extract_tx_hash parses aptos CLI JSON output
// Verifies that the JSON strategy extracts the transaction hash from a Result-wrapped JSON object with a transaction_hash field.
// Why: aptos CLI outputs this format; must parse correctly.
#[test]
fn test_extract_from_json() {
    let output = r#"{"Result": {"transaction_hash": "0xabc123", "gas_used": 100}}"#;
    assert_eq!(extract_tx_hash(output, "test").unwrap(), "0xabc123");
}

// 2. Test: extract_tx_hash parses unquoted line-based output
// Verifies that the Line strategy extracts the transaction hash from a labeled line of unquoted CLI output.
// Why: Hardhat scripts output this format.
#[test]
fn test_extract_from_line_unquoted() {
    let output = "Some preamble\nTransaction hash: 0xdef456\nDone";
    assert_eq!(extract_tx_hash(output, "test").unwrap(), "0xdef456");
}

// 3. Test: extract_tx_hash parses quoted JSON hash field
// Verifies that extract_tx_hash handles a flat JSON object with a quoted transaction_hash field (not wrapped in Result).
// Why: Some output formats use flat JSON with quoted hash values.
#[test]
fn test_extract_from_line_quoted() {
    let output = r#"{"transaction_hash": "0x789abc"}"#;
    assert!(extract_tx_hash(output, "test").is_ok());
}

// ============================================================================
// Error Handling Tests
// ============================================================================

// 4. Test: extract_tx_hash fails when no hash is present
// Verifies that extract_tx_hash returns an error when the output contains no transaction hash.
// Why: Must fail explicitly rather than returning garbage.
#[test]
fn test_extract_no_hash_fails() {
    let output = "No hash here\nJust some output";
    assert!(extract_tx_hash(output, "test").is_err());
}

// ============================================================================
// Integration-Style Tests
// ============================================================================

// 5. Test: extract_tx_hash parses multi-line Hardhat output
// Verifies that extract_tx_hash finds the transaction hash line among unrelated Hardhat output lines.
// Why: Real Hardhat output includes solver address, block number, etc.
#[test]
fn test_extract_hardhat_output() {
    let output = "Solver address: 0xf39...\nTransaction hash: 0xfeed1234\nBlock number: 42";
    assert_eq!(extract_tx_hash(output, "hardhat").unwrap(), "0xfeed1234");
}
