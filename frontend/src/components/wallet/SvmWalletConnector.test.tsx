import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { SvmWalletConnector } from './SvmWalletConnector';

const connectMock = vi.fn();
const disconnectMock = vi.fn();
const selectMock = vi.fn();

const mockState = {
  connected: false,
  wallets: [{ adapter: { name: 'Phantom' } }],
};

const fakePubkey = { toBase58: () => 'So11111111111111111111111111111111111111112' };

vi.mock('@solana/wallet-adapter-react', () => ({
  useWallet: () => ({
    connected: mockState.connected,
    wallets: mockState.wallets,
    connect: connectMock,
    disconnect: disconnectMock,
    select: selectMock,
    publicKey: mockState.connected ? fakePubkey : null,
  }),
}));

describe('SvmWalletConnector', () => {
  beforeEach(() => {
    connectMock.mockClear();
    disconnectMock.mockClear();
    selectMock.mockClear();
    mockState.connected = false;
    mockState.wallets = [{ adapter: { name: 'Phantom' } }];
  });

  /**
   * Test: Disconnected state rendering
   * Why: Users should see a connect CTA when no wallet is connected.
   */
  it('should show connect button when disconnected', async () => {
    render(<SvmWalletConnector />);
    const button = await screen.findByText('Connect SVM');
    expect(button).toBeInTheDocument();
  });

  /**
   * Test: Missing Phantom adapter
   * Why: UI should disable if Phantom adapter is unavailable.
   */
  it('should disable when Phantom adapter is not detected', async () => {
    mockState.wallets = [];
    render(<SvmWalletConnector />);
    const button = await screen.findByText('SVM');
    expect(button).toBeDisabled();
  });

  /**
   * Test: Connect action
   * Why: Clicking connect should select Phantom and call connect().
   */
  it('should call select and connect on click', async () => {
    render(<SvmWalletConnector />);
    const button = await screen.findByText('Connect SVM');
    await userEvent.click(button);
    expect(selectMock).toHaveBeenCalledWith('Phantom');
    expect(connectMock).toHaveBeenCalledTimes(1);
  });

  /**
   * Test: Connected state rendering
   * Why: Users should see the truncated SVM address and be able to disconnect.
   */
  it('should show truncated SVM address when connected', async () => {
    mockState.connected = true;
    render(<SvmWalletConnector />);
    const button = await screen.findByText(/^SVM So11\.\.\.1112$/);
    expect(button).toBeInTheDocument();
    expect(button).toHaveAttribute('title', 'Disconnect SVM');
  });
});
