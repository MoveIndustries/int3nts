'use client';

import { useState, useEffect } from 'react';
import {
  type TokenConfig,
  type TokenBalance,
  getRpcUrl,
  fetchTokenBalance,
} from '@int3nts/sdk';
import { CHAIN_CONFIGS } from '@/config/chains';

/**
 * Fetch balances for offered/desired tokens with refresh on fulfillment.
 */
export function useTokenBalances(params: {
  offeredToken: TokenConfig | null;
  desiredToken: TokenConfig | null;
  resolveAddress: (chain: TokenConfig['chain']) => string;
  intentStatus: 'pending' | 'created' | 'fulfilled';
}) {
  const { offeredToken, desiredToken, resolveAddress, intentStatus } = params;
  const [offeredBalance, setOfferedBalance] = useState<TokenBalance | null>(null);
  const [desiredBalance, setDesiredBalance] = useState<TokenBalance | null>(null);
  const [offeredBalanceError, setOfferedBalanceError] = useState<string | null>(null);
  const [desiredBalanceError, setDesiredBalanceError] = useState<string | null>(null);
  const [loadingOfferedBalance, setLoadingOfferedBalance] = useState(false);
  const [loadingDesiredBalance, setLoadingDesiredBalance] = useState(false);

  useEffect(() => {
    if (!offeredToken) {
      setOfferedBalance(null);
      return;
    }
    const address = resolveAddress(offeredToken.chain);
    if (!address) {
      setOfferedBalance(null);
      return;
    }
    setLoadingOfferedBalance(true);
    setOfferedBalanceError(null);
    console.log('Fetching offered balance:', { address, token: offeredToken.symbol, chain: offeredToken.chain });
    fetchTokenBalance(getRpcUrl(CHAIN_CONFIGS, offeredToken.chain), address, offeredToken)
      .then((balance) => {
        console.log('Offered balance result:', balance);
        setOfferedBalance(balance);
      })
      .catch((err: unknown) => {
        console.error('Failed to fetch offered balance:', err);
        setOfferedBalance(null);
        setOfferedBalanceError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => setLoadingOfferedBalance(false));
  }, [offeredToken, resolveAddress]);

  useEffect(() => {
    if (!desiredToken) {
      setDesiredBalance(null);
      setDesiredBalanceError(null);
      return;
    }
    const address = resolveAddress(desiredToken.chain);
    if (!address) {
      setDesiredBalance(null);
      setDesiredBalanceError(null);
      return;
    }
    setLoadingDesiredBalance(true);
    setDesiredBalanceError(null);
    console.log('Fetching desired balance:', { address, token: desiredToken.symbol, chain: desiredToken.chain });
    fetchTokenBalance(getRpcUrl(CHAIN_CONFIGS, desiredToken.chain), address, desiredToken)
      .then((balance) => {
        console.log('Desired balance result:', balance);
        setDesiredBalance(balance);
      })
      .catch((err: unknown) => {
        console.error('Failed to fetch desired balance:', err);
        setDesiredBalance(null);
        setDesiredBalanceError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => setLoadingDesiredBalance(false));
  }, [desiredToken, resolveAddress]);

  useEffect(() => {
    if (intentStatus !== 'fulfilled') {
      return;
    }
    if (offeredToken) {
      const offeredAddress = resolveAddress(offeredToken.chain);
      if (offeredAddress) {
        setLoadingOfferedBalance(true);
        setOfferedBalanceError(null);
        fetchTokenBalance(getRpcUrl(CHAIN_CONFIGS, offeredToken.chain), offeredAddress, offeredToken)
          .then(setOfferedBalance)
          .catch((err: unknown) => {
            console.error('Failed to fetch offered balance:', err);
            setOfferedBalance(null);
            setOfferedBalanceError(err instanceof Error ? err.message : String(err));
          })
          .finally(() => setLoadingOfferedBalance(false));
      }
    }
    if (desiredToken) {
      const desiredAddress = resolveAddress(desiredToken.chain);
      if (desiredAddress) {
        setLoadingDesiredBalance(true);
        setDesiredBalanceError(null);
        fetchTokenBalance(getRpcUrl(CHAIN_CONFIGS, desiredToken.chain), desiredAddress, desiredToken)
          .then(setDesiredBalance)
          .catch((err: unknown) => {
            console.error('Failed to fetch desired balance:', err);
            setDesiredBalance(null);
            setDesiredBalanceError(err instanceof Error ? err.message : String(err));
          })
          .finally(() => setLoadingDesiredBalance(false));
      }
    }
  }, [intentStatus, offeredToken, desiredToken, resolveAddress]);

  return {
    offeredBalance,
    desiredBalance,
    offeredBalanceError,
    desiredBalanceError,
    loadingOfferedBalance,
    loadingDesiredBalance,
  };
}
