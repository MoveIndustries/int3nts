import type { ChainConfig } from '@int3nts/sdk';

export const CHAIN_CONFIGS: Record<string, ChainConfig> = {
  'movement': {
    id: 'movement',
    chainId: 250,
    rpcUrl: 'https://testnet.movementnetwork.xyz/v1',
    name: 'Movement Bardock Testnet',
    chainType: 'mvm',
    isHub: true,
    intentContractAddress: process.env.NEXT_PUBLIC_INTENT_CONTRACT_ADDRESS,
  },
  'svm-devnet': {
    id: 'svm-devnet',
    chainId: 901,
    rpcUrl: process.env.NEXT_PUBLIC_SVM_RPC_URL || 'https://api.devnet.solana.com',
    name: 'Solana Devnet',
    chainType: 'svm',
    svmProgramId: process.env.NEXT_PUBLIC_SVM_PROGRAM_ID,
    svmOutflowProgramId: process.env.NEXT_PUBLIC_SVM_OUTFLOW_PROGRAM_ID,
    svmGmpEndpointId: process.env.NEXT_PUBLIC_SVM_GMP_ENDPOINT_ID,
  },
  'base-sepolia': {
    id: 'base-sepolia',
    chainId: 84532,
    rpcUrl: process.env.NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL!,
    name: 'Base Sepolia',
    chainType: 'evm',
    escrowContractAddress: process.env.NEXT_PUBLIC_BASE_ESCROW_CONTRACT_ADDRESS,
    outflowValidatorAddress: process.env.NEXT_PUBLIC_BASE_OUTFLOW_VALIDATOR_ADDRESS,
  },
  'ethereum-sepolia': {
    id: 'ethereum-sepolia',
    chainId: 11155111,
    rpcUrl: 'https://ethereum-sepolia-rpc.publicnode.com',
    name: 'Ethereum Sepolia',
    chainType: 'evm',
  },
};
