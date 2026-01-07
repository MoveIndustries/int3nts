// Supported tokens configuration
// Metadata addresses and decimals for testnet tokens

export interface TokenConfig {
  symbol: string;
  name: string;
  metadata: string; // Metadata address
  decimals: number;
  chain: 'movement' | 'base-sepolia' | 'ethereum-sepolia';
}

export const SUPPORTED_TOKENS: TokenConfig[] = [
  // Movement Bardock Testnet
  {
    symbol: 'MOVE',
    name: 'MOVE (Native)',
    // Note: Native token metadata address - may need to be updated based on actual protocol requirements
    metadata: '0x1', // Placeholder for native token - verify with protocol docs
    decimals: 8,
    chain: 'movement',
  },
  {
    symbol: 'USDC.e',
    name: 'USDC.e (Movement)',
    metadata: '0xb89077cfd2a82a0c1450534d49cfd5f2707643155273069bc23a912bcfefdee7',
    decimals: 6,
    chain: 'movement',
  },
  // Base Sepolia
  {
    symbol: 'USDC',
    name: 'USDC (Base Sepolia)',
    metadata: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
    decimals: 6,
    chain: 'base-sepolia',
  },
  {
    symbol: 'ETH',
    name: 'ETH (Base Sepolia)',
    metadata: '0x0000000000000000000000000000000000000000', // Native token placeholder
    decimals: 18,
    chain: 'base-sepolia',
  },
  // Ethereum Sepolia
  {
    symbol: 'USDC',
    name: 'USDC (Ethereum Sepolia)',
    metadata: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
    decimals: 6,
    chain: 'ethereum-sepolia',
  },
  {
    symbol: 'ETH',
    name: 'ETH (Ethereum Sepolia)',
    metadata: '0x0000000000000000000000000000000000000000', // Native token placeholder
    decimals: 18,
    chain: 'ethereum-sepolia',
  },
];

// Helper to get tokens by chain
export function getTokensByChain(chain: 'movement' | 'base-sepolia' | 'ethereum-sepolia'): TokenConfig[] {
  return SUPPORTED_TOKENS.filter(token => token.chain === chain);
}

// Helper to convert main value to smallest units
export function toSmallestUnits(amount: number, decimals: number): number {
  return Math.floor(amount * Math.pow(10, decimals));
}

// Helper to convert smallest units to main value
export function fromSmallestUnits(amount: number, decimals: number): number {
  return amount / Math.pow(10, decimals);
}

