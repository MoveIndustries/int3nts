// ============================================================================
// Solana Transaction Helpers
// ============================================================================

import { Connection, Ed25519Program, PublicKey, Transaction, TransactionInstruction } from '@solana/web3.js';

// ============================================================================
// Signer Interface
// ============================================================================

export interface SvmSigner {
  publicKey: PublicKey;
  sendTransaction(tx: Transaction, connection: Connection): Promise<string>;
}

// ============================================================================
// Connections
// ============================================================================

/**
 * Build a Solana connection for a given RPC URL.
 */
export function getSvmConnection(rpcUrl: string): Connection {
  return new Connection(rpcUrl, 'confirmed');
}

// ============================================================================
// Transactions
// ============================================================================

/**
 * Send a transaction using a generic SVM signer.
 */
export async function sendSvmTransaction(params: {
  signer: SvmSigner;
  connection: Connection;
  instructions: TransactionInstruction[];
}): Promise<string> {
  const { signer, connection, instructions } = params;

  const transaction = new Transaction().add(...instructions);
  transaction.feePayer = signer.publicKey;
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
  transaction.recentBlockhash = blockhash;

  // Simulate first to get better error messages
  const simResult = await connection.simulateTransaction(transaction);
  if (simResult.value.err) {
    throw new Error(`Transaction simulation failed: ${JSON.stringify(simResult.value.err)}. Logs: ${simResult.value.logs?.join('\n')}`);
  }

  const signature = await signer.sendTransaction(transaction, connection);
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
 *
 * @param rpcUrl - Movement hub chain RPC URL
 * @param moduleAddr - Intent module address on hub chain
 * @param solverAddr - Solver's hub chain address
 */
export async function fetchSolverSvmAddress(
  rpcUrl: string,
  moduleAddr: string,
  solverAddr: string,
): Promise<string | null> {
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
    // Strip any existing 0x prefix(es) and add exactly one
    let clean = vec;
    while (clean.startsWith('0x') || clean.startsWith('0X')) {
      clean = clean.slice(2);
    }
    return `0x${clean}`;
  }

  if (Array.isArray(vec)) {
    const hex = vec.map((b: number) => b.toString(16).padStart(2, '0')).join('');
    return `0x${hex}`;
  }

  return null;
}
