'use client';

import { useAccount, useConnect, useDisconnect } from 'wagmi';
import { useEffect, useState } from 'react';

/**
 * Connect/disconnect EVM wallet (MetaMask).
 */
export function EvmWalletConnector() {
  const { address, isConnected, chainId } = useAccount();
  const { connect, connectors, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const metaMaskConnector = connectors.find((c) => c.id === 'metaMaskSDK' || c.id === 'io.metamask');

  if (!mounted) {
    return (
      <button
        disabled
        className="px-3 py-1.5 bg-gray-700 text-gray-400 rounded text-sm cursor-not-allowed"
      >
        EVM
      </button>
    );
  }

  if (isConnected) {
    if (!address) {
      throw new Error('Connected but no EVM address available');
    }
    const short = `${address.slice(0, 6)}...${address.slice(-4)}`;
    return (
      <button
        onClick={() => disconnect()}
        className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 rounded text-sm"
        title="Disconnect EVM"
      >
        EVM {short}
      </button>
    );
  }

  if (!metaMaskConnector) {
    return (
      <button
        disabled
        className="px-3 py-1.5 bg-gray-700 text-gray-400 rounded text-sm cursor-not-allowed"
      >
        EVM
      </button>
    );
  }

  return (
    <button
      onClick={() => connect({ connector: metaMaskConnector })}
      disabled={isPending}
      className="px-3 py-1.5 bg-green-600 hover:bg-green-700 rounded text-sm disabled:opacity-50"
    >
      {isPending ? 'Connecting...' : 'Connect EVM'}
    </button>
  );
}
