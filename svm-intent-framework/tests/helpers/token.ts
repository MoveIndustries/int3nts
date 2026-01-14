import * as anchor from "@coral-xyz/anchor";
import {
  createMint as splCreateMint,
  createAssociatedTokenAccount,
  mintTo as splMintTo,
  getAssociatedTokenAddress,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { Keypair, PublicKey } from "@solana/web3.js";

// ============================================================================
// MINT FUNCTIONS
// ============================================================================

/**
 * Create a new SPL token mint
 *
 * # Arguments
 * - `provider`: Anchor provider
 * - `payer`: Keypair to pay for the transaction
 * - `decimals`: Token decimals (default: 9)
 *
 * # Returns
 * - `PublicKey`: The mint address
 */
export async function createMint(
  provider: anchor.AnchorProvider,
  payer: Keypair,
  decimals: number = 9
): Promise<PublicKey> {
  const mintKeypair = Keypair.generate();

  const mint = await splCreateMint(
    provider.connection,
    payer,
    payer.publicKey, // mint authority
    payer.publicKey, // freeze authority
    decimals,
    mintKeypair
  );

  return mint;
}

// ============================================================================
// TOKEN ACCOUNT FUNCTIONS
// ============================================================================

/**
 * Create token accounts for requester and solver
 *
 * # Arguments
 * - `provider`: Anchor provider
 * - `mint`: Token mint address
 * - `requester`: Requester keypair
 * - `solver`: Solver keypair
 *
 * # Returns
 * - `requesterTokenAccount`: Requester's associated token account
 * - `solverTokenAccount`: Solver's associated token account
 */
export async function createTokenAccounts(
  provider: anchor.AnchorProvider,
  mint: PublicKey,
  requester: Keypair,
  solver: Keypair
): Promise<{
  requesterTokenAccount: PublicKey;
  solverTokenAccount: PublicKey;
}> {
  const requesterTokenAccount = await createAssociatedTokenAccount(
    provider.connection,
    requester,
    mint,
    requester.publicKey
  );

  const solverTokenAccount = await createAssociatedTokenAccount(
    provider.connection,
    solver,
    mint,
    solver.publicKey
  );

  return { requesterTokenAccount, solverTokenAccount };
}

/**
 * Get the associated token address for an owner
 *
 * # Arguments
 * - `mint`: Token mint address
 * - `owner`: Owner public key
 *
 * # Returns
 * - `PublicKey`: The associated token account address
 */
export async function getTokenAddress(
  mint: PublicKey,
  owner: PublicKey
): Promise<PublicKey> {
  return getAssociatedTokenAddress(mint, owner);
}

// ============================================================================
// MINT OPERATIONS
// ============================================================================

/**
 * Mint tokens to a destination account
 *
 * # Arguments
 * - `provider`: Anchor provider
 * - `mint`: Token mint address
 * - `destination`: Destination token account
 * - `authority`: Mint authority keypair
 * - `amount`: Amount to mint (in base units)
 */
export async function mintTo(
  provider: anchor.AnchorProvider,
  mint: PublicKey,
  destination: PublicKey,
  authority: Keypair,
  amount: number | anchor.BN | bigint
): Promise<void> {
  const amountBigInt =
    typeof amount === "bigint"
      ? amount
      : amount instanceof anchor.BN
        ? BigInt(amount.toString())
        : BigInt(amount);

  await splMintTo(
    provider.connection,
    authority,
    mint,
    destination,
    authority,
    amountBigInt
  );
}

// ============================================================================
// BALANCE FUNCTIONS
// ============================================================================

/**
 * Get the token balance of an account
 *
 * # Arguments
 * - `provider`: Anchor provider
 * - `tokenAccount`: Token account address
 *
 * # Returns
 * - `number`: Token balance in base units
 */
export async function getTokenBalance(
  provider: anchor.AnchorProvider,
  tokenAccount: PublicKey
): Promise<number> {
  const balance = await provider.connection.getTokenAccountBalance(tokenAccount);
  return Number(balance.value.amount);
}

// ============================================================================
// EXPORTS
// ============================================================================

export { TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID };
