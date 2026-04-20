'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WagmiProvider } from 'wagmi';
import { AptosWalletAdapterProvider } from '@aptos-labs/wallet-adapter-react';
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react';
import { PhantomWalletAdapter } from '@solana/wallet-adapter-wallets';
import { wagmiConfig } from '@/lib/wagmi-config';
import { CHAIN_CONFIGS } from '@/config/chains';
import { useMemo, useState } from 'react';

// Find the first configured SVM chain's RPC URL
const svmChain = Object.values(CHAIN_CONFIGS).find(c => c.chainType === 'svm');

/**
 * App-level providers for MVM, EVM, and SVM wallets plus React Query.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  const svmWallets = useMemo(() => [new PhantomWalletAdapter()], []);

  // AptosWalletAdapterProvider will auto-detect wallets that follow the wallet standard
  // Nightly wallet should be detected automatically if installed
  // Using empty array - wallets will be auto-detected
  const wallets: any[] = [];

  const inner = (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <AptosWalletAdapterProvider plugins={wallets} autoConnect={false}>
          {children}
        </AptosWalletAdapterProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );

  if (!svmChain) {
    return inner;
  }

  return (
    <ConnectionProvider endpoint={svmChain.rpcUrl}>
      <WalletProvider wallets={svmWallets} autoConnect={false}>
        {inner}
      </WalletProvider>
    </ConnectionProvider>
  );
}

