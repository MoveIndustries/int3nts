import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { EvmWalletConnector } from './EvmWalletConnector';

const connectMock = vi.fn();
const disconnectMock = vi.fn();

const mockState = {
  isConnected: false,
  isPending: false,
  connectors: [{ id: 'metaMaskSDK' }],
};

vi.mock('wagmi', () => ({
  useAccount: () => ({
    address: '0x1234567890abcdef1234567890abcdef12345678',
    isConnected: mockState.isConnected,
    chainId: 1,
  }),
  useConnect: () => ({
    connect: connectMock,
    connectors: mockState.connectors,
    isPending: mockState.isPending,
  }),
  useDisconnect: () => ({ disconnect: disconnectMock }),
}));

describe('EvmWalletConnector', () => {
  beforeEach(() => {
    connectMock.mockClear();
    disconnectMock.mockClear();
    mockState.isConnected = false;
    mockState.isPending = false;
    mockState.connectors = [{ id: 'metaMaskSDK' }];
  });

  // 1. Test: Disconnected state rendering
  // Verifies that EvmWalletConnector renders the connect action when no wallet is connected.
  // Why: Users need a clear call-to-action to initiate an EVM wallet connection.
  it('should show connect button when disconnected', async () => {
    render(<EvmWalletConnector />);
    const button = await screen.findByText('Connect EVM');
    expect(button).toBeInTheDocument();
  });

  // 2. Test: Missing wallet adapter
  // Verifies that EvmWalletConnector disables the connect action when no MetaMask connector is present in the wagmi connectors list.
  // Why: Attempting to connect without an available adapter would fail, so the UI should prevent the action upfront.
  it('should disable when no MetaMask connector is available', async () => {
    mockState.connectors = [];
    render(<EvmWalletConnector />);
    const button = await screen.findByText('EVM');
    expect(button).toBeDisabled();
  });

  // 3. Test: Connect action
  // Verifies that EvmWalletConnector invokes the wagmi useConnect handler when the user clicks the connect action.
  // Why: The button must be wired to the wallet connection side effect, otherwise users cannot connect.
  it('should call connect when clicking the connect button', async () => {
    render(<EvmWalletConnector />);
    const button = await screen.findByText('Connect EVM');
    await userEvent.click(button);
    expect(connectMock).toHaveBeenCalledTimes(1);
  });

  // 4. Test: Connected state rendering
  // Verifies that EvmWalletConnector displays the truncated connected address and exposes a disconnect affordance when the wallet is connected.
  // Why: Users need to confirm the active account and have a way to disconnect from the same control.
  it('should show truncated EVM address when connected', async () => {
    mockState.isConnected = true;
    render(<EvmWalletConnector />);
    const button = await screen.findByText(/^EVM 0x1234\.\.\.5678$/);
    expect(button).toBeInTheDocument();
    expect(button).toHaveAttribute('title', 'Disconnect EVM');
  });
});
