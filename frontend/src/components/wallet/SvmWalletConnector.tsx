'use client';

import { useEffect, useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';

/**
 * Connect/disconnect SVM wallet (Phantom).
 */
export function SvmWalletConnector() {
  const { connected, connect, disconnect, wallets, select } = useWallet();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const phantomWallet = wallets.find((wallet) => wallet.adapter.name === 'Phantom');

  if (!mounted) {
    return (
      <button
        disabled
        className="px-3 py-1.5 bg-gray-700 text-gray-400 rounded text-sm cursor-not-allowed"
      >
        SVM
      </button>
    );
  }

  if (connected) {
    return (
      <button
        onClick={() => disconnect()}
        className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 rounded text-sm"
      >
        Disconnect SVM
      </button>
    );
  }

  if (!phantomWallet) {
    return (
      <button
        disabled
        className="px-3 py-1.5 bg-gray-700 text-gray-400 rounded text-sm cursor-not-allowed"
      >
        SVM
      </button>
    );
  }

  const handleConnect = async () => {
    select(phantomWallet.adapter.name);
    await connect();
  };

  return (
    <button
      onClick={handleConnect}
      className="px-3 py-1.5 bg-green-600 hover:bg-green-700 rounded text-sm"
    >
      Connect SVM
    </button>
  );
}
