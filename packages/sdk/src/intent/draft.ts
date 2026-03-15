import type { ChainConfig, TokenConfig } from '../config.js';
import { toSmallestUnits } from '../config.js';
import type { CoordinatorClient } from '../coordinator.js';
import type { DraftIntentRequest } from '../types.js';
import { generateIntentId } from '../types.js';
import { INTENT_EXPIRY_SECS } from './constants.js';
import type { DraftData, FeeInfo, FlowType } from './types.js';

/**
 * Look up the chain key (e.g. "base-sepolia") from a numeric chain ID string.
 * Returns null if no matching chain is configured.
 */
export function getChainKeyFromId(
  configs: Record<string, ChainConfig>,
  chainIdValue: string,
): string | null {
  const entry = Object.entries(configs).find(
    ([, config]) => String(config.chainId) === chainIdValue,
  );
  return entry ? entry[0] : null;
}

/**
 * Create a draft intent via the coordinator.
 *
 * Generates a random intent ID, computes smallest-unit amounts,
 * builds the DraftIntentRequest, and posts it to the coordinator.
 * Returns the draft ID and saved draft data on success.
 */
export async function createDraft(opts: {
  coordinator: CoordinatorClient;
  requesterAddr: string;
  offeredToken: TokenConfig;
  offeredAmount: number;
  offeredChainId: number;
  desiredToken: TokenConfig;
  desiredAmount: string;
  desiredChainId: number;
  flowType: FlowType;
  feeInfo: FeeInfo | null;
}): Promise<{ draftId: string; draftData: DraftData }> {
  const {
    coordinator,
    requesterAddr,
    offeredToken,
    offeredAmount,
    offeredChainId,
    desiredToken,
    desiredAmount,
    desiredChainId,
    flowType,
    feeInfo,
  } = opts;

  const intentId = generateIntentId();
  const expiryTime = Math.floor(Date.now() / 1000) + INTENT_EXPIRY_SECS;

  const offeredAmountSmallest = toSmallestUnits(offeredAmount, offeredToken.decimals);
  const desiredAmountSmallest = Math.floor(
    parseFloat(desiredAmount) * Math.pow(10, desiredToken.decimals),
  );

  const feeInOfferedToken = feeInfo ? feeInfo.totalFee.toString() : '0';

  const request: DraftIntentRequest = {
    requester_addr: requesterAddr,
    draft_data: {
      intent_id: intentId,
      offered_metadata: offeredToken.metadata,
      offered_amount: offeredAmountSmallest.toString(),
      offered_chain_id: offeredChainId.toString(),
      desired_metadata: desiredToken.metadata,
      desired_amount: desiredAmountSmallest.toString(),
      desired_chain_id: desiredChainId.toString(),
      expiry_time: expiryTime,
      issuer: requesterAddr,
      fee_in_offered_token: feeInOfferedToken,
      flow_type: flowType,
    },
    expiry_time: expiryTime,
  };

  const response = await coordinator.createDraftIntent(request);

  if (!response.success || !response.data) {
    throw new Error(response.error || 'Failed to create draft intent');
  }

  const draftData: DraftData = {
    intentId,
    offeredMetadata: offeredToken.metadata,
    offeredAmount: offeredAmountSmallest.toString(),
    offeredChainId: offeredChainId.toString(),
    desiredMetadata: desiredToken.metadata,
    desiredAmount: desiredAmountSmallest.toString(),
    desiredChainId: desiredChainId.toString(),
    expiryTime,
    feeInOfferedToken,
  };

  return { draftId: response.data.draft_id, draftData };
}
