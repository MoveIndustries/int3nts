'use client';

import { useState, useMemo, useEffect } from 'react';
import { useAccount } from 'wagmi';
import { useWallet } from '@aptos-labs/wallet-adapter-react';
import { verifierClient } from '@/lib/verifier';
import type { DraftIntentRequest } from '@/lib/types';
import { generateIntentId } from '@/lib/types';
import { SUPPORTED_TOKENS, type TokenConfig, toSmallestUnits } from '@/config/tokens';
import { CHAIN_CONFIGS } from '@/config/chains';
import { fetchTokenBalance, type TokenBalance } from '@/lib/balances';

type FlowType = 'inflow' | 'outflow';

export function IntentBuilder() {
  const { address: evmAddress } = useAccount();
  const { account: mvmAccount } = useWallet();
  const [directNightlyAddress, setDirectNightlyAddress] = useState<string | null>(null);
  const [offeredBalance, setOfferedBalance] = useState<TokenBalance | null>(null);
  const [desiredBalance, setDesiredBalance] = useState<TokenBalance | null>(null);
  const [loadingOfferedBalance, setLoadingOfferedBalance] = useState(false);
  const [loadingDesiredBalance, setLoadingDesiredBalance] = useState(false);

  // Check for direct Nightly connection from localStorage
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const savedAddress = localStorage.getItem('nightly_connected_address');
      setDirectNightlyAddress(savedAddress);
      
      // Listen for storage changes (in case wallet disconnects in another tab)
      const handleStorageChange = () => {
        const address = localStorage.getItem('nightly_connected_address');
        setDirectNightlyAddress(address);
      };
      window.addEventListener('storage', handleStorageChange);
      return () => window.removeEventListener('storage', handleStorageChange);
    }
  }, []);
  const [flowType, setFlowType] = useState<FlowType>('inflow');
  const [offeredToken, setOfferedToken] = useState<TokenConfig | null>(null);
  const [offeredAmount, setOfferedAmount] = useState('');
  const [desiredToken, setDesiredToken] = useState<TokenConfig | null>(null);
  const [desiredAmount, setDesiredAmount] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [draftCreatedAt, setDraftCreatedAt] = useState<number | null>(null);
  const [timeRemaining, setTimeRemaining] = useState<number | null>(null);
  const [mounted, setMounted] = useState(false);

  // Restore draft ID from localStorage after mount (to avoid hydration mismatch)
  useEffect(() => {
    setMounted(true);
    if (typeof window !== 'undefined') {
      const savedDraftId = localStorage.getItem('last_draft_id');
      const savedCreatedAt = localStorage.getItem('last_draft_created_at');
      if (savedDraftId && savedCreatedAt) {
        setDraftId(savedDraftId);
        setDraftCreatedAt(parseInt(savedCreatedAt, 10));
      }
    }
  }, []);

  // Update countdown timer
  useEffect(() => {
    if (!draftCreatedAt) {
      setTimeRemaining(null);
      return;
    }

    const updateTimer = () => {
      const now = Date.now();
      const expiryTime = draftCreatedAt + 30000; // 30 seconds = 30000ms
      const remaining = Math.max(0, expiryTime - now);
      setTimeRemaining(remaining);

      if (remaining === 0) {
        // Draft expired
        setDraftId(null);
        setDraftCreatedAt(null);
        if (typeof window !== 'undefined') {
          localStorage.removeItem('last_draft_id');
          localStorage.removeItem('last_draft_created_at');
        }
      }
    };

    // Update immediately
    updateTimer();

    // Update every second
    const interval = setInterval(updateTimer, 1000);

    return () => clearInterval(interval);
  }, [draftCreatedAt]);

  // Clear draft when manually cleared
  const clearDraft = () => {
    setDraftId(null);
    setDraftCreatedAt(null);
    if (typeof window !== 'undefined') {
      localStorage.removeItem('last_draft_id');
      localStorage.removeItem('last_draft_created_at');
    }
  };

  // Filter tokens based on flow type
  const offeredTokens = useMemo(() => {
    if (flowType === 'inflow') {
      // Inflow: offered tokens are on connected chain (EVM)
      return SUPPORTED_TOKENS.filter(t => t.chain === 'base-sepolia' || t.chain === 'ethereum-sepolia');
    } else {
      // Outflow: offered tokens are on hub chain (Movement)
      return SUPPORTED_TOKENS.filter(t => t.chain === 'movement');
    }
  }, [flowType]);

  const desiredTokens = useMemo(() => {
    if (flowType === 'inflow') {
      // Inflow: desired tokens are on hub chain (Movement)
      return SUPPORTED_TOKENS.filter(t => t.chain === 'movement');
    } else {
      // Outflow: desired tokens are on connected chain (EVM)
      return SUPPORTED_TOKENS.filter(t => t.chain === 'base-sepolia' || t.chain === 'ethereum-sepolia');
    }
  }, [flowType]);

  // Reset token selections when flow type changes
  const handleFlowTypeChange = (newFlowType: FlowType) => {
    setFlowType(newFlowType);
    setOfferedToken(null);
    setDesiredToken(null);
  };

  // Get requester address based on flow type
  // For inflow: requester is on connected chain (EVM), but we use MVM address for hub
  // For outflow: requester is on hub (MVM)
  // Check both adapter account and direct Nightly connection
  const requesterAddr = directNightlyAddress || mvmAccount?.address || '';
  const mvmAddress = directNightlyAddress || mvmAccount?.address || '';

  // Fetch balance when offered token is selected
  useEffect(() => {
    if (!offeredToken) {
      setOfferedBalance(null);
      return;
    }

    const address = offeredToken.chain === 'movement' ? mvmAddress : evmAddress;
    if (!address) {
      setOfferedBalance(null);
      return;
    }

    setLoadingOfferedBalance(true);
    console.log('Fetching offered balance:', { address, token: offeredToken.symbol, chain: offeredToken.chain });
    fetchTokenBalance(address, offeredToken)
      .then((balance) => {
        console.log('Offered balance result:', balance);
        setOfferedBalance(balance);
      })
      .catch((error) => {
        console.error('Error fetching offered balance:', error);
        setOfferedBalance(null);
      })
      .finally(() => {
        setLoadingOfferedBalance(false);
      });
  }, [offeredToken, mvmAddress, evmAddress]);

  // Fetch balance when desired token is selected
  useEffect(() => {
    if (!desiredToken) {
      setDesiredBalance(null);
      return;
    }

    const address = desiredToken.chain === 'movement' ? mvmAddress : evmAddress;
    if (!address) {
      setDesiredBalance(null);
      return;
    }

    setLoadingDesiredBalance(true);
    console.log('Fetching desired balance:', { address, token: desiredToken.symbol, chain: desiredToken.chain });
    fetchTokenBalance(address, desiredToken)
      .then((balance) => {
        console.log('Desired balance result:', balance);
        setDesiredBalance(balance);
      })
      .catch((error) => {
        console.error('Error fetching desired balance:', error);
        setDesiredBalance(null);
      })
      .finally(() => {
        setLoadingDesiredBalance(false);
      });
  }, [desiredToken, mvmAddress, evmAddress]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setDraftId(null);

    // Validation
    if (!requesterAddr) {
      setError('Please connect your MVM wallet (Nightly)');
      return;
    }

    if (!offeredToken || !desiredToken) {
      setError('Please select both offered and desired tokens');
      return;
    }

    const offeredAmountNum = parseFloat(offeredAmount);
    const desiredAmountNum = parseFloat(desiredAmount);
    if (isNaN(offeredAmountNum) || offeredAmountNum <= 0) {
      setError('Offered amount must be a positive number');
      return;
    }
    if (isNaN(desiredAmountNum) || desiredAmountNum <= 0) {
      setError('Desired amount must be a positive number');
      return;
    }

    // Convert main values to smallest units using token decimals
    const offeredAmountSmallest = toSmallestUnits(offeredAmountNum, offeredToken.decimals);
    const desiredAmountSmallest = toSmallestUnits(desiredAmountNum, desiredToken.decimals);

    // Expiry is fixed to 30 seconds from now (hardcoded, not user-configurable)
    const expiryTime = Math.floor(Date.now() / 1000) + 30;

    // Get chain IDs from config
    const offeredChainId = CHAIN_CONFIGS[offeredToken.chain].chainId;
    const desiredChainId = CHAIN_CONFIGS[desiredToken.chain].chainId;

    // Generate random intent ID (32-byte hex)
    const intentId = generateIntentId();

    setLoading(true);
    try {
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
          flow_type: flowType,
        },
        expiry_time: expiryTime,
      };

      const response = await verifierClient.createDraftIntent(request);

      if (response.success && response.data) {
        const createdAt = Date.now();
        setDraftId(response.data.draft_id);
        setDraftCreatedAt(createdAt);
        setError(null);
        // Save to localStorage
        if (typeof window !== 'undefined') {
          localStorage.setItem('last_draft_id', response.data.draft_id);
          localStorage.setItem('last_draft_created_at', createdAt.toString());
        }
      } else {
        setError(response.error || 'Failed to create draft intent');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error occurred');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="border border-gray-700 rounded p-6">
      <h2 className="text-2xl font-bold mb-6">Create Intent</h2>
      
      {/* Expiry Note */}
      <div className="mb-6 p-3 bg-gray-800/50 border border-gray-700 rounded text-xs text-gray-400">
        <p>⚠️ Intent expires 30 seconds after creation</p>
      </div>

      {/* Flow Type Selector */}
      <div className="mb-6">
        <label className="block text-sm font-medium mb-2">Flow Type</label>
        <div className="flex gap-4">
          <label className="flex items-center">
            <input
              type="radio"
              value="inflow"
              checked={flowType === 'inflow'}
              onChange={(e) => handleFlowTypeChange(e.target.value as FlowType)}
              className="mr-2"
            />
            <span>Inflow</span>
          </label>
          <label className="flex items-center">
            <input
              type="radio"
              value="outflow"
              checked={flowType === 'outflow'}
              onChange={(e) => handleFlowTypeChange(e.target.value as FlowType)}
              className="mr-2"
            />
            <span>Outflow</span>
          </label>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Offered Token */}
        <div>
          <label className="block text-sm font-medium mb-2">
            Offered Token
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
            }}
            className="w-full px-4 py-2 bg-gray-900 border border-gray-600 rounded text-sm"
            required
          >
            <option value="">Select token...</option>
            {offeredTokens.map((token) => (
              <option key={`${token.chain}::${token.symbol}`} value={`${token.chain}::${token.symbol}`}>
                {token.name} ({token.symbol})
              </option>
            ))}
          </select>
          {offeredToken && (
            <div className="mt-2 text-xs">
              {loadingOfferedBalance ? (
                <span className="text-gray-500">Loading balance...</span>
              ) : offeredBalance ? (
                <span className="text-gray-400">
                  Balance: {offeredBalance.formatted} {offeredBalance.symbol}
                </span>
              ) : (
                <span className="text-gray-500">Balance unavailable</span>
              )}
            </div>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium mb-2">
            Offered Amount
          </label>
          <div className="flex items-center gap-2">
            <input
              type="number"
              value={offeredAmount}
              onChange={(e) => setOfferedAmount(e.target.value)}
              placeholder="1"
              min="0"
              step="0.000001"
              className="flex-1 px-4 py-2 bg-gray-900 border border-gray-600 rounded text-sm"
              required
            />
            {offeredToken && (
              <span className="text-sm text-gray-400 font-mono">
                {offeredToken.symbol}
              </span>
            )}
          </div>
        </div>

        {/* Desired Token */}
        <div>
          <label className="block text-sm font-medium mb-2">
            Desired Token
          </label>
          <select
            value={desiredToken ? `${desiredToken.chain}::${desiredToken.symbol}` : ''}
            onChange={(e) => {
              if (!e.target.value) {
                setDesiredToken(null);
                return;
              }
              const [chain, symbol] = e.target.value.split('::');
              const token = desiredTokens.find(t => t.chain === chain && t.symbol === symbol);
              setDesiredToken(token || null);
            }}
            className="w-full px-4 py-2 bg-gray-900 border border-gray-600 rounded text-sm"
            required
          >
            <option value="">Select token...</option>
            {desiredTokens.map((token) => (
              <option key={`${token.chain}::${token.symbol}`} value={`${token.chain}::${token.symbol}`}>
                {token.name} ({token.symbol})
              </option>
            ))}
          </select>
          {desiredToken && (
            <div className="mt-2 text-xs">
              {loadingDesiredBalance ? (
                <span className="text-gray-500">Loading balance...</span>
              ) : desiredBalance ? (
                <span className="text-gray-400">
                  Balance: {desiredBalance.formatted} {desiredBalance.symbol}
                </span>
              ) : (
                <span className="text-gray-500">Balance unavailable</span>
              )}
            </div>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium mb-2">
            Desired Amount
          </label>
          <div className="flex items-center gap-2">
            <input
              type="number"
              value={desiredAmount}
              onChange={(e) => setDesiredAmount(e.target.value)}
              placeholder="1"
              min="0"
              step="0.000001"
              className="flex-1 px-4 py-2 bg-gray-900 border border-gray-600 rounded text-sm"
              required
            />
            {desiredToken && (
              <span className="text-sm text-gray-400 font-mono">
                {desiredToken.symbol}
              </span>
            )}
          </div>
        </div>

        {/* Error Display */}
        {error && (
          <div className="p-3 bg-red-900/30 border border-red-700 rounded text-sm text-red-300">
            {error}
          </div>
        )}

        {/* Success Display */}
        {mounted && draftId && (
          <div className="p-3 bg-green-900/30 border border-green-700 rounded text-sm text-green-300">
            <p className="font-bold">Draft Intent Created!</p>
            <p className="mt-1 font-mono text-xs">Draft ID: {draftId}</p>
            {timeRemaining !== null && (
              <p className="mt-2 text-xs">
                Time remaining: {Math.floor(timeRemaining / 1000)}s
                {timeRemaining === 0 && ' (Expired)'}
              </p>
            )}
            <p className="mt-2 text-xs">
              Polling for solver signature... (check Debug tab for status)
            </p>
            <button
              onClick={clearDraft}
              className="mt-2 text-xs underline hover:no-underline"
            >
              Clear
            </button>
          </div>
        )}

        {/* Submit Button */}
        <button
          type="submit"
          disabled={loading || !requesterAddr}
          className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? 'Creating Draft Intent...' : 'Create Draft Intent'}
        </button>

        {!requesterAddr && (
          <p className="text-xs text-gray-400 text-center">
            Connect your MVM wallet (Nightly) to create an intent
          </p>
        )}
      </form>
    </div>
  );
}

