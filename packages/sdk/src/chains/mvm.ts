// ============================================================================
// MVM (Movement) Helpers
// ============================================================================

// ============================================================================
// Signer Interface
// ============================================================================

export interface MvmTransactionPayload {
  data: {
    function: string;
    typeArguments: string[];
    functionArguments: unknown[];
  };
}

export interface MvmSigner {
  address: string;
  signAndSubmitTransaction(payload: MvmTransactionPayload): Promise<{ hash: string }>;
}

// ============================================================================
// Requirements Check
// ============================================================================

/**
 * Check if IntentRequirements have been delivered via GMP for an intent on MVM.
 *
 * Calls the `has_requirements(vector<u8>)` view function on the MVM connected
 * chain's `intent_inflow_escrow` module. Returns true once the GMP relay has
 * delivered requirements.
 *
 * @param rpcUrl - Movement RPC endpoint URL
 * @param moduleAddr - Escrow module address on the MVM connected chain
 * @param intentId - 32-byte hex intent ID (with 0x prefix)
 */
export async function checkHasRequirementsMvm(
  rpcUrl: string,
  moduleAddr: string,
  intentId: string,
): Promise<boolean> {
  const intentHex = intentId.startsWith('0x') ? intentId.slice(2) : intentId;
  const intentPadded = intentHex.padStart(64, '0');

  const response = await fetch(`${rpcUrl}/view`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      function: `${moduleAddr}::intent_inflow_escrow::has_requirements`,
      type_arguments: [],
      arguments: [`0x${intentPadded}`],
    }),
  });

  const json = await response.json();
  if (json.error_code || json.message) {
    throw new Error(`MVM has_requirements view call failed: ${json.message || JSON.stringify(json)}`);
  }

  // Response is a bare array like [true] or [false]
  return Array.isArray(json) && json[0] === true;
}
