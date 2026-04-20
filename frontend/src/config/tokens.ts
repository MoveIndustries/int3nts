import type { TokenConfig } from '@int3nts/sdk';
import { TESTNET_TOKENS } from './tokens-testnet';
import { MAINNET_TOKENS } from './tokens-mainnet';
import { CHAIN_CONFIGS } from './chains';

// Only include tokens whose chain is actually configured (has an rpcUrl).
// This mirrors the filter in chains.ts: mainnet deploys drop testnet tokens
// when NEXT_PUBLIC_*_TESTNET_* vars aren't set, and vice versa.
const allTokens: TokenConfig[] = [
  ...TESTNET_TOKENS,
  ...MAINNET_TOKENS,
];

export const SUPPORTED_TOKENS: TokenConfig[] = allTokens.filter(
  (t) => CHAIN_CONFIGS[t.chain] !== undefined,
);
