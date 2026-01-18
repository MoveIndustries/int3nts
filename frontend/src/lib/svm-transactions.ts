/**
 * Solana transaction helpers for SVM escrow flows.
 */

import { Connection, Ed25519Program, Transaction, TransactionInstruction } from '@solana/web3.js';
import type { WalletContextState } from '@solana/wallet-adapter-react';
import { getIntentContractAddress, getRpcUrl } from '@/config/chains';

// ============================================================================
// Connections
// ============================================================================

/**
 * Build a Solana connection for the configured SVM RPC.
 */
export function getSvmConnection(): Connection {
  return new Connection(getRpcUrl('svm-devnet'), 'confirmed');
}

// ============================================================================
// Transactions
// ============================================================================

/**
 * Send a transaction using the connected Phantom wallet.
 */
export async function sendSvmTransaction(params: {
  wallet: WalletContextState;
  connection: Connection;
  instructions: TransactionInstruction[];
}): Promise<string> {
  const { wallet, connection, instructions } = params;
  if (!wallet.publicKey) {
    throw new Error('SVM wallet not connected');
  }

  const transaction = new Transaction().add(...instructions);
  transaction.feePayer = wallet.publicKey;
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
  transaction.recentBlockhash = blockhash;

  const signature = await wallet.sendTransaction(transaction, connection);
  await connection.confirmTransaction(
    { signature, blockhash, lastValidBlockHeight },
    'confirmed'
  );
  return signature;
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Build an Ed25519 verification instruction for the SVM program.
 */
export function buildEd25519VerificationIx(params: {
  message: Uint8Array;
  signature: Uint8Array;
  publicKey: Uint8Array;
}): TransactionInstruction {
  return Ed25519Program.createInstructionWithPublicKey({
    message: params.message,
    signature: params.signature,
    publicKey: params.publicKey,
  });
}

/**
 * Decode a base64 string into bytes (browser-safe helper).
 */
export function decodeBase64(base64: string): Uint8Array {
  const normalized = base64.trim();
  const binary = atob(normalized);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// ============================================================================
// Registry Queries
// ============================================================================

/**
 * Fetch the solver's registered SVM address from the hub chain registry.
 */
export async function fetchSolverSvmAddress(solverAddr: string): Promise<string | null> {
  const rpcUrl = getRpcUrl('movement');
  const moduleAddr = getIntentContractAddress();

  const response = await fetch(`${rpcUrl}/view`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      function: `${moduleAddr}::solver_registry::get_connected_chain_svm_address`,
      type_arguments: [],
      arguments: [solverAddr],
    }),
  });

  if (!response.ok) {
    return null;
  }

  const result = await response.json();
  const optionValue = result?.[0];
  if (!optionValue || !optionValue.vec) {
    return null;
  }

  const vec = optionValue.vec;
  if (Array.isArray(vec) && vec.length === 0) {
    return null;
  }

  if (typeof vec === 'string') {
    return vec.startsWith('0x') ? vec : `0x${vec}`;
  }

  if (Array.isArray(vec)) {
    const hex = vec.map((b: number) => b.toString(16).padStart(2, '0')).join('');
    return `0x${hex}`;
  }

  return null;
}
