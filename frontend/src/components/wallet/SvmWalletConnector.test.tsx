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

  // 1. Test: Disconnected state rendering
  // Verifies that SvmWalletConnector renders the connect action when no wallet is connected.
  // Why: Users need a clear call-to-action to initiate an SVM wallet connection.
  it('should show connect button when disconnected', async () => {
    render(<SvmWalletConnector />);
    const button = await screen.findByText('Connect SVM');
    expect(button).toBeInTheDocument();
  });

  // 2. Test: Missing Phantom adapter
  // Verifies that SvmWalletConnector disables the connect action when the Solana wallet adapter reports no available wallets.
  // Why: Attempting to connect without a detected Phantom adapter would fail, so the UI should block the action upfront.
  it('should disable when Phantom adapter is not detected', async () => {
    mockState.wallets = [];
    render(<SvmWalletConnector />);
    const button = await screen.findByText('SVM');
    expect(button).toBeDisabled();
  });

  // 3. Test: Connect action
  // Verifies that SvmWalletConnector selects the Phantom adapter and invokes the useWallet connect handler when the user clicks the connect action.
  // Why: The button must both choose the adapter and trigger connection, otherwise the wallet session cannot be established.
  it('should call select and connect on click', async () => {
    render(<SvmWalletConnector />);
    const button = await screen.findByText('Connect SVM');
    await userEvent.click(button);
    expect(selectMock).toHaveBeenCalledWith('Phantom');
    expect(connectMock).toHaveBeenCalledTimes(1);
  });

  // 4. Test: Connected state rendering
  // Verifies that SvmWalletConnector displays the truncated connected public key and exposes a disconnect affordance when the wallet is connected.
  // Why: Users need to confirm the active SVM account and have a way to disconnect from the same control.
  it('should show truncated SVM address when connected', async () => {
    mockState.connected = true;
    render(<SvmWalletConnector />);
    const button = await screen.findByText(/^SVM So11\.\.\.1112$/);
    expect(button).toBeInTheDocument();
    expect(button).toHaveAttribute('title', 'Disconnect SVM');
  });
});
