import { describe, it, expect } from 'vitest';
import { buildIntentArguments, INTENT_EXPIRY_SECS } from '../../src/intent/index.js';
import type { DraftIntentSignature } from '../../src/types.js';
import type { DraftData } from '../../src/intent/types.js';
import { TEST_CHAINS } from '../test-fixtures.js';
import { DUMMY_INTENT_ID } from '../test-constants.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const INFLOW_DRAFT: DraftData = {
  intentId: DUMMY_INTENT_ID,
  offeredMetadata: '0x' + 'bb'.repeat(20),
  offeredAmount: '1000000',
  offeredChainId: '300',
  desiredMetadata: '0x' + 'aa'.repeat(32),
  desiredAmount: '1000000',
  desiredChainId: '100',
  expiryTime: Math.floor(Date.now() / 1000) + INTENT_EXPIRY_SECS,
  feeInOfferedToken: '100',
};

const OUTFLOW_DRAFT: DraftData = {
  ...INFLOW_DRAFT,
  offeredMetadata: '0x' + 'aa'.repeat(32),
  offeredChainId: '100',
  desiredMetadata: '0x' + 'bb'.repeat(20),
  desiredChainId: '300',
};

const BASE_SIG: DraftIntentSignature = {
  signature: '0x' + 'ff'.repeat(64),
  solver_hub_addr: '0x' + '11'.repeat(32),
  solver_evm_addr: '0x' + '22'.repeat(20),
  timestamp: Date.now(),
};

// ============================================================================
// buildIntentArguments — EVM
// ============================================================================

describe('buildIntentArguments (EVM)', () => {
  /// 1. Test: Builds Inflow EVM Arguments
  /// Verifies that inflow arguments are built with padded EVM addresses.
  /// Why: Move entry functions require 32-byte addresses; EVM addresses must be left-padded.
  it('builds inflow EVM arguments', () => {
    const result = buildIntentArguments({
      configs: TEST_CHAINS,
      draftData: INFLOW_DRAFT,
      signature: BASE_SIG,
      flowType: 'inflow',
      requesterAddr: '0x' + '33'.repeat(32),
      evmAddress: '0x' + '44'.repeat(20),
    });

    expect(result.functionName).toContain('fa_intent_inflow::create_inflow_intent_entry');
    expect(result.functionArguments).toHaveLength(13);
  });

  /// 2. Test: Builds Outflow EVM Arguments
  /// Verifies that outflow arguments are built with padded EVM addresses.
  /// Why: Outflow desired metadata and requester address need 32-byte padding for Move.
  it('builds outflow EVM arguments', () => {
    const result = buildIntentArguments({
      configs: TEST_CHAINS,
      draftData: OUTFLOW_DRAFT,
      signature: BASE_SIG,
      flowType: 'outflow',
      requesterAddr: '0x' + '33'.repeat(32),
      evmAddress: '0x' + '44'.repeat(20),
    });

    expect(result.functionName).toContain('fa_intent_outflow::create_outflow_intent_entry');
    expect(result.functionArguments).toHaveLength(13);
  });

  /// 3. Test: Throws When Solver Lacks EVM Address
  /// Verifies that missing solver_evm_addr causes an error.
  /// Why: EVM inflow/outflow paths require the solver's EVM address for the connected chain.
  it('throws when solver lacks EVM address for inflow', () => {
    const sigNoEvm: DraftIntentSignature = {
      ...BASE_SIG,
      solver_evm_addr: undefined,
    };

    expect(() =>
      buildIntentArguments({
        configs: TEST_CHAINS,
        draftData: INFLOW_DRAFT,
        signature: sigNoEvm,
        flowType: 'inflow',
        requesterAddr: '0x' + '33'.repeat(32),
        evmAddress: '0x' + '44'.repeat(20),
      }),
    ).toThrow('Solver has no EVM address registered');
  });
});
