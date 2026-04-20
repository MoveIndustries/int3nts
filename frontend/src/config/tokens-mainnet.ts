import type { TokenConfig } from '@int3nts/sdk';

export const MAINNET_TOKENS: TokenConfig[] = [
  // Movement Mainnet
  {
    symbol: 'MOVE',
    name: 'MOVE (Movement)',
    metadata: '0x1',
    decimals: 8,
    chain: 'movement-mainnet',
  },
  {
    symbol: 'USDC.e',
    name: 'USDC.e (Movement)',
    metadata: '0x83121c9f9b0527d1f056e21a950d6bf3b9e9e2e8353d0e95ccea726713cbea39',
    decimals: 6,
    chain: 'movement-mainnet',
  },
  {
    symbol: 'USDCx',
    name: 'USDCx (Movement)',
    metadata: '0xba11833544a2f99eec743f41a228ca6ffa7f13c3b6b04681d5a79a8b75ff225e',
    decimals: 6,
    chain: 'movement-mainnet',
  },
  // Base Mainnet
  {
    symbol: 'ETH',
    name: 'ETH (Base)',
    metadata: '0x0000000000000000000000000000000000000000',
    decimals: 18,
    chain: 'base-mainnet',
  },
  {
    symbol: 'USDC',
    name: 'USDC (Base)',
    metadata: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    decimals: 6,
    chain: 'base-mainnet',
  },
  // HyperEVM Mainnet
  {
    symbol: 'HYPE',
    name: 'HYPE (HyperEVM)',
    metadata: '0x0000000000000000000000000000000000000000',
    decimals: 18,
    chain: 'hyperliquid',
  },
  {
    symbol: 'USDC',
    name: 'USDC (HyperEVM)',
    metadata: '0xb88339CB7199b77E23DB6E890353E22632Ba630f',
    decimals: 6,
    chain: 'hyperliquid',
  },
];
