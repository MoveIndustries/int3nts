/**
 * Test Helpers for SVM Intent Escrow (Native Solana)
 *
 * Provides common fixtures and utilities for testing the IntentEscrow program.
 */

// Setup and test context
export {
  TestContext,
  PROGRAM_ID,
  setupIntentEscrowTests,
  initializeProgram,
  generateIntentId,
  hexToBytes32,
  advanceTime,
  getEscrowPda,
  getVaultPda,
  buildCreateEscrowInstruction,
  buildClaimInstruction,
  buildCancelInstruction,
  EscrowErrorCode,
  hasErrorCode,
} from "./setup";

// Token utilities
export {
  createMint,
  createTokenAccounts,
  getTokenAddress,
  mintTo,
  getTokenBalance,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "./token";
