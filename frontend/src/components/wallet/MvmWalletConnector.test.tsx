import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { MvmWalletConnector } from './MvmWalletConnector';

const connectMock = vi.fn();
const disconnectMock = vi.fn();

const mockState = {
  connected: false,
  account: null as { address: string } | null,
  wallets: [] as { name: string }[],
};

vi.mock('@aptos-labs/wallet-adapter-react', () => ({
  useWallet: () => ({
    connected: mockState.connected,
    account: mockState.account,
    wallets: mockState.wallets,
    connect: connectMock,
    disconnect: disconnectMock,
  }),
}));

describe('MvmWalletConnector', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    connectMock.mockClear();
    disconnectMock.mockClear();
    mockState.connected = false;
    mockState.account = null;
    mockState.wallets = [];
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  // 1. Test: Missing wallet adapters
  // Verifies that MvmWalletConnector disables the connect action when the Aptos wallet adapter reports no available wallets.
  // Why: Attempting to connect without a detected MVM wallet would fail, so the UI should block the action upfront.
  it('should disable when no wallet is detected', async () => {
    render(<MvmWalletConnector />);
    const button = await screen.findByText('MVM');
    expect(button).toBeDisabled();
  });

  // 2. Test: Connected state rendering
  // Verifies that MvmWalletConnector displays the truncated connected account address and exposes a disconnect affordance when the wallet is connected.
  // Why: Users need to confirm the active MVM account and have a way to disconnect from the same control.
  it('should show truncated MVM address when connected', async () => {
    mockState.connected = true;
    mockState.account = { address: '0xabcdef1234567890abcdef1234567890abcdef12' };
    render(<MvmWalletConnector />);
    const button = await screen.findByText(/^MVM 0xabcd\.\.\.ef12$/);
    expect(button).toBeInTheDocument();
    expect(button).toHaveAttribute('title', 'Disconnect MVM');
  });
});
