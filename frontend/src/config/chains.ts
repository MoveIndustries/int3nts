// Chain configurations for supported networks

export interface ChainConfig {
  id: string; // Chain identifier
  chainId: number; // Network chain ID
  rpcUrl: string; // RPC endpoint URL
  name: string; // Display name
  intentContractAddress?: string; // Intent contract address (for Movement hub chain)
  escrowContractAddress?: string; // Escrow contract address (for EVM chains)
}

// Chain configurations
export const CHAIN_CONFIGS: Record<string, ChainConfig> = {
  'movement': {
    id: 'movement',
    chainId: 250,
    rpcUrl: 'https://testnet.movementnetwork.xyz/v1',
    name: 'Movement Bardock Testnet',
    intentContractAddress: '0x8f8826082111c27daaa92724c855fb68a1d98ad979386f4ef421b1ccfed8ad47',
  },
  'base-sepolia': {
    id: 'base-sepolia',
    chainId: 84532,
    rpcUrl: 'https://base-sepolia-rpc.publicnode.com',
    name: 'Base Sepolia',
    escrowContractAddress: '0xEE27186DB79179969156A959FEA61a7B778C8183',
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

// Helper to get intent contract address for Movement hub chain
export function getIntentContractAddress(): string {
  const movementConfig = CHAIN_CONFIGS['movement'];
  if (!movementConfig?.intentContractAddress) {
    throw new Error('Intent contract address not configured for Movement chain');
  }
  return movementConfig.intentContractAddress;
}

// Helper to get escrow contract address for an EVM chain
export function getEscrowContractAddress(chainId: string): string {
  const chainConfig = CHAIN_CONFIGS[chainId];
  if (!chainConfig?.escrowContractAddress) {
    throw new Error(`Escrow contract address not configured for chain: ${chainId}`);
  }
  return chainConfig.escrowContractAddress;
}

