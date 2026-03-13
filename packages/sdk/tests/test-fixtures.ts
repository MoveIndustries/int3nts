/**
 * Shared test fixtures for SDK config tests.
 * Explicit configs — no process.env.
 */

import { ChainConfig, TokenConfig } from '../src/config.js';

export const TEST_CHAINS: Record<string, ChainConfig> = {
  'mvm-hub': {
    id: 'mvm-hub',
    chainId: 100,
    rpcUrl: 'https://rpc.mvm-hub.test',
    name: 'MVM Hub (Test)',
    chainType: 'mvm',
    isHub: true,
    intentContractAddress: '0x' + 'aa'.repeat(32),
  },
  'svm-connected': {
    id: 'svm-connected',
    chainId: 200,
    rpcUrl: 'https://rpc.svm-connected.test',
    name: 'SVM Connected (Test)',
    chainType: 'svm',
    svmProgramId: '11111111111111111111111111111111',
    svmOutflowProgramId: '22222222222222222222222222222222',
  },
  'evm-connected': {
    id: 'evm-connected',
    chainId: 300,
    rpcUrl: 'https://rpc.evm-connected.test',
    name: 'EVM Connected (Test)',
    chainType: 'evm',
    escrowContractAddress: '0x' + 'bb'.repeat(20),
    outflowValidatorAddress: '0x' + 'cc'.repeat(20),
  },
};

export const TEST_TOKENS: TokenConfig[] = [
  { symbol: 'TK1', name: 'Token 1 (SVM)', metadata: '0x' + 'dd'.repeat(32), decimals: 9, chain: 'svm-connected' },
  { symbol: 'TK2', name: 'Token 2 (SVM)', metadata: '0x' + 'ee'.repeat(32), decimals: 6, chain: 'svm-connected' },
  { symbol: 'TK3', name: 'Token 3 (EVM)', metadata: '0x' + 'ff'.repeat(20), decimals: 6, chain: 'evm-connected' },
];
