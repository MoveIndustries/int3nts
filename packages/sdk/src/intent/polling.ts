import type { ChainConfig } from '../config.js';
import {
  getChainType,
  getHubChainConfig,
  getOutflowValidatorAddress,
  getSvmOutflowProgramId,
  getRpcUrl,
} from '../config.js';
import type { CoordinatorClient } from '../coordinator.js';
import type { DraftIntentSignature } from '../types.js';
import { checkIsFulfilled } from '../chains/evm.js';
import { checkIsFulfilledSvm } from '../chains/svm.js';
import { PublicKey } from '@solana/web3.js';
import {
  POLL_SIGNATURE_INTERVAL_MS,
  POLL_FULFILLMENT_INTERVAL_MS,
  POLL_FULFILLMENT_INITIAL_DELAY_MS,
  MAX_SIGNATURE_POLL_ATTEMPTS,
  MAX_FULFILLMENT_POLL_ATTEMPTS,
} from './constants.js';
import { getChainKeyFromId } from './draft.js';
import type { DraftData, FlowType } from './types.js';

/**
 * Poll the coordinator for a solver signature on a draft intent.
 *
 * Resolves with the signature once signed, or throws on timeout / not-found.
 */
export async function pollForSignature(
  coordinator: CoordinatorClient,
  draftId: string,
  opts?: { expiryTime?: number; signal?: AbortSignal },
): Promise<DraftIntentSignature> {
  const expiryTime = opts?.expiryTime;
  const signal = opts?.signal;
  let attempts = 0;

  return new Promise<DraftIntentSignature>((resolve, reject) => {
    const poll = async () => {
      if (signal?.aborted) {
        reject(new Error('Signature polling aborted'));
        return;
      }

      try {
        const response = await coordinator.pollDraftSignature(draftId);

        if (response.success && response.data) {
          resolve(response.data);
          return;
        }

        if (response.error?.includes('not found')) {
          reject(new Error('Draft not found'));
          return;
        }

        attempts++;
        const expired = expiryTime != null && Math.floor(Date.now() / 1000) >= expiryTime;
        if (attempts >= MAX_SIGNATURE_POLL_ATTEMPTS || expired) {
          reject(new Error('Signature polling timeout'));
          return;
        }

        setTimeout(poll, POLL_SIGNATURE_INTERVAL_MS);
      } catch (error) {
        attempts++;
        if (attempts >= MAX_SIGNATURE_POLL_ATTEMPTS) {
          reject(error instanceof Error ? error : new Error(String(error)));
          return;
        }
        setTimeout(poll, POLL_SIGNATURE_INTERVAL_MS);
      }
    };

    poll();
  });
}

/**
 * Poll for intent fulfillment on the appropriate chain.
 *
 * - Outflow: checks the connected chain's outflow validator directly.
 * - Inflow: queries the solver's recent hub transactions for a LimitOrderFulfillmentEvent.
 *
 * Resolves once fulfilled, or throws on timeout.
 */
export async function pollForFulfillment(opts: {
  configs: Record<string, ChainConfig>;
  draftData: DraftData;
  flowType: FlowType;
  intentId: string;
  solverHubAddr: string;
  signal?: AbortSignal;
}): Promise<void> {
  const { configs, draftData, flowType, intentId, solverHubAddr, signal } = opts;
  let attempts = 0;

  return new Promise<void>((resolve, reject) => {
    const poll = async () => {
      if (signal?.aborted) {
        reject(new Error('Fulfillment polling aborted'));
        return;
      }

      try {
        if (flowType === 'outflow') {
          const fulfilled = await checkOutflowFulfillment(configs, draftData, intentId);
          if (fulfilled) {
            resolve();
            return;
          }
        } else {
          const fulfilled = await checkInflowFulfillment(configs, intentId, solverHubAddr);
          if (fulfilled) {
            resolve();
            return;
          }
        }

        attempts++;
        if (attempts >= MAX_FULFILLMENT_POLL_ATTEMPTS) {
          reject(new Error('Fulfillment polling timeout'));
          return;
        }
        setTimeout(poll, POLL_FULFILLMENT_INTERVAL_MS);
      } catch (error) {
        attempts++;
        if (attempts >= MAX_FULFILLMENT_POLL_ATTEMPTS) {
          reject(error instanceof Error ? error : new Error(String(error)));
          return;
        }
        setTimeout(poll, POLL_FULFILLMENT_INTERVAL_MS);
      }
    };

    setTimeout(poll, POLL_FULFILLMENT_INITIAL_DELAY_MS);
  });
}

async function checkOutflowFulfillment(
  configs: Record<string, ChainConfig>,
  draftData: DraftData,
  intentId: string,
): Promise<boolean> {
  const desiredChainKey = getChainKeyFromId(configs, draftData.desiredChainId);
  if (!desiredChainKey) return false;

  const chainType = getChainType(configs, desiredChainKey);
  const rpcUrl = getRpcUrl(configs, desiredChainKey);

  if (chainType === 'svm') {
    const outflowProgramId = new PublicKey(getSvmOutflowProgramId(configs, desiredChainKey));
    return checkIsFulfilledSvm(rpcUrl, outflowProgramId, intentId);
  }

  if (chainType === 'evm') {
    const outflowAddr = getOutflowValidatorAddress(configs, desiredChainKey);
    return checkIsFulfilled(rpcUrl, outflowAddr, intentId);
  }

  return false;
}

async function checkInflowFulfillment(
  configs: Record<string, ChainConfig>,
  intentId: string,
  solverHubAddr: string,
): Promise<boolean> {
  const hubRpcUrl = getHubChainConfig(configs).rpcUrl;
  const solverAccount = solverHubAddr.startsWith('0x') ? solverHubAddr : `0x${solverHubAddr}`;
  const transactionsUrl = `${hubRpcUrl}/accounts/${solverAccount}/transactions?limit=10`;

  const txResponse = await fetch(transactionsUrl);
  const transactions = await txResponse.json();

  const normalizeId = (id: string) => {
    const stripped = id?.replace(/^0x/i, '').toLowerCase() || '';
    return stripped.replace(/^0+/, '') || '0';
  };

  if (!Array.isArray(transactions)) return false;

  for (const tx of transactions) {
    if (!tx.events || !Array.isArray(tx.events)) continue;
    for (const event of tx.events) {
      if (!event.type?.includes('LimitOrderFulfillmentEvent')) continue;
      const eventIntentId = event.data?.intent_id || event.data?.intent_addr;
      if (eventIntentId && normalizeId(eventIntentId) === normalizeId(intentId)) {
        return true;
      }
    }
  }

  return false;
}
