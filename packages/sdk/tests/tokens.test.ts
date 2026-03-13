import { describe, expect, it } from 'vitest';
import { getTokensByChain, toSmallestUnits, fromSmallestUnits } from '../src/config.js';
import { TEST_TOKENS } from './test-fixtures.js';

describe('getTokensByChain', () => {
  /**
   * Test: SVM token list
   * Why: UI needs chain-specific token options to render correctly.
   */
  it('should return SVM tokens for svm-connected', () => {
    const tokens = getTokensByChain(TEST_TOKENS, 'svm-connected');
    const symbols = tokens.map((token) => token.symbol);
    expect(symbols).toContain('TK1');
    expect(symbols).toContain('TK2');
  });
});

describe('unit conversions', () => {
  /**
   * Test: Decimal to smallest units
   * Why: Token amounts must be serialized as integers for on-chain usage.
   */
  it('should convert to smallest units', () => {
    expect(toSmallestUnits(1.5, 6)).toBe(1_500_000);
  });

  /**
   * Test: Smallest units to decimal
   * Why: UI display must convert from on-chain units to human-readable values.
   */
  it('should convert from smallest units', () => {
    expect(fromSmallestUnits(1_500_000, 6)).toBe(1.5);
  });
});
