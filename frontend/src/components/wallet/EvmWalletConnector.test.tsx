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

  /**
   * Test: Disconnected state rendering
   * Why: Users should see a connect CTA when no wallet is connected.
   */
  it('should show connect button when disconnected', async () => {
    render(<EvmWalletConnector />);
    const button = await screen.findByText('Connect EVM');
    expect(button).toBeInTheDocument();
  });

  /**
   * Test: Missing wallet adapter
   * Why: UI should disable if MetaMask adapter is unavailable.
   */
  it('should disable when no MetaMask connector is available', async () => {
    mockState.connectors = [];
    render(<EvmWalletConnector />);
    const button = await screen.findByText('EVM');
    expect(button).toBeDisabled();
  });

  /**
   * Test: Connect action
   * Why: Clicking connect should call wagmi connect handler.
   */
  it('should call connect when clicking the connect button', async () => {
    render(<EvmWalletConnector />);
    const button = await screen.findByText('Connect EVM');
    await userEvent.click(button);
    expect(connectMock).toHaveBeenCalledTimes(1);
  });

  /**
   * Test: Connected state rendering
   * Why: Users should see the truncated EVM address and be able to disconnect.
   */
  it('should show truncated EVM address when connected', async () => {
    mockState.isConnected = true;
    render(<EvmWalletConnector />);
    const button = await screen.findByText(/^EVM 0x1234\.\.\.5678$/);
    expect(button).toBeInTheDocument();
    expect(button).toHaveAttribute('title', 'Disconnect EVM');
  });
});
