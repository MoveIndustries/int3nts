import { describe, it, expect } from 'vitest';
import {
  calculateFee,
  getChainKeyFromId,
  buildIntentArguments,
  INTENT_EXPIRY_SECS,
  BPS_DENOMINATOR,
  BPS_ROUNDING_OFFSET,
} from '../src/intent/index.js';
import type { TokenConfig } from '../src/config.js';
import type { DraftIntentSignature } from '../src/types.js';
import type { DraftData } from '../src/intent/types.js';
import { TEST_CHAINS } from './test-fixtures.js';
import { DUMMY_INTENT_ID } from './test-constants.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const DUMMY_TOKEN_A: TokenConfig = {
  symbol: 'TKA',
  name: 'Token A',
  metadata: '0x' + 'aa'.repeat(32),
  decimals: 6,
  chain: 'mvm-hub',
};

const DUMMY_TOKEN_B: TokenConfig = {
  symbol: 'TKB',
  name: 'Token B',
  metadata: '0x' + 'bb'.repeat(20),
  decimals: 6,
  chain: 'evm-connected',
};

// ---------------------------------------------------------------------------
// getChainKeyFromId
// ---------------------------------------------------------------------------

describe('getChainKeyFromId', () => {
  it('resolves numeric chain ID to config key', () => {
    expect(getChainKeyFromId(TEST_CHAINS, '100')).toBe('mvm-hub');
  });

  it('returns null for unknown chain ID', () => {
    expect(getChainKeyFromId(TEST_CHAINS, '999')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// calculateFee
// ---------------------------------------------------------------------------

describe('calculateFee', () => {
  it('calculates fee with base fee and bps', () => {
    const result = calculateFee(100, DUMMY_TOKEN_A, DUMMY_TOKEN_B, {
      exchange_rate: 1,
      base_fee_in_move: 0.5,
      move_rate: 2,
      fee_bps: 30,
    });

    // minFeeOffered = ceil(0.5 * 2) = 1
    expect(result.feeInfo.minFee).toBe(1);
    expect(result.feeInfo.feeBps).toBe(30);
    // bpsFee = (100_000_000 * 30 + 9999) / 10000 = 300_000 (ceiling)
    // totalFee = 1 + 300_000 = 300_001
    expect(result.feeInfo.totalFee).toBe(BigInt(300001));
    // desiredAmount should be a string
    expect(typeof result.desiredAmount).toBe('string');
    expect(parseFloat(result.desiredAmount)).toBeGreaterThan(0);
  });

  it('returns zero desired amount when fee exceeds offered', () => {
    const result = calculateFee(0.000001, DUMMY_TOKEN_A, DUMMY_TOKEN_B, {
      exchange_rate: 1,
      base_fee_in_move: 100,
      move_rate: 1,
      fee_bps: 0,
    });

    expect(result.desiredAmount).toBe('0');
  });

  it('handles zero fees', () => {
    const result = calculateFee(50, DUMMY_TOKEN_A, DUMMY_TOKEN_B, {
      exchange_rate: 1,
      base_fee_in_move: 0,
      move_rate: 0,
      fee_bps: 0,
    });

    expect(result.feeInfo.minFee).toBe(0);
    expect(result.feeInfo.totalFee).toBe(BigInt(0));
    expect(parseFloat(result.desiredAmount)).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// buildIntentArguments — generic error paths
// ---------------------------------------------------------------------------

describe('buildIntentArguments', () => {
  it('throws for unsupported connected chain', () => {
    const draft: DraftData = {
      intentId: DUMMY_INTENT_ID,
      offeredMetadata: '0x' + 'dd'.repeat(20),
      offeredAmount: '1000000',
      offeredChainId: '999',
      desiredMetadata: '0x' + 'aa'.repeat(32),
      desiredAmount: '1000000',
      desiredChainId: '100',
      expiryTime: Math.floor(Date.now() / 1000) + INTENT_EXPIRY_SECS,
      feeInOfferedToken: '100',
    };

    const sig: DraftIntentSignature = {
      signature: '0x' + 'ff'.repeat(64),
      solver_hub_addr: '0x' + '11'.repeat(32),
      timestamp: Date.now(),
    };

    expect(() =>
      buildIntentArguments({
        configs: TEST_CHAINS,
        draftData: draft,
        signature: sig,
        flowType: 'inflow',
        requesterAddr: '0x' + '22'.repeat(32),
      }),
    ).toThrow('Unsupported connected chain');
  });
});

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe('intent constants', () => {
  it('BPS_DENOMINATOR is 10000', () => {
    expect(BPS_DENOMINATOR).toBe(BigInt(10000));
  });

  it('BPS_ROUNDING_OFFSET is 9999', () => {
    expect(BPS_ROUNDING_OFFSET).toBe(BigInt(9999));
  });

  it('INTENT_EXPIRY_SECS is 180', () => {
    expect(INTENT_EXPIRY_SECS).toBe(180);
  });
});
