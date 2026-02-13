//! Library functions for the SVM intent escrow CLI
//!
//! This module exposes parsing utilities that can be tested independently.

use std::{collections::HashMap, error::Error};

// ============================================================================
// OPTION PARSING
// ============================================================================

/// Parse command-line arguments into a key-value map.
///
/// Arguments must be in the form `--key value`.
pub fn parse_options(args: &[String]) -> Result<HashMap<String, String>, Box<dyn Error>> {
    let mut options = HashMap::new();
    let mut index = 0;
    while index < args.len() {
        let key = args[index]
            .strip_prefix("--")
            .ok_or("Expected option in --key format")?;
        let value = args
            .get(index + 1)
            .ok_or("Missing value for option")?
            .to_string();
        options.insert(key.to_string(), value);
        index += 2;
    }
    Ok(options)
}

/// Get a required option from the map, returning an error if missing.
pub fn required_option<'a>(
    options: &'a HashMap<String, String>,
    key: &str,
) -> Result<&'a str, Box<dyn Error>> {
    options
        .get(key)
        .map(String::as_str)
        .ok_or_else(|| format!("Missing required option: --{key}").into())
}

// ============================================================================
// VALUE PARSING
// ============================================================================

/// Parse a string as a Solana pubkey.
pub fn parse_pubkey(value: &str) -> Result<solana_sdk::pubkey::Pubkey, Box<dyn Error>> {
    use std::str::FromStr;
    Ok(solana_sdk::pubkey::Pubkey::from_str(value)?)
}

/// Parse a string as a u64.
pub fn parse_u64(value: &str) -> Result<u64, Box<dyn Error>> {
    Ok(value.parse::<u64>()?)
}

/// Parse a string as a u32.
pub fn parse_u32(value: &str) -> Result<u32, Box<dyn Error>> {
    Ok(value.parse::<u32>()?)
}

/// Parse a string as an i64.
pub fn parse_i64(value: &str) -> Result<i64, Box<dyn Error>> {
    Ok(value.parse::<i64>()?)
}

/// Parse a hex string into a 32-byte array with left-padding.
///
/// Accepts hex strings with or without 0x prefix. Short strings are
/// left-padded with zeros. Strings longer than 32 bytes are rejected.
pub fn parse_32_byte_hex(value: &str) -> Result<[u8; 32], Box<dyn Error>> {
    let hex = value.strip_prefix("0x").unwrap_or(value);
    let bytes = hex::decode(hex)?;
    if bytes.len() > 32 {
        return Err("Address too long: expected at most 32 bytes".into());
    }
    let mut result = [0u8; 32];
    // Right-align (pad with zeros on left)
    let offset = 32 - bytes.len();
    result[offset..].copy_from_slice(&bytes);
    Ok(result)
}

/// Parse a hex string into a 32-byte intent ID.
///
/// Panics on invalid hex input.
pub fn parse_intent_id(value: &str) -> Result<[u8; 32], Box<dyn Error>> {
    Ok(hex_to_bytes32(value))
}

/// Parse a hex string into a 64-byte signature.
pub fn parse_signature(value: &str) -> Result<[u8; 64], Box<dyn Error>> {
    let hex = value.strip_prefix("0x").unwrap_or(value);
    let bytes = hex::decode(hex)?;
    if bytes.len() != 64 {
        return Err("Signature must be 64 bytes (128 hex chars)".into());
    }
    let mut signature = [0u8; 64];
    signature.copy_from_slice(&bytes);
    Ok(signature)
}

/// Convert a hex string to a 32-byte array with left-padding.
///
/// Panics if the hex string is invalid.
pub fn hex_to_bytes32(hex_string: &str) -> [u8; 32] {
    let hex = hex_string.strip_prefix("0x").unwrap_or(hex_string);
    let hex = if hex.len() % 2 == 1 {
        format!("0{}", hex)
    } else {
        hex.to_string()
    };
    let mut bytes = [0u8; 32];
    if let Ok(hex_bytes) = hex::decode(&hex) {
        let start = 32usize.saturating_sub(hex_bytes.len());
        if start < 32 {
            bytes[start..].copy_from_slice(&hex_bytes);
        }
    } else {
        panic!("Invalid hex string: {}", hex_string);
    }
    bytes
}
