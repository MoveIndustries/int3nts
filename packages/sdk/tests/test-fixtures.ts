/**
 * Shared test fixtures for SDK config tests.
 * Explicit configs — no process.env.
 */

import { ChainConfig, TokenConfig } from '../src/config.js';

export const TEST_CHAINS: Record<string, ChainConfig> = {
  'movement': {
    id: 'movement',
    chainId: 250,
    rpcUrl: 'https://testnet.movementnetwork.xyz/v1',
    name: 'Movement Bardock Testnet',
    chainType: 'mvm',
    isHub: true,
    intentContractAddress: '0x' + 'aa'.repeat(32),
  },
  'svm-devnet': {
    id: 'svm-devnet',
    chainId: 901,
    rpcUrl: 'https://api.devnet.solana.com',
    name: 'Solana Devnet',
    chainType: 'svm',
    svmProgramId: '11111111111111111111111111111111',
  },
  'base-sepolia': {
    id: 'base-sepolia',
    chainId: 84532,
    rpcUrl: 'https://base-sepolia-rpc.example.com',
    name: 'Base Sepolia',
    chainType: 'evm',
    escrowContractAddress: '0x' + 'bb'.repeat(20),
  },
};

export const TEST_TOKENS: TokenConfig[] = [
  { symbol: 'SOL', name: 'SOL (Devnet)', metadata: 'SOL', decimals: 9, chain: 'svm-devnet' },
  { symbol: 'USDC', name: 'USDC (Devnet)', metadata: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU', decimals: 6, chain: 'svm-devnet' },
  { symbol: 'USDC', name: 'USDC (Base)', metadata: '0x036CbD53842c5426634e7929541eC2318f3dCF7e', decimals: 6, chain: 'base-sepolia' },
];
