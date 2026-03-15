import type { ChainConfig } from '../config.js';
import { getChainType, getIntentContractAddress, isHubChain } from '../config.js';
import type { DraftIntentSignature } from '../types.js';
import { hexToBytes, padEvmAddressToMove } from '../utils.js';
import { svmPubkeyToHex } from '../chains/svm.js';
import { getChainKeyFromId } from './draft.js';
import type { DraftData, FlowType, IntentArguments } from './types.js';

/**
 * Build the Move entry-function name and arguments for an on-chain intent.
 *
 * Four code paths based on flowType × connected-chain VM:
 *   inflow  + SVM  → fa_intent_inflow::create_inflow_intent_entry  (hex pubkeys)
 *   inflow  + EVM  → fa_intent_inflow::create_inflow_intent_entry  (padded EVM addrs)
 *   outflow + SVM  → fa_intent_outflow::create_outflow_intent_entry (hex pubkeys)
 *   outflow + EVM  → fa_intent_outflow::create_outflow_intent_entry (padded EVM addrs)
 */
export function buildIntentArguments(opts: {
  configs: Record<string, ChainConfig>;
  draftData: DraftData;
  signature: DraftIntentSignature;
  flowType: FlowType;
  requesterAddr: string;
  evmAddress?: string;
  svmPublicKey?: string;
}): IntentArguments {
  const { configs, draftData, signature, flowType, requesterAddr, evmAddress, svmPublicKey } = opts;

  const INTENT_MODULE_ADDR = getIntentContractAddress(configs);

  const signatureBytes = hexToBytes(signature.signature);
  const signatureArray = Array.from(signatureBytes);

  const offeredChainKey = getChainKeyFromId(configs, draftData.offeredChainId);
  const desiredChainKey = getChainKeyFromId(configs, draftData.desiredChainId);
  const connectedChainKey =
    offeredChainKey && isHubChain(configs, offeredChainKey) ? desiredChainKey : offeredChainKey;
  if (!connectedChainKey) {
    throw new Error('Unsupported connected chain for this draft');
  }

  const connectedChainType = getChainType(configs, connectedChainKey);

  if (flowType === 'inflow') {
    return buildInflowArguments({
      INTENT_MODULE_ADDR,
      draftData,
      signature,
      signatureArray,
      connectedChainType,
      evmAddress,
      svmPublicKey,
    });
  }

  return buildOutflowArguments({
    INTENT_MODULE_ADDR,
    draftData,
    signature,
    signatureArray,
    connectedChainType,
    evmAddress,
    svmPublicKey,
  });
}

function buildInflowArguments(opts: {
  INTENT_MODULE_ADDR: string;
  draftData: DraftData;
  signature: DraftIntentSignature;
  signatureArray: number[];
  connectedChainType: string | undefined;
  evmAddress?: string;
  svmPublicKey?: string;
}): IntentArguments {
  const { INTENT_MODULE_ADDR, draftData, signature, signatureArray, connectedChainType, evmAddress, svmPublicKey } = opts;
  const functionName = `${INTENT_MODULE_ADDR}::fa_intent_inflow::create_inflow_intent_entry`;

  if (connectedChainType === 'svm') {
    if (!svmPublicKey) {
      throw new Error('SVM wallet must be connected for inflow intents');
    }
    if (!signature.solver_svm_addr) {
      throw new Error('Solver has no SVM address registered');
    }
    const requesterAddrHex = svmPubkeyToHex(svmPublicKey);
    const offeredMetadataHex = svmPubkeyToHex(draftData.offeredMetadata);

    return {
      functionName,
      functionArguments: [
        offeredMetadataHex,
        draftData.offeredAmount,
        draftData.offeredChainId,
        draftData.desiredMetadata,
        draftData.desiredAmount,
        draftData.desiredChainId,
        draftData.expiryTime.toString(),
        draftData.intentId,
        signature.solver_hub_addr,
        signature.solver_svm_addr,
        signatureArray,
        requesterAddrHex,
        draftData.feeInOfferedToken,
      ],
    };
  }

  // EVM inflow
  const evmAddr = evmAddress || '0x' + '0'.repeat(40);
  const paddedRequesterAddr = padEvmAddressToMove(evmAddr);
  const paddedOfferedMetadata = padEvmAddressToMove(draftData.offeredMetadata);

  if (!signature.solver_evm_addr) {
    throw new Error('Solver has no EVM address registered');
  }
  const paddedSolverAddr = padEvmAddressToMove(signature.solver_evm_addr);

  return {
    functionName,
    functionArguments: [
      paddedOfferedMetadata,
      draftData.offeredAmount,
      draftData.offeredChainId,
      draftData.desiredMetadata,
      draftData.desiredAmount,
      draftData.desiredChainId,
      draftData.expiryTime.toString(),
      draftData.intentId,
      signature.solver_hub_addr,
      paddedSolverAddr,
      signatureArray,
      paddedRequesterAddr,
      draftData.feeInOfferedToken,
    ],
  };
}

function buildOutflowArguments(opts: {
  INTENT_MODULE_ADDR: string;
  draftData: DraftData;
  signature: DraftIntentSignature;
  signatureArray: number[];
  connectedChainType: string | undefined;
  evmAddress?: string;
  svmPublicKey?: string;
}): IntentArguments {
  const { INTENT_MODULE_ADDR, draftData, signature, signatureArray, connectedChainType, evmAddress, svmPublicKey } = opts;
  const functionName = `${INTENT_MODULE_ADDR}::fa_intent_outflow::create_outflow_intent_entry`;

  if (connectedChainType === 'svm') {
    if (!svmPublicKey) {
      throw new Error('SVM wallet must be connected for outflow intents');
    }
    if (!signature.solver_svm_addr) {
      throw new Error('Solver has no SVM address registered');
    }
    const requesterAddrHex = svmPubkeyToHex(svmPublicKey);
    const desiredMetadataHex = svmPubkeyToHex(draftData.desiredMetadata);

    return {
      functionName,
      functionArguments: [
        draftData.offeredMetadata,
        draftData.offeredAmount,
        draftData.offeredChainId,
        desiredMetadataHex,
        draftData.desiredAmount,
        draftData.desiredChainId,
        draftData.expiryTime.toString(),
        draftData.intentId,
        requesterAddrHex,
        signature.solver_hub_addr,
        signature.solver_svm_addr,
        signatureArray,
        draftData.feeInOfferedToken,
      ],
    };
  }

  // EVM outflow
  if (!evmAddress) {
    throw new Error('EVM wallet must be connected for outflow intents');
  }
  if (!signature.solver_evm_addr) {
    throw new Error('Solver has no EVM address registered');
  }
  const paddedRequesterAddr = padEvmAddressToMove(evmAddress);
  const paddedDesiredMetadata = padEvmAddressToMove(draftData.desiredMetadata);
  const paddedSolverAddr = padEvmAddressToMove(signature.solver_evm_addr);

  return {
    functionName,
    functionArguments: [
      draftData.offeredMetadata,
      draftData.offeredAmount,
      draftData.offeredChainId,
      paddedDesiredMetadata,
      draftData.desiredAmount,
      draftData.desiredChainId,
      draftData.expiryTime.toString(),
      draftData.intentId,
      paddedRequesterAddr,
      signature.solver_hub_addr,
      paddedSolverAddr,
      signatureArray,
      draftData.feeInOfferedToken,
    ],
  };
}
