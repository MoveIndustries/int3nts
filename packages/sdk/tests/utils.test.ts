// Tests for hex/bytes utilities
//
// These tests verify the correctness of data transformations required
// for cross-chain intent operations.

import { describe, it, expect } from 'vitest';
import { hexToBytes, padEvmAddressToMove, stripHexPrefix } from '../src/utils.js';

describe('hexToBytes', () => {
  // 1. Test: Basic hex to bytes conversion
  // Verifies that hexToBytes decodes a hex string into a Uint8Array whose length and per-byte values correspond to the hex pairs.
  // Why: The Move contract expects vector<u8> for signatures Incorrect conversion causes signature verification failure.
  it('should convert hex string to Uint8Array', () => {
    const bytes = hexToBytes('aabbccdd');
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes).toHaveLength(4);
    expect(bytes[0]).toBe(0xaa);
    expect(bytes[1]).toBe(0xbb);
    expect(bytes[2]).toBe(0xcc);
    expect(bytes[3]).toBe(0xdd);
  });


  // 2. Test: Ed25519 signature length (64 bytes)
  // Verifies that hexToBytes produces an output byte length equal to half the input hex-character count, as required for full-sized Ed25519 signatures.
  // Why: Ed25519 signatures are exactly 64 bytes. The Move contract verifies this length during signature validation.
  it('should handle 64-byte Ed25519 signature', () => {
    const signatureHex = 'ab'.repeat(64);
    const bytes = hexToBytes(signatureHex);
    expect(bytes).toHaveLength(64);
    expect(bytes.every(b => b === 0xab)).toBe(true);
  });


  // 3. Test: 0x prefix handling
  // Verifies that hexToBytes transparently strips a leading 0x prefix before decoding.
  // Why: Hex strings from APIs may include 0x prefix The function must handle both formats.
  it('should strip 0x prefix automatically', () => {
    const bytes = hexToBytes('0xaabbccdd');
    expect(bytes).toHaveLength(4);
    expect(bytes[0]).toBe(0xaa);
  });


  // 4. Test: Empty input handling
  // Verifies that hexToBytes returns a 0-length Uint8Array for an empty string.
  // Why: Defensive programming - should not crash on empty input.
  it('should return empty array for empty string', () => {
    const bytes = hexToBytes('');
    expect(bytes).toHaveLength(0);
  });
});

describe('padEvmAddressToMove', () => {
  // 5. Test: Pad 20-byte EVM address to 32 bytes
  // Verifies that padEvmAddressToMove left-pads a 20-byte EVM address with 12 zero bytes to produce a 32-byte 0x-prefixed hex string.
  // Why: The requester_addr_connected_chain parameter in the Move contract expects a 32-byte address. EVM addresses (20 bytes) must be left-padded with 12 zero bytes.
  it('should pad 20-byte EVM address to 32 bytes', () => {
    const padded = padEvmAddressToMove('0x1234567890abcdef1234567890abcdef12345678');

    // 0x prefix (2 chars) + 64 hex chars = 66 total
    expect(padded).toHaveLength(66);
    // 24 zeros (12 bytes) + 40 hex chars (20 bytes) = 64 hex chars (32 bytes)
    expect(padded).toBe('0x0000000000000000000000001234567890abcdef1234567890abcdef12345678');
  });


  // 6. Test: Handle addresses without 0x prefix
  // Verifies that padEvmAddressToMove accepts addresses without the 0x prefix and still returns a 0x-prefixed 32-byte result.
  // Why: Some APIs return addresses without the 0x prefix The function must handle both formats consistently.
  it('should handle address without 0x prefix', () => {
    const padded = padEvmAddressToMove('1234567890abcdef1234567890abcdef12345678');
    expect(padded).toHaveLength(66);
    expect(padded.startsWith('0x')).toBe(true);
  });


  // 7. Test: Lowercase normalization
  // Verifies that padEvmAddressToMove lowercases the hex payload so the output is canonical.
  // Why: Move addresses are case-insensitive but should be normalized to lowercase for consistency.
  it('should normalize to lowercase', () => {
    const padded = padEvmAddressToMove('0xABCDEF1234567890ABCDEF1234567890ABCDEF12');
    expect(padded).toBe('0x000000000000000000000000abcdef1234567890abcdef1234567890abcdef12');
  });
});

describe('stripHexPrefix', () => {
  // 8. Test: Remove 0x prefix
  // Verifies that stripHexPrefix returns the input hex string with a leading 0x removed.
  // Why: Some APIs expect hex without prefix.
  it('should remove 0x prefix', () => {
    expect(stripHexPrefix('0xabcd')).toBe('abcd');
  });


  // 9. Test: No-op when no prefix
  // Verifies that stripHexPrefix returns the input unchanged when there is no 0x prefix.
  // Why: Should not modify strings without prefix.
  it('should return unchanged if no prefix', () => {
    expect(stripHexPrefix('abcd')).toBe('abcd');
  });
});
