import { describe, expect, it, vi } from 'vitest';
import { getAddress } from 'viem';
import { getEscrowContractAddress, intentIdToEvmBytes32 } from './escrow';
import { DUMMY_ESCROW_CONTRACT_ADDR_EVM, DUMMY_INTENT_ID } from './test-constants';

vi.mock('@/config/chains', () => ({
  getEscrowContractAddress: (chainId: string) => {
    if (chainId === 'base-sepolia') {
      return DUMMY_ESCROW_CONTRACT_ADDR_EVM;
    }
    throw new Error(`Missing escrow contract address for chain: ${chainId}`);
  },
  getRpcUrl: () => 'http://localhost:8545',
}));

describe('intentIdToEvmBytes32', () => {
  /**
   * Test: Intent ID conversion with 0x prefix
   * Why: EVM uses bytes32 for intent IDs in GMP-validated escrow.
   */
  it('should convert 0x-prefixed intent IDs to 0x-prefixed bytes32 hex', () => {
    const intentId = DUMMY_INTENT_ID;
    const result = intentIdToEvmBytes32(intentId);
    expect(result).toBe(intentId);
    expect(result.length).toBe(66); // 0x + 64 hex chars
  });

  /**
   * Test: Intent ID conversion without prefix
   * Why: Some sources omit 0x but still represent 32-byte hex.
   */
  it('should convert non-prefixed intent IDs to 0x-prefixed bytes32 hex', () => {
    const intentId = 'ab'.repeat(32);
    const result = intentIdToEvmBytes32(intentId);
    expect(result).toBe(`0x${intentId}`);
    expect(result.length).toBe(66);
  });

  /**
   * Test: Short intent IDs are zero-padded to 32 bytes
   * Why: Intent IDs shorter than 32 bytes must be left-padded with zeros.
   */
  it('should zero-pad short intent IDs to 32 bytes', () => {
    const result = intentIdToEvmBytes32('0x1');
    expect(result).toBe('0x' + '0'.repeat(63) + '1');
  });
});

describe('getEscrowContractAddress', () => {
  /**
   * Test: Escrow address normalization
   * Why: viem requires checksummed addresses for contract writes.
   */
  it('should return a checksummed EVM address', () => {
    const address = getEscrowContractAddress('base-sepolia');
    expect(address).toBe(getAddress(DUMMY_ESCROW_CONTRACT_ADDR_EVM));
  });

  /**
   * Test: Missing escrow address
   * Why: Misconfigured chains should fail fast.
   */
  it('should throw for missing chain config', () => {
    expect(() => getEscrowContractAddress('unknown-chain')).toThrow(
      'Missing escrow contract address for chain: unknown-chain'
    );
  });
});
