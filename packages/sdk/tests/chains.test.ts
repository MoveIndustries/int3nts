import { describe, expect, it } from 'vitest';
import {
  getChainConfig,
  getChainType,
  getEscrowContractAddress,
  getHubChainConfig,
  getSvmProgramId,
  isHubChain,
} from '../src/config.js';
import { TEST_CHAINS } from './test-fixtures.js';

describe('getChainConfig', () => {
  // 1. Test: SVM chain config lookup
  // Verifies that getChainConfig returns a config with rpcUrl, svmProgramId, and the SVM chain type for an SVM chain key.
  // Why: UI and helpers depend on RPC + program ID being present.
  it('should return config for svm-connected', () => {
    const config = getChainConfig(TEST_CHAINS, 'svm-connected');
    expect(config?.rpcUrl).toBeTruthy();
    expect(config?.svmProgramId).toBeTruthy();
    expect(config?.chainType).toBe('svm');
  });
});

describe('hub chain helpers', () => {
  // 2. Test: Hub chain identification
  // Verifies that getHubChainConfig returns the hub entry and isHubChain returns true for that id.
  // Why: Hub-specific logic should not depend on chain key strings.
  it('should return the configured hub chain', () => {
    const hub = getHubChainConfig(TEST_CHAINS);
    expect(isHubChain(TEST_CHAINS, hub.id)).toBe(true);
    expect(hub.chainType).toBe('mvm');
  });
});

describe('getChainType', () => {
  // 3. Test: Chain type lookup
  // Verifies that getChainType returns the EVM chain type for an EVM chain key.
  // Why: VM-specific logic should be driven by config.
  it('should return evm for evm-connected', () => {
    expect(getChainType(TEST_CHAINS, 'evm-connected')).toBe('evm');
  });
});

describe('getEscrowContractAddress', () => {
  // 4. Test: EVM escrow address format
  // Verifies that getEscrowContractAddress returns a 20-byte 0x-prefixed hex string for an EVM chain.
  // Why: EVM writes require a valid 20-byte hex address.
  it('should return EVM escrow address for evm-connected', () => {
    const address = getEscrowContractAddress(TEST_CHAINS, 'evm-connected');
    expect(address).toMatch(/^0x[a-fA-F0-9]{40}$/);
  });


  // 5. Test: Missing EVM escrow address
  // Verifies that getEscrowContractAddress throws when called with a chain that has no escrow address configured.
  // Why: Misconfigured chains must fail fast with clear errors.
  it('should throw if escrow address is missing', () => {
    expect(() => getEscrowContractAddress(TEST_CHAINS, 'mvm-hub')).toThrow(
      'Escrow contract address not configured for chain: mvm-hub'
    );
  });
});

describe('getSvmProgramId', () => {
  // 6. Test: SVM program ID lookup
  // Verifies that getSvmProgramId returns a base58 program ID (32–44 chars) for an SVM chain.
  // Why: SVM escrow instructions need a valid program ID.
  it('should return SVM program ID for svm-connected', () => {
    const programId = getSvmProgramId(TEST_CHAINS, 'svm-connected');
    expect(programId).toMatch(/^[A-Za-z0-9]{32,44}$/);
  });


  // 7. Test: Missing SVM program ID
  // Verifies that getSvmProgramId throws when called with a chain that has no program ID configured.
  // Why: Misconfigured chains must fail fast with clear errors.
  it('should throw if SVM program ID is missing', () => {
    expect(() => getSvmProgramId(TEST_CHAINS, 'mvm-hub')).toThrow(
      'SVM program ID not configured for chain: mvm-hub'
    );
  });
});
