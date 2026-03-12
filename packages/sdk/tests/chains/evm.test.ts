import { describe, expect, it } from 'vitest';
import { getAddress } from 'viem';
import { checksumEscrowAddress, intentIdToEvmBytes32 } from '../../src/chains/evm.js';
import { DUMMY_ESCROW_CONTRACT_ADDR_EVM, DUMMY_INTENT_ID } from '../test-constants.js';

// ============================================================================
// INTENT ID CONVERSION TESTS
// ============================================================================

describe('intentIdToEvmBytes32', () => {
  /// 1. Test: Intent ID Conversion with 0x Prefix
  /// Verifies that 0x-prefixed intent IDs are converted to 0x-prefixed bytes32 hex.
  /// Why: EVM uses bytes32 for intent IDs in GMP-validated escrow.
  it('should convert 0x-prefixed intent IDs to 0x-prefixed bytes32 hex', () => {
    const intentId = DUMMY_INTENT_ID;
    const result = intentIdToEvmBytes32(intentId);
    expect(result).toBe(intentId);
    expect(result.length).toBe(66); // 0x + 64 hex chars
  });

  /// 2. Test: Intent ID Conversion without Prefix
  /// Verifies that non-prefixed intent IDs are converted to 0x-prefixed bytes32 hex.
  /// Why: Some sources omit 0x but still represent 32-byte hex.
  it('should convert non-prefixed intent IDs to 0x-prefixed bytes32 hex', () => {
    const intentId = 'ab'.repeat(32);
    const result = intentIdToEvmBytes32(intentId);
    expect(result).toBe(`0x${intentId}`);
    expect(result.length).toBe(66);
  });

  /// 3. Test: Short Intent IDs are Zero-Padded
  /// Verifies that intent IDs shorter than 32 bytes are left-padded with zeros.
  /// Why: Intent IDs shorter than 32 bytes must be left-padded with zeros.
  it('should zero-pad short intent IDs to 32 bytes', () => {
    const result = intentIdToEvmBytes32('0x1');
    expect(result).toBe('0x' + '0'.repeat(63) + '1');
  });
});

// #4: Intent ID padding to 32 bytes — N/A for EVM (SVM uses byte-level padding, EVM uses intentIdToEvmBytes32)

// ============================================================================
// ESCROW ADDRESS TESTS
// ============================================================================

describe('checksumEscrowAddress', () => {
  /// 5. Test: Escrow Address Normalization
  /// Verifies that checksumEscrowAddress returns a checksummed EVM address.
  /// Why: viem requires checksummed addresses for contract writes.
  it('should return a checksummed EVM address', () => {
    const address = checksumEscrowAddress(DUMMY_ESCROW_CONTRACT_ADDR_EVM);
    expect(address).toBe(getAddress(DUMMY_ESCROW_CONTRACT_ADDR_EVM));
  });
});

// #6: Public key hex round-trip — N/A for EVM (EVM addresses are 20-byte hex, not public key round-trips)
// #7: PDA determinism (state/escrow/vault) — N/A for EVM (Solana-specific, EVM uses contract addresses)
// #8: Escrow account parsing — N/A for EVM (SVM-specific binary account layout, EVM uses ABI decoding)
// #9: CreateEscrow instruction layout — N/A for EVM (SVM-specific instruction serialization, EVM uses ABI-encoded calldata)
// #10: Claim instruction layout — N/A for EVM (SVM-specific instruction serialization, EVM uses ABI-encoded calldata)
// #11: Cancel instruction layout — N/A for EVM (SVM-specific instruction serialization, EVM uses ABI-encoded calldata)
