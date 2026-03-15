import type { DraftIntentSignature } from '../types.js';
import type { ChainConfig, TokenConfig } from '../config.js';
import type { CoordinatorClient } from '../coordinator.js';

export type FlowType = 'inflow' | 'outflow';

export type IntentStatus =
  | 'pending'
  | 'requested'
  | 'signature_received'
  | 'created'
  | 'fulfilled'
  | 'error';

export interface FeeInfo {
  minFee: number;
  feeBps: number;
  totalFee: bigint;
}

export interface FeeCalculationResult {
  feeInfo: FeeInfo;
  desiredAmount: string;
}

export interface DraftData {
  intentId: string;
  offeredMetadata: string;
  offeredAmount: string;
  offeredChainId: string;
  desiredMetadata: string;
  desiredAmount: string;
  desiredChainId: string;
  expiryTime: number;
  feeInOfferedToken: string;
}

export interface IntentArguments {
  functionName: string;
  functionArguments: unknown[];
}

export type IntentFlowEvent =
  | { type: 'draft_created'; draftId: string; draftData: DraftData }
  | { type: 'signature_received'; signature: DraftIntentSignature }
  | { type: 'fulfilled' }
  | { type: 'error'; error: string };

export interface IntentFlowConfig {
  coordinator: CoordinatorClient;
  chainConfigs: Record<string, ChainConfig>;
}
