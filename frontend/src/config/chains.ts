// Chain configurations for supported networks

export interface ChainConfig {
  id: string; // Chain identifier
  chainId: number; // Network chain ID
  rpcUrl: string; // RPC endpoint URL
  name: string; // Display name
}

// Chain configurations
export const CHAIN_CONFIGS: Record<string, ChainConfig> = {
  'movement': {
    id: 'movement',
    chainId: 250,
    rpcUrl: 'https://testnet.movementnetwork.xyz/v1',
    name: 'Movement Bardock Testnet',
  },
  'base-sepolia': {
    id: 'base-sepolia',
    chainId: 84532,
    rpcUrl: 'https://base-sepolia-rpc.publicnode.com',
    name: 'Base Sepolia',
  },
  'ethereum-sepolia': {
    id: 'ethereum-sepolia',
    chainId: 11155111,
    rpcUrl: 'https://ethereum-sepolia-rpc.publicnode.com',
    name: 'Ethereum Sepolia',
  },
};

// Helper to get chain config by ID
export function getChainConfig(chainId: string): ChainConfig | undefined {
  return CHAIN_CONFIGS[chainId];
}

// Helper to get RPC URL for a chain
export function getRpcUrl(chainId: string): string {
  return CHAIN_CONFIGS[chainId]?.rpcUrl || '';
}

