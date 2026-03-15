// ============================================================================
// Chain Configuration Types & Helpers
// ============================================================================

export interface ChainConfig {
  id: string; // Chain identifier
  chainId: number; // Network chain ID
  rpcUrl: string; // RPC endpoint URL
  name: string; // Display name
  chainType: 'mvm' | 'evm' | 'svm'; // VM type for chain-specific logic
  isHub?: boolean; // True when this chain is the hub
  intentContractAddress?: string; // Intent contract address (for Movement hub chain)
  escrowContractAddress?: string; // Escrow contract address (for EVM chains)
  outflowValidatorAddress?: string; // Outflow validator contract address (for EVM chains)
  mvmEscrowModuleAddress?: string; // Escrow module address (for MVM connected chains)
  svmProgramId?: string; // Escrow program ID (for SVM chains)
  svmOutflowProgramId?: string; // Outflow validator program ID (for SVM chains)
  svmGmpEndpointId?: string; // GMP endpoint program ID (for SVM chains)
}

// ============================================================================
// Chain Helpers
// ============================================================================

/**
 * Get chain config by ID key.
 */
export function getChainConfig(
  configs: Record<string, ChainConfig>,
  chainId: string,
): ChainConfig | undefined {
  return configs[chainId];
}

/**
 * Get the VM type for a chain.
 */
export function getChainType(
  configs: Record<string, ChainConfig>,
  chainId: string,
): ChainConfig['chainType'] | undefined {
  return configs[chainId]?.chainType;
}

/**
 * Check if a chain is the hub chain.
 */
export function isHubChain(
  configs: Record<string, ChainConfig>,
  chainId: string,
): boolean {
  return !!configs[chainId]?.isHub;
}

/**
 * Get the hub chain config.
 */
export function getHubChainConfig(
  configs: Record<string, ChainConfig>,
): ChainConfig {
  const entry = Object.values(configs).find((config) => config.isHub);
  if (!entry) {
    throw new Error('Hub chain not configured');
  }
  return entry;
}

/**
 * Get the configured RPC URL for a chain.
 */
export function getRpcUrl(
  configs: Record<string, ChainConfig>,
  chainId: string,
): string {
  const config = configs[chainId];
  if (!config) {
    throw new Error(`Chain not configured: ${chainId}`);
  }
  return config.rpcUrl;
}

/**
 * Get the Movement intent module address.
 */
export function getIntentContractAddress(
  configs: Record<string, ChainConfig>,
): string {
  const hubConfig = getHubChainConfig(configs);
  if (!hubConfig.intentContractAddress) {
    throw new Error('Intent contract address not configured for hub chain');
  }
  return hubConfig.intentContractAddress;
}

/**
 * Get the EVM escrow contract address for a chain.
 */
export function getEscrowContractAddress(
  configs: Record<string, ChainConfig>,
  chainId: string,
): string {
  const chainConfig = configs[chainId];
  if (!chainConfig?.escrowContractAddress) {
    throw new Error(`Escrow contract address not configured for chain: ${chainId}`);
  }
  return chainConfig.escrowContractAddress;
}

/**
 * Get the EVM outflow validator contract address for a chain.
 */
export function getOutflowValidatorAddress(
  configs: Record<string, ChainConfig>,
  chainId: string,
): string {
  const chainConfig = configs[chainId];
  if (!chainConfig?.outflowValidatorAddress) {
    throw new Error(`Outflow validator address not configured for chain: ${chainId}`);
  }
  return chainConfig.outflowValidatorAddress;
}

/**
 * Get the MVM escrow module address for an MVM connected chain.
 */
export function getMvmEscrowModuleAddress(
  configs: Record<string, ChainConfig>,
  chainId: string,
): string {
  const chainConfig = configs[chainId];
  if (!chainConfig?.mvmEscrowModuleAddress) {
    throw new Error(`MVM escrow module address not configured for chain: ${chainId}`);
  }
  return chainConfig.mvmEscrowModuleAddress;
}

/**
 * Get the SVM outflow validator program ID for a Solana chain.
 */
export function getSvmOutflowProgramId(
  configs: Record<string, ChainConfig>,
  chainId: string,
): string {
  const chainConfig = configs[chainId];
  if (!chainConfig?.svmOutflowProgramId) {
    throw new Error(`SVM outflow program ID not configured for chain: ${chainId}`);
  }
  return chainConfig.svmOutflowProgramId;
}

/**
 * Get the SVM escrow program ID for a Solana chain.
 */
export function getSvmProgramId(
  configs: Record<string, ChainConfig>,
  chainId: string,
): string {
  const chainConfig = configs[chainId];
  if (!chainConfig?.svmProgramId) {
    throw new Error(`SVM program ID not configured for chain: ${chainId}`);
  }
  return chainConfig.svmProgramId;
}

/**
 * Get the SVM GMP endpoint program ID for a Solana chain.
 */
export function getSvmGmpEndpointId(
  configs: Record<string, ChainConfig>,
  chainId: string,
): string {
  const chainConfig = configs[chainId];
  if (!chainConfig?.svmGmpEndpointId) {
    throw new Error(`SVM GMP endpoint ID not configured for chain: ${chainId}`);
  }
  return chainConfig.svmGmpEndpointId;
}

// ============================================================================
// Token Configuration Types & Helpers
// ============================================================================

export interface TokenConfig {
  symbol: string;
  name: string;
  metadata: string; // Metadata address (FA metadata for Movement, contract address for EVM)
  decimals: number;
  chain: string;
  coinType?: string; // Optional: Move coin type for tokens that may exist in CoinStore
}

/**
 * Get supported tokens for a given chain.
 */
export function getTokensByChain(
  tokens: TokenConfig[],
  chain: string,
): TokenConfig[] {
  return tokens.filter(token => token.chain === chain);
}

/**
 * Convert a human-readable amount to smallest units.
 */
export function toSmallestUnits(amount: number, decimals: number): number {
  return Math.floor(amount * Math.pow(10, decimals));
}

/**
 * Convert smallest units to a human-readable amount.
 */
export function fromSmallestUnits(amount: number, decimals: number): number {
  return amount / Math.pow(10, decimals);
}
