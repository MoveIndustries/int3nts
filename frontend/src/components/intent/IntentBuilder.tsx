'use client';

import { useState, useMemo, useEffect, useCallback } from 'react';
import { useAccount, useWriteContract, useWaitForTransactionReceipt, useChainId, useSwitchChain } from 'wagmi';
import { useWallet as useMvmWallet } from '@aptos-labs/wallet-adapter-react';
import { useWallet as useSvmWallet } from '@solana/wallet-adapter-react';
import {
  CoordinatorClient,
  type TokenConfig,
  type FeeInfo,
  type FlowType,
  fromSmallestUnits,
  getChainType,
  isHubChain,
  getHubChainConfig,
  checkHasRequirements,
  checkHasRequirementsMvm,
  checkHasRequirementsSvm,
  calculateFee,
  getChainKeyFromId,
} from '@int3nts/sdk';
import { CHAIN_CONFIGS } from '@/config/chains';
import { useNightlyAddress } from './useNightlyAddress';
import { useTokenBalances } from './useTokenBalances';
import { useIntentDraft } from './useIntentDraft';
import { useIntentHandlers, getOfferedTokenFromDraft } from './useIntentHandlers';
import { SUPPORTED_TOKENS } from '@/config/tokens';
import { PublicKey } from '@solana/web3.js';

const coordinatorClient = new CoordinatorClient(
  process.env.NEXT_PUBLIC_COORDINATOR_URL || 'http://localhost:8080'
);

// ============================================================================
// Frontend-Only Constants
// ============================================================================

/** Delay before starting requirement checks (ms). */
const POLL_REQUIREMENTS_INTERVAL_MS = 3000;

/**
 * Intent creation flow across hub and connected chains.
 */
export function IntentBuilder() {
  const { address: evmAddress } = useAccount();
  const chainId = useChainId();
  const { switchChain } = useSwitchChain();
  const { account: mvmAccount } = useMvmWallet();
  const svmWallet = useSvmWallet();
  const svmPublicKey = svmWallet.publicKey;
  const svmAddress = svmPublicKey?.toBase58() || '';
  const directNightlyAddress = useNightlyAddress();
  const requesterAddr = directNightlyAddress || mvmAccount?.address || '';
  const mvmAddress = directNightlyAddress || mvmAccount?.address || '';
  const [offeredToken, setOfferedToken] = useState<TokenConfig | null>(null);
  const [offeredAmount, setOfferedAmount] = useState('');
  const [desiredToken, setDesiredToken] = useState<TokenConfig | null>(null);
  
  // Compute flowType dynamically based on selected tokens
  // If offered token is on Movement (hub), it's outflow; otherwise it's inflow
  const flowType: FlowType | null = useMemo(() => {
    if (!offeredToken) return null;
    return isHubChain(CHAIN_CONFIGS, offeredToken.chain) ? 'outflow' : 'inflow';
  }, [offeredToken]);
  const hubChainId = getHubChainConfig(CHAIN_CONFIGS).chainId;
  const hubChainIdString = hubChainId.toString();

  const isHubChainId = (chainIdValue?: string | null) => chainIdValue === hubChainIdString;
  const isSvmChain = (chain: TokenConfig['chain']) => getChainType(CHAIN_CONFIGS, chain) === 'svm';
  const isEvmChain = (chain: TokenConfig['chain']) => getChainType(CHAIN_CONFIGS, chain) === 'evm';

  const getConnectedChain = (offered: TokenConfig, desired: TokenConfig) =>
    isHubChain(CHAIN_CONFIGS, offered.chain) ? desired.chain : offered.chain;

  const getAddressForChain = useCallback((chain: TokenConfig['chain']) => {
    if (isHubChain(CHAIN_CONFIGS, chain)) {
      return mvmAddress;
    }
    if (getChainType(CHAIN_CONFIGS, chain) === 'svm') {
      return svmAddress;
    }
    return evmAddress || '';
  }, [mvmAddress, svmAddress, evmAddress]);

  // Desired amount is auto-calculated based on solver's exchange rate
  const [desiredAmount, setDesiredAmount] = useState('');
  // Fee parameters from solver's exchange rate response
  const [feeInfo, setFeeInfo] = useState<FeeInfo | null>(null);
  const [loading, setLoading] = useState(false);

  // Transaction submission state
  const [submittingTransaction, setSubmittingTransaction] = useState(false);
  const [transactionHash, setTransactionHash] = useState<string | null>(null);

  const {
    draftId,
    setDraftId,
    setDraftCreatedAt,
    savedDraftData,
    setSavedDraftData,
    signature,
    setSignature,
    pollingSignature,
    setPollingSignature,
    pollingActiveRef,
    intentStatus,
    pollingFulfillment,
    timeRemaining,
    mounted,
    error,
    setError,
    clearDraft: clearDraftState,
  } = useIntentDraft({
    coordinator: coordinatorClient,
    flowType,
    transactionHash,
    mvmAddress,
  });
  
  // Escrow creation state (for inflow intents)
  const [escrowHash, setEscrowHash] = useState<string | null>(null);
  const [approvingToken, setApprovingToken] = useState(false);
  const [creatingEscrow, setCreatingEscrow] = useState(false);

  // GMP requirements delivery state (for EVM inflow intents)
  const [requirementsDelivered, setRequirementsDelivered] = useState(false);
  const [pollingRequirements, setPollingRequirements] = useState(false);
  
  // Wagmi hooks for escrow creation
  const { writeContract: writeApprove, data: approveHash, error: approveError, isPending: isApprovePending, reset: resetApprove } = useWriteContract();
  const { writeContract: writeCreateEscrow, data: createEscrowHash, error: escrowError, isPending: isEscrowPending, reset: resetEscrow } = useWriteContract();

  const { handleSubmit, handleCreateIntent, handleCreateEscrow, handleCreateEscrowAfterApproval } = useIntentHandlers({
    coordinator: coordinatorClient,
    flowType,
    requesterAddr,
    offeredToken,
    desiredToken,
    offeredAmount,
    desiredAmount,
    feeInfo,
    evmAddress,
    svmAddress,
    svmPublicKey,
    svmWallet,
    mvmAccount,
    directNightlyAddress,
    chainId,
    switchChain,
    savedDraftData,
    signature,
    setDraftId,
    setDraftCreatedAt,
    setSavedDraftData,
    setSignature,
    setPollingSignature,
    pollingActiveRef,
    setError,
    setLoading,
    setTransactionHash,
    setSubmittingTransaction,
    setEscrowHash,
    setApprovingToken,
    setCreatingEscrow,
    writeApprove,
    writeCreateEscrow,
  });

  // Wait for approve transaction
  const { data: approveReceipt, isLoading: isApproving, error: approveReceiptError } = useWaitForTransactionReceipt({
    hash: approveHash,
  });
  
  // Wait for escrow creation transaction
  const { data: escrowReceipt, isLoading: isCreatingEscrow, error: escrowReceiptError } = useWaitForTransactionReceipt({
    hash: createEscrowHash,
  });
  
  // Handle approve errors (user rejected or tx failed)
  useEffect(() => {
    if (approveError) {
      console.error('Approval error:', approveError);
      setError(`Approval failed: ${approveError.message}`);
      setApprovingToken(false);
      resetApprove();
    }
  }, [approveError, resetApprove]);
  
  // Handle escrow creation errors
  useEffect(() => {
    if (escrowError) {
      console.error('Escrow creation error:', escrowError);
      setError(`Escrow creation failed: ${escrowError.message}`);
      setCreatingEscrow(false);
      resetEscrow();
    }
  }, [escrowError, resetEscrow]);
  
  // Handle receipt errors
  useEffect(() => {
    if (approveReceiptError) {
      console.error('Approval receipt error:', approveReceiptError);
      setError(`Approval transaction failed: ${approveReceiptError.message}`);
      setApprovingToken(false);
    }
  }, [approveReceiptError]);
  
  useEffect(() => {
    if (escrowReceiptError) {
      console.error('Escrow receipt error:', escrowReceiptError);
      setError(`Escrow transaction failed: ${escrowReceiptError.message}`);
      setCreatingEscrow(false);
    }
  }, [escrowReceiptError]);
  
  // Handle approve completion
  useEffect(() => {
    if (approveReceipt && !isApproving && !creatingEscrow && !escrowHash) {
      console.log('Approval confirmed, creating escrow...', approveReceipt.transactionHash);
      setApprovingToken(false);
      // After approval, create escrow
      handleCreateEscrowAfterApproval();
    }
  }, [approveReceipt, isApproving, creatingEscrow, escrowHash]);
  
  // Handle escrow creation completion
  useEffect(() => {
    if (escrowReceipt && !isCreatingEscrow) {
      console.log('Escrow created:', escrowReceipt.transactionHash);
      setCreatingEscrow(false);
      setEscrowHash(escrowReceipt.transactionHash);
    }
  }, [escrowReceipt, isCreatingEscrow]);

  const connectedChainKey =
    offeredToken && desiredToken ? getConnectedChain(offeredToken, desiredToken) : null;
  const requiresEvmWallet = connectedChainKey ? isEvmChain(connectedChainKey) : false;
  const requiresSvmWallet = connectedChainKey ? getChainType(CHAIN_CONFIGS, connectedChainKey) === 'svm' : false;
  const connectedWalletReady =
    (!requiresEvmWallet || !!evmAddress) && (!requiresSvmWallet || !!svmAddress);

  const escrowChainKey = savedDraftData ? getChainKeyFromId(CHAIN_CONFIGS, savedDraftData.offeredChainId) : null;
  const escrowRequiresSvm = escrowChainKey ? getChainType(CHAIN_CONFIGS, escrowChainKey) === 'svm' : false;
  const escrowWalletReady = escrowRequiresSvm ? !!svmAddress : !!evmAddress;
  const {
    offeredBalance,
    desiredBalance,
    offeredBalanceError,
    desiredBalanceError,
    loadingOfferedBalance,
    loadingDesiredBalance,
  } = useTokenBalances({
    offeredToken,
    desiredToken,
    resolveAddress: getAddressForChain,
    intentStatus,
  });

  // Poll for GMP requirements delivery on connected chain (inflow only).
  // The escrow contract rejects createEscrow until IntentRequirements arrive via GMP.
  useEffect(() => {
    if (!transactionHash || !savedDraftData || escrowHash) return;
    const isInflow = !isHubChainId(savedDraftData.offeredChainId);
    const chainKey = Object.entries(CHAIN_CONFIGS).find(
      ([, config]) => String(config.chainId) === savedDraftData.offeredChainId
    )?.[0] || null;
    if (!isInflow || !chainKey) {
      setRequirementsDelivered(true);
      return;
    }

    // Build a chain-specific requirements check closure
    const chainType = getChainType(CHAIN_CONFIGS, chainKey);
    const chainCfg = CHAIN_CONFIGS[chainKey];
    let checkRequirements: ((id: string) => Promise<boolean>) | null = null;
    if (chainType === 'evm') {
      checkRequirements = (id) => checkHasRequirements(chainCfg.rpcUrl, chainCfg.escrowContractAddress!, id);
    } else if (chainType === 'svm') {
      checkRequirements = (id) => checkHasRequirementsSvm(chainCfg.rpcUrl, new PublicKey(chainCfg.svmProgramId!), id);
    } else if (chainType === 'mvm') {
      checkRequirements = (id) => checkHasRequirementsMvm(chainCfg.rpcUrl, chainCfg.mvmEscrowModuleAddress!, id);
    }
    if (!checkRequirements) {
      setRequirementsDelivered(true);
      return;
    }

    let cancelled = false;
    setPollingRequirements(true);
    setRequirementsDelivered(false);

    const poll = async () => {
      let attempts = 0;
      const maxAttempts = 60; // 60 * 3s = 3 minutes
      while (!cancelled && attempts < maxAttempts) {
        try {
          const delivered = await checkRequirements(savedDraftData.intentId);
          if (delivered) {
            if (!cancelled) {
              console.log(`GMP requirements delivered to ${chainType} chain`);
              setRequirementsDelivered(true);
              setPollingRequirements(false);
            }
            return;
          }
        } catch (err) {
          console.warn('Error checking hasRequirements:', err);
        }
        attempts++;
        await new Promise(r => setTimeout(r, POLL_REQUIREMENTS_INTERVAL_MS));
      }
      if (!cancelled) {
        setPollingRequirements(false);
      }
    };

    poll();
    return () => { cancelled = true; };
  }, [transactionHash, savedDraftData, escrowHash]);

  const clearDraft = () => {
    clearDraftState(() => {
      setTransactionHash(null);
      setEscrowHash(null);
      setApprovingToken(false);
      setCreatingEscrow(false);
      setRequirementsDelivered(false);
      setPollingRequirements(false);
      resetApprove();
      resetEscrow();
    });
  };

  // Debug: Log escrow button state for inflow intents
  useEffect(() => {
    if (transactionHash && !escrowHash && savedDraftData) {
      const isInflowByChain = !isHubChainId(savedDraftData.offeredChainId);
      const derivedToken = getOfferedTokenFromDraft(savedDraftData);
      console.log('🔍 Escrow button state check:', {
        isInflowByChain,
        transactionHash: !!transactionHash,
        escrowHash: !!escrowHash,
        signature: !!signature,
        savedDraftData: !!savedDraftData,
        offeredToken: !!offeredToken,
        derivedToken: derivedToken?.symbol || 'null',
        offeredChainId: savedDraftData.offeredChainId,
        willShowButton: isInflowByChain,
      });
      if (isInflowByChain && !offeredToken && !derivedToken) {
        console.error('🚨 Cannot find token for escrow! offeredChainId:', savedDraftData.offeredChainId, 'offeredMetadata:', savedDraftData.offeredMetadata);
      }
    }
  }, [transactionHash, escrowHash, savedDraftData, offeredToken, signature]);


  // Filter tokens dynamically based on selections
  // If offeredToken is selected, desiredTokens should exclude tokens from the same chain
  // If desiredToken is selected, offeredTokens should exclude tokens from the same chain
  const offeredTokens = useMemo(() => {
    if (desiredToken) {
      // If desired token is selected, exclude tokens from the same chain
      return SUPPORTED_TOKENS.filter(t => t.chain !== desiredToken.chain);
    }
    // If no desired token selected, show all tokens
    return SUPPORTED_TOKENS;
  }, [desiredToken]);

  const desiredTokens = useMemo(() => {
    if (offeredToken) {
      // If offered token is selected, exclude tokens from the same chain
      return SUPPORTED_TOKENS.filter(t => t.chain !== offeredToken.chain);
    }
    // If no offered token selected, show all tokens
    return SUPPORTED_TOKENS;
  }, [offeredToken]);

  // Helper to organize tokens for dropdown: USD tokens (USDC, USDC.e, USDT) first, then separator, then MOVE and ETH
  const organizeTokensForDropdown = (tokens: TokenConfig[]) => {
    const usdTokens = tokens.filter(t => t.symbol === 'USDC' || t.symbol === 'USDC.e' || t.symbol === 'USDT');
    const others = tokens.filter(t => t.symbol !== 'USDC' && t.symbol !== 'USDC.e' && t.symbol !== 'USDT');
    return { usdcs: usdTokens, others };
  };

  // Auto-calculate desired amount based on solver's exchange rate
  // This runs when offered token/amount or desired token changes
  useEffect(() => {
    if (!offeredToken || !desiredToken || !offeredAmount || !(parseFloat(offeredAmount) > 0)) {
      // Only reset if not already showing not available yet (which indicates a fetch was attempted)
      if (desiredAmount !== 'not available yet') {
        setDesiredAmount('');
      }
      setFeeInfo(null);
      return;
    }

    const fetchExchangeRate = async () => {
      // Set to "Calculating..." immediately to show loading state
      setDesiredAmount('');
      try {
        const offeredChainId = CHAIN_CONFIGS[offeredToken.chain].chainId;
        const desiredChainId = CHAIN_CONFIGS[desiredToken.chain].chainId;
        
        // Query exchange rate for this specific token pair
        const response = await coordinatorClient.getExchangeRate(
          offeredChainId,
          offeredToken.metadata,
          desiredChainId,
          desiredToken.metadata
        );

        if (!response.success || !response.data) {
          // Exchange rate not available - show "not available yet" instead of error
          setDesiredAmount('not available yet');
          setFeeInfo(null);
          setError(null);
          return;
        }

        const offeredAmountNum = parseFloat(offeredAmount);
        const result = calculateFee(offeredAmountNum, offeredToken, desiredToken, response.data);
        setFeeInfo(result.feeInfo);

        if (result.desiredAmount === '0') {
          setDesiredAmount('0');
          const feeInHuman = Number(result.feeInfo.totalFee) / Math.pow(10, offeredToken.decimals);
          setError(`Amount too small: fee (${feeInHuman.toFixed(offeredToken.decimals)} ${offeredToken.symbol}) exceeds offered amount.`);
          return;
        }
        setDesiredAmount(result.desiredAmount);
        setError(null);
      } catch (err) {
        console.error('Failed to fetch exchange rate:', err);
        setDesiredAmount('');
        setFeeInfo(null);
        setError('Failed to fetch exchange rate. Please try again.');
      }
    };

    fetchExchangeRate();
  }, [offeredToken, desiredToken, offeredAmount]);


  return (
    <div className="border border-gray-700 rounded p-6">
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Offered Token */}
        <div>
          <label className="block text-sm font-medium mb-2">
            Send
          </label>
          <select
            value={offeredToken ? `${offeredToken.chain}::${offeredToken.symbol}` : ''}
            onChange={(e) => {
              if (!e.target.value) {
                setOfferedToken(null);
                return;
              }
              const [chain, symbol] = e.target.value.split('::');
              const token = offeredTokens.find(t => t.chain === chain && t.symbol === symbol);
              setOfferedToken(token || null);
              // Clear desired token if it's from the same chain
              if (desiredToken && desiredToken.chain === chain) {
                setDesiredToken(null);
                setDesiredAmount('');
              }
            }}
            className="w-full px-4 py-2 bg-gray-900 border border-gray-600 rounded text-sm"
            required
          >
            <option value="">Select token...</option>
            {(() => {
              const { usdcs, others } = organizeTokensForDropdown(offeredTokens);
              return (
                <>
                  {usdcs.map((token) => (
                    <option key={`${token.chain}::${token.symbol}`} value={`${token.chain}::${token.symbol}`}>
                      {token.name}
                    </option>
                  ))}
                  {usdcs.length > 0 && others.length > 0 && (
                    <option disabled>------</option>
                  )}
                  {others.map((token) => (
                    <option key={`${token.chain}::${token.symbol}`} value={`${token.chain}::${token.symbol}`}>
                      {token.name}
                    </option>
                  ))}
                </>
              );
            })()}
          </select>
        </div>

        <div>
          <div className="flex items-center gap-2">
            <input
              type="text"
              inputMode="decimal"
              lang="en"
              value={offeredAmount}
              onChange={(e) => {
                // Normalize comma to dot for decimal separator
                const normalized = e.target.value.replace(',', '.');
                setOfferedAmount(normalized);
              }}
              placeholder="1"
              className="flex-1 px-4 py-2 bg-gray-900 border border-gray-600 rounded text-sm"
              required
            />
            {offeredToken && (
              <span className="text-sm text-gray-400 font-mono">
                {offeredToken.symbol}
              </span>
            )}
          </div>
          {offeredToken && (
            <div className="mt-2 text-xs">
              {loadingOfferedBalance ? (
                <span className="text-gray-500">Loading balance...</span>
              ) : offeredBalanceError ? (
                <span className="text-red-400" title={offeredBalanceError}>
                  Failed to fetch balance
                </span>
              ) : offeredBalance ? (
                <span className="text-gray-400">
                  Balance: {offeredBalance.formatted} {offeredBalance.symbol}
                </span>
              ) : null}
            </div>
          )}
        </div>

        {/* Swap Direction Button */}
        <div className="flex justify-center -my-2">
          <button
            type="button"
            onClick={() => {
              // Swap tokens
              const tempToken = offeredToken;
              setOfferedToken(desiredToken);
              setDesiredToken(tempToken);
              // Swap amounts
              const tempAmount = offeredAmount;
              setOfferedAmount(desiredAmount === 'not available yet' ? '' : desiredAmount);
              setDesiredAmount(tempAmount === '' ? 'not available yet' : tempAmount);
            }}
            className="p-2 bg-gray-800 hover:bg-gray-700 border border-gray-600 rounded-full transition-colors"
            title="Swap Send and Receive"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
              className="w-5 h-5 text-gray-400"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 7.5L7.5 3m0 0L12 7.5M7.5 3v13.5m13.5 0L16.5 21m0 0L12 16.5m4.5 4.5V7.5" />
            </svg>
          </button>
        </div>

        {/* Desired Token */}
        <div>
          <label className="block text-sm font-medium mb-2">
            Receive
          </label>
          <select
            value={desiredToken ? `${desiredToken.chain}::${desiredToken.symbol}` : ''}
            onChange={(e) => {
              if (!e.target.value) {
                setDesiredToken(null);
                setDesiredAmount('');
                return;
              }
              const [chain, symbol] = e.target.value.split('::');
              const token = desiredTokens.find(t => t.chain === chain && t.symbol === symbol);
              setDesiredToken(token || null);
              setDesiredAmount(''); // Reset amount when token changes
              // Clear offered token if it's from the same chain
              if (offeredToken && offeredToken.chain === chain) {
                setOfferedToken(null);
              }
            }}
            className="w-full px-4 py-2 bg-gray-900 border border-gray-600 rounded text-sm"
            required
          >
            <option value="">Select token...</option>
            {(() => {
              const { usdcs, others } = organizeTokensForDropdown(desiredTokens);
              return (
                <>
                  {usdcs.map((token) => (
                    <option key={`${token.chain}::${token.symbol}`} value={`${token.chain}::${token.symbol}`}>
                      {token.name}
                    </option>
                  ))}
                  {usdcs.length > 0 && others.length > 0 && (
                    <option disabled>------</option>
                  )}
                  {others.map((token) => (
                    <option key={`${token.chain}::${token.symbol}`} value={`${token.chain}::${token.symbol}`}>
                      {token.name}
                    </option>
                  ))}
                </>
              );
            })()}
          </select>
        </div>

        {/* Desired Amount (auto-calculated from solver's exchange rate) */}
        {desiredToken && (
          <div>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={desiredAmount}
                readOnly
                placeholder={
                  desiredAmount && desiredAmount !== 'not available yet'
                    ? '' 
                    : offeredToken && offeredAmount 
                      ? "Calculating..." 
                      : "Enter send amount first"
                }
                className="flex-1 px-4 py-2 bg-gray-800 border border-gray-700 rounded text-sm text-gray-300 cursor-not-allowed"
              />
              <span className="text-sm text-gray-400 font-mono">
                {desiredToken.symbol}
              </span>
            </div>
            {desiredToken && (
              <div className="mt-2 text-xs">
                {loadingDesiredBalance ? (
                  <span className="text-gray-500">Loading balance...</span>
                ) : desiredBalanceError ? (
                  <span className="text-red-400" title={desiredBalanceError}>
                    Failed to fetch balance
                  </span>
                ) : desiredBalance ? (
                  <span className="text-gray-400">
                    Balance: {desiredBalance.formatted} {desiredBalance.symbol}
                  </span>
                ) : (
                  null
                )}
              </div>
            )}
          </div>
        )}

        {/* Fee & Effective Rate */}
        {feeInfo && offeredToken && desiredToken && feeInfo.totalFee > BigInt(0) && offeredAmount && desiredAmount && desiredAmount !== 'not available yet' && (
          <div className="p-3 bg-gray-800/50 border border-gray-700 rounded text-xs text-gray-400 space-y-1">
            <div className="flex justify-between">
              <span>Total fee</span>
              <span>
                {fromSmallestUnits(Number(feeInfo.totalFee), offeredToken.decimals).toFixed(offeredToken.decimals)} {offeredToken.symbol}
              </span>
            </div>
            <div className="flex justify-between">
              <span>Effective rate</span>
              <span>
                {(parseFloat(desiredAmount) / parseFloat(offeredAmount)).toFixed(6)} {desiredToken.symbol}/{offeredToken.symbol}
              </span>
            </div>
          </div>
        )}

        {/* Error Display */}
        {error && (
          <div className="p-3 bg-red-900/30 border border-red-700 rounded text-sm text-red-300">
            {error}
          </div>
        )}

        {/* Action Buttons */}
        <div className="space-y-3">
          {/* Request Button - show when ready to request, stay visible (greyed out) after requested */}
          {!draftId && (
            <button
              type="submit"
              disabled={loading || !requesterAddr || !connectedWalletReady || desiredAmount === 'not available yet'}
              className={`w-full px-4 py-2 rounded text-sm font-medium transition-colors ${
                desiredAmount === 'not available yet' || !requesterAddr || !connectedWalletReady
                  ? 'bg-gray-600 text-gray-400 cursor-not-allowed'
                  : 'bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed'
              }`}
            >
              {loading ? 'Requesting...' : 'Request'}
            </button>
          )}
          {draftId && (
            <button
              type="button"
              disabled
              className="w-full px-4 py-2 rounded text-sm font-medium bg-gray-600 text-gray-400 cursor-not-allowed"
            >
              ✓ Requested
            </button>
          )}

          {/* Commit Button - show when signature received, stay visible (greyed out) after committed */}
          {signature && savedDraftData && !transactionHash && (
            <button
              type="button"
              onClick={handleCreateIntent}
              disabled={submittingTransaction || !requesterAddr || !connectedWalletReady}
              className="w-full px-4 py-2 rounded text-sm font-medium transition-colors bg-green-600 hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {(() => {
                const isOutflow = flowType === 'outflow' || isHubChainId(savedDraftData?.offeredChainId);
                if (submittingTransaction) return isOutflow ? 'Committing and Sending...' : 'Committing...';
                return isOutflow ? 'Commit and Send' : 'Commit';
              })()}
            </button>
          )}
          {signature && savedDraftData && transactionHash && (
            <button
              type="button"
              disabled
              className="w-full px-4 py-2 rounded text-sm font-medium bg-gray-600 text-gray-400 cursor-not-allowed"
            >
              {(() => {
                const isOutflow = flowType === 'outflow' || isHubChainId(savedDraftData?.offeredChainId);
                return isOutflow ? '✓ Committed and Sent' : '✓ Committed';
              })()}
            </button>
          )}

          {/* Send Button (for inflow only) - show when committed, stay visible (greyed out) after sent */}
          {(!isHubChainId(savedDraftData?.offeredChainId)) && transactionHash && !escrowHash && (
            <button
              type="button"
              onClick={handleCreateEscrow}
              disabled={approvingToken || creatingEscrow || isApproving || isCreatingEscrow || isApprovePending || isEscrowPending || !escrowWalletReady || (!escrowRequiresSvm && !requirementsDelivered)}
              className="w-full px-4 py-2 rounded text-sm font-medium transition-colors bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {escrowRequiresSvm
                ? creatingEscrow
                  ? 'Sending...'
                  : 'Send'
                : pollingRequirements
                  ? 'Waiting for GMP relay...'
                  : isApprovePending
                    ? 'Confirm in wallet...'
                    : approvingToken || isApproving
                      ? 'Approving token...'
                      : isEscrowPending
                        ? 'Confirm in wallet...'
                        : creatingEscrow || isCreatingEscrow
                          ? 'Sending...'
                          : 'Send'}
            </button>
          )}
          {(!isHubChainId(savedDraftData?.offeredChainId)) && transactionHash && escrowHash && (
            <button
              type="button"
              disabled
              className="w-full px-4 py-2 rounded text-sm font-medium bg-gray-600 text-gray-400 cursor-not-allowed"
            >
              ✓ Sent
            </button>
          )}
          
          {/* Status note below buttons */}
          {!requesterAddr && (
            <p className="text-xs text-gray-400 text-center">
              Connect your MVM wallet (Nightly) to create an intent
            </p>
          )}
          {requesterAddr && requiresEvmWallet && !evmAddress && (
            <p className="text-xs text-gray-400 text-center">
              Connect your EVM wallet (MetaMask) to create an intent
            </p>
          )}
          {requesterAddr && requiresSvmWallet && !svmAddress && (
            <p className="text-xs text-gray-400 text-center">
              Connect your SVM wallet (Phantom) to create an intent
            </p>
          )}
          {requesterAddr && connectedWalletReady && !draftId && (
            <p className="text-xs text-gray-500 text-center">
              Request intent for solver approval
            </p>
          )}
          {draftId && !signature && pollingSignature && (
            <p className="text-xs text-yellow-400 text-center flex items-center justify-center gap-2">
              <svg className="animate-spin h-4 w-4 text-yellow-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              Waiting for solver commitment
            </p>
          )}
          {signature && savedDraftData && !transactionHash && (
            <p className="text-xs text-green-400 text-center">
              Solver approved! Now commit to the intent.
            </p>
          )}
        </div>

        {/* Timer - outside status box */}
        {mounted && draftId && savedDraftData && signature && intentStatus !== 'fulfilled' && timeRemaining !== null && 
         ((isHubChainId(savedDraftData?.offeredChainId) && !transactionHash) || 
          (!isHubChainId(savedDraftData?.offeredChainId) && !escrowHash)) && (
          <p className="text-xs text-gray-400 text-center">
            Time remaining: {Math.floor(timeRemaining / 1000)}s
            {timeRemaining === 0 && ' (Expired)'}
          </p>
        )}

        {/* Status Display */}
        {mounted && draftId && savedDraftData && signature && (
          <div className="mt-2">
            {transactionHash && (
              <div className="mt-2 space-y-2">
                {/* Show waiting message only after tokens are sent: 
                    - Outflow: immediately after commit (tokens sent on commit)
                    - Inflow: only after escrow is created (escrowHash exists) */}
                {intentStatus === 'created' && pollingFulfillment && 
                 (isHubChainId(savedDraftData?.offeredChainId) || escrowHash) && (
                  <p className="text-xs text-yellow-400 text-center flex items-center justify-center gap-2">
                    <svg className="animate-spin h-4 w-4 text-yellow-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Waiting for funds to arrive...
                  </p>
                )}
                
                {intentStatus === 'fulfilled' && (
                  <p className="text-xs font-bold text-green-400 text-center">Funds received!</p>
                )}
              </div>
            )}
          </div>
        )}
        
        {/* Clear button at bottom when fulfilled */}
        {mounted && draftId && savedDraftData && intentStatus === 'fulfilled' && (
          <button
            type="button"
            onClick={clearDraft}
            className="mt-3 w-full px-4 py-2 bg-yellow-600 hover:bg-yellow-500 text-black font-medium rounded text-sm"
          >
            Clear & Create New Intent
          </button>
        )}

        {/* Debug info - Tx and Intent ID */}
        {transactionHash && (
          <div className="mt-2 text-xs text-gray-500 space-y-1">
            <p className="font-mono break-all">Intent Tx: {transactionHash}</p>
            {savedDraftData?.intentId && (
              <p className="font-mono break-all">Intent ID: {savedDraftData.intentId}</p>
            )}
            {escrowHash && (
              <p className="font-mono break-all">Escrow Tx: {escrowHash}</p>
            )}
          </div>
        )}
      </form>
    </div>
  );
}

