import type { ChainConfig } from '@int3nts/sdk';
import { TESTNET_CHAINS } from './chains-testnet';
import { MAINNET_CHAINS } from './chains-mainnet';

// Only include chains that have an RPC URL configured.
// This allows mainnet deploys to omit testnet vars and vice versa.
const allChains: Record<string, ChainConfig> = {
  ...TESTNET_CHAINS,
  ...MAINNET_CHAINS,
};

export const CHAIN_CONFIGS: Record<string, ChainConfig> = Object.fromEntries(
  Object.entries(allChains).filter(([, cfg]) => cfg.rpcUrl),
);
