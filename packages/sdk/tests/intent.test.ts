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
  // 1. Test: Resolve numeric chain ID to config key
  // Verifies that getChainKeyFromId returns the matching chain key for a numeric chain ID.
  // Why: Intent flows take a numeric chain ID from the user; the SDK must map it to the config key used everywhere else.
  it('resolves numeric chain ID to config key', () => {
    expect(getChainKeyFromId(TEST_CHAINS, '100')).toBe('mvm-hub');
  });

  // 2. Test: Unknown chain ID returns null
  // Verifies that getChainKeyFromId returns null for a chain ID that does not exist in the config.
  // Why: Callers rely on null (not a default) to detect bad input and fail loud.
  it('returns null for unknown chain ID', () => {
    expect(getChainKeyFromId(TEST_CHAINS, '999')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// calculateFee
// ---------------------------------------------------------------------------

describe('calculateFee', () => {
  // 3. Test: Fee calculation with base fee and bps
  // Verifies that calculateFee sums the MOVE base fee and the bps fee (with ceiling rounding) into totalFee, and returns a positive desiredAmount string.
  // Why: Mispricing the fee either overcharges the requester or undercharges the solver — both must be caught.
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

  // 4. Test: Zero desired amount when fee exceeds offered
  // Verifies that calculateFee returns a zero desiredAmount when the computed fee exceeds the offered amount.
  // Why: A negative desired amount would indicate an un-payable intent; the SDK must clamp to zero so the UI can disable submission.
  it('returns zero desired amount when fee exceeds offered', () => {
    const result = calculateFee(0.000001, DUMMY_TOKEN_A, DUMMY_TOKEN_B, {
      exchange_rate: 1,
      base_fee_in_move: 100,
      move_rate: 1,
      fee_bps: 0,
    });

    expect(result.desiredAmount).toBe('0');
  });

  // 5. Test: Zero fees produce zero totalFee and positive desiredAmount
  // Verifies that when base_fee_in_move, move_rate, and fee_bps are all zero, totalFee is 0 and desiredAmount is positive.
  // Why: Free-of-fee paths (promotions, internal flows) must not crash or produce bogus amounts.
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
  // 6. Test: Unsupported connected chain throws
  // Verifies that buildIntentArguments throws with an unsupported-chain error when offeredChainId has no matching config.
  // Why: Failing fast on unsupported chains prevents malformed intents from reaching the contracts.
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
  // 7. Test: BPS_DENOMINATOR is 10000
  // Verifies that BPS_DENOMINATOR is exported as a BigInt matching the on-chain bps denominator.
  // Why: The on-chain contracts use 10000 as the bps denominator; a drift here would silently scale every fee by the wrong factor.
  it('BPS_DENOMINATOR is 10000', () => {
    expect(BPS_DENOMINATOR).toBe(BigInt(10000));
  });

  // 8. Test: BPS_ROUNDING_OFFSET is 9999
  // Verifies that BPS_ROUNDING_OFFSET is exported as a BigInt equal to BPS_DENOMINATOR minus one, as required for ceiling rounding.
  // Why: Ceiling-rounding requires adding (denominator - 1); a wrong offset changes the rounding direction.
  it('BPS_ROUNDING_OFFSET is 9999', () => {
    expect(BPS_ROUNDING_OFFSET).toBe(BigInt(9999));
  });

  // 9. Test: INTENT_EXPIRY_SECS is 180
  // Verifies that INTENT_EXPIRY_SECS is exported with the default intent expiry window in seconds.
  // Why: Default expiry must match the coordinator/contract expectations; drift would cause drafts to expire too soon or too late.
  it('INTENT_EXPIRY_SECS is 180', () => {
    expect(INTENT_EXPIRY_SECS).toBe(180);
  });
});
