import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { IntentEscrow } from "../../target/types/intent_escrow";
import { createMint, createTokenAccounts, mintTo } from "./token";

// ============================================================================
// TYPES
// ============================================================================

export interface TestContext {
  provider: anchor.AnchorProvider;
  program: Program<IntentEscrow>;
  verifier: Keypair;
  requester: Keypair;
  solver: Keypair;
  tokenMint: PublicKey;
  requesterTokenAccount: PublicKey;
  solverTokenAccount: PublicKey;
  statePda: PublicKey;
  stateBump: number;
}

// ============================================================================
// SETUP FUNCTIONS
// ============================================================================

/**
 * Initialize the IntentEscrow program state with a verifier
 *
 * # Arguments
 * - `program`: The Anchor program instance
 * - `payer`: Keypair to pay for the transaction
 * - `verifier`: Public key of the authorized verifier
 *
 * # Returns
 * - `statePda`: The PDA address of the state account
 * - `stateBump`: The bump seed for the state PDA
 */
export async function initializeProgram(
  program: Program<IntentEscrow>,
  payer: Keypair,
  verifier: PublicKey
): Promise<{ statePda: PublicKey; stateBump: number }> {
  const [statePda, stateBump] = PublicKey.findProgramAddressSync(
    [Buffer.from("state")],
    program.programId
  );

  // Check if already initialized (account exists with data)
  const stateAccount = await program.provider.connection.getAccountInfo(statePda);
  if (stateAccount !== null) {
    // Already initialized, just return the PDA
    return { statePda, stateBump };
  }

  await program.methods
    .initialize(verifier)
    .accounts({
      state: statePda,
      payer: payer.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .signers([payer])
    .rpc();

  return { statePda, stateBump };
}

/**
 * Set up a complete test environment with all necessary accounts
 *
 * # Returns
 * - `TestContext`: Object containing all test accounts and program references
 */
export async function setupIntentEscrowTests(): Promise<TestContext> {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.IntentEscrow as Program<IntentEscrow>;

  // Use deterministic keypairs for consistent test state across runs
  // This ensures the same verifier is used if state is already initialized
  const verifierSeed = Buffer.alloc(32);
  verifierSeed.write("intent-escrow-verifier-seed-001");
  const verifier = Keypair.fromSeed(verifierSeed);

  const requesterSeed = Buffer.alloc(32);
  requesterSeed.write("intent-escrow-requester-seed-01");
  const requester = Keypair.fromSeed(requesterSeed);

  const solverSeed = Buffer.alloc(32);
  solverSeed.write("intent-escrow-solver-seed-00001");
  const solver = Keypair.fromSeed(solverSeed);

  // Airdrop SOL to test accounts
  const airdropAmount = 10 * anchor.web3.LAMPORTS_PER_SOL;
  await Promise.all([
    provider.connection.requestAirdrop(verifier.publicKey, airdropAmount),
    provider.connection.requestAirdrop(requester.publicKey, airdropAmount),
    provider.connection.requestAirdrop(solver.publicKey, airdropAmount),
  ]);

  // Wait for airdrops to confirm
  await new Promise((resolve) => setTimeout(resolve, 1000));

  // Create token mint
  const tokenMint = await createMint(provider, requester);

  // Create token accounts
  const { requesterTokenAccount, solverTokenAccount } = await createTokenAccounts(
    provider,
    tokenMint,
    requester,
    solver
  );

  // Mint tokens to requester
  const mintAmount = 1_000_000_000; // 1 billion tokens
  await mintTo(provider, tokenMint, requesterTokenAccount, requester, mintAmount);

  // Initialize program state
  const { statePda, stateBump } = await initializeProgram(
    program,
    requester,
    verifier.publicKey
  );

  return {
    provider,
    program,
    verifier,
    requester,
    solver,
    tokenMint,
    requesterTokenAccount,
    solverTokenAccount,
    statePda,
    stateBump,
  };
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Generate a random 32-byte intent ID
 *
 * # Returns
 * - `Uint8Array`: 32-byte random intent ID
 */
export function generateIntentId(): Uint8Array {
  return Keypair.generate().publicKey.toBytes();
}

/**
 * Convert a hex string to a 32-byte Uint8Array
 * Useful for cross-chain intent ID compatibility
 *
 * # Arguments
 * - `hexString`: Hex string (with or without 0x prefix)
 *
 * # Returns
 * - `Uint8Array`: 32-byte array
 */
export function hexToBytes32(hexString: string): Uint8Array {
  const hex = hexString.startsWith("0x") ? hexString.slice(2) : hexString;
  const padded = hex.padStart(64, "0");
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    bytes[i] = parseInt(padded.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/**
 * Advance blockchain time for expiry testing
 * Note: This only works with solana-test-validator in test mode
 *
 * # Arguments
 * - `provider`: Anchor provider
 * - `seconds`: Number of seconds to advance
 */
export async function advanceTime(
  provider: anchor.AnchorProvider,
  seconds: number
): Promise<void> {
  // In Solana, we can't directly advance time like in EVM
  // For testing expiry, we need to use solana-test-validator with --warp-slot
  // or wait for actual time to pass
  // This is a placeholder - actual implementation depends on test environment
  console.warn(
    `advanceTime: Waiting ${seconds}s (Solana doesn't support time manipulation like EVM)`
  );
  await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
}

/**
 * Get escrow PDA address for a given intent ID
 *
 * # Arguments
 * - `programId`: The program ID
 * - `intentId`: The 32-byte intent ID
 *
 * # Returns
 * - `escrowPda`: The PDA address
 * - `bump`: The bump seed
 */
export function getEscrowPda(
  programId: PublicKey,
  intentId: Uint8Array
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("escrow"), Buffer.from(intentId)],
    programId
  );
}

/**
 * Get vault PDA address for a given intent ID
 *
 * # Arguments
 * - `programId`: The program ID
 * - `intentId`: The 32-byte intent ID
 *
 * # Returns
 * - `vaultPda`: The PDA address
 * - `bump`: The bump seed
 */
export function getVaultPda(
  programId: PublicKey,
  intentId: Uint8Array
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), Buffer.from(intentId)],
    programId
  );
}
