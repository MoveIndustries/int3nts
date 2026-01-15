import {
  Connection,
  Keypair,
  PublicKey,
} from "@solana/web3.js";
import {
  createMint as splCreateMint,
  createAssociatedTokenAccount,
  mintTo as splMintTo,
  getAssociatedTokenAddress,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";

// ============================================================================
// MINT FUNCTIONS
// ============================================================================

/**
 * Create a new SPL token mint
 */
export async function createMint(
  connection: Connection,
  payer: Keypair,
  decimals: number = 9
): Promise<PublicKey> {
  const mintKeypair = Keypair.generate();

  const mint = await splCreateMint(
    connection,
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
 */
export async function createTokenAccounts(
  connection: Connection,
  mint: PublicKey,
  requester: Keypair,
  solver: Keypair
): Promise<{
  requesterTokenAccount: PublicKey;
  solverTokenAccount: PublicKey;
}> {
  const requesterTokenAccount = await createAssociatedTokenAccount(
    connection,
    requester,
    mint,
    requester.publicKey
  );

  const solverTokenAccount = await createAssociatedTokenAccount(
    connection,
    solver,
    mint,
    solver.publicKey
  );

  return { requesterTokenAccount, solverTokenAccount };
}

/**
 * Get the associated token address for an owner
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
 */
export async function mintTo(
  connection: Connection,
  mint: PublicKey,
  destination: PublicKey,
  authority: Keypair,
  amount: number | bigint
): Promise<void> {
  const amountBigInt = typeof amount === "bigint" ? amount : BigInt(amount);

  await splMintTo(
    connection,
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
 */
export async function getTokenBalance(
  connection: Connection,
  tokenAccount: PublicKey
): Promise<number> {
  const balance = await connection.getTokenAccountBalance(tokenAccount);
  return Number(balance.value.amount);
}

// ============================================================================
// EXPORTS
// ============================================================================

export { TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID };
