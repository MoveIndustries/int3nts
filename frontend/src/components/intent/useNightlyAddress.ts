'use client';

import { useState, useEffect } from 'react';

/**
 * Track Nightly wallet connection from local storage and custom events.
 */
export function useNightlyAddress(): string | null {
  const [directNightlyAddress, setDirectNightlyAddress] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const savedAddress = localStorage.getItem('nightly_connected_address');
      setDirectNightlyAddress(savedAddress);

      const handleStorageChange = () => {
        const address = localStorage.getItem('nightly_connected_address');
        setDirectNightlyAddress(address);
      };

      const handleNightlyChange = (e: Event) => {
        const customEvent = e as CustomEvent<{ address: string | null }>;
        setDirectNightlyAddress(customEvent.detail.address);
      };

      window.addEventListener('storage', handleStorageChange);
      window.addEventListener('nightly_wallet_changed', handleNightlyChange);
      return () => {
        window.removeEventListener('storage', handleStorageChange);
        window.removeEventListener('nightly_wallet_changed', handleNightlyChange);
      };
    }
  }, []);

  return directNightlyAddress;
}
