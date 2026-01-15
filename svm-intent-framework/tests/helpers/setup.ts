import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import { createMint, createTokenAccounts, mintTo } from "./token";

// ============================================================================
// CONSTANTS
// ============================================================================

// Program ID - must match the one in lib.rs
export const PROGRAM_ID = new PublicKey(
  "Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS"
);

// ============================================================================
// TYPES
// ============================================================================

export interface TestContext {
  connection: Connection;
  payer: Keypair;
  verifier: Keypair;
  requester: Keypair;
  solver: Keypair;
  tokenMint: PublicKey;
  requesterTokenAccount: PublicKey;
  solverTokenAccount: PublicKey;
  statePda: PublicKey;
  stateBump: number;
}

// Instruction tags
const InstructionTag = {
  Initialize: 0,
  CreateEscrow: 1,
  Claim: 2,
  Cancel: 3,
} as const;

// ============================================================================
// MANUAL SERIALIZATION HELPERS
// ============================================================================

function serializeInitialize(verifier: PublicKey): Buffer {
  const buf = Buffer.alloc(1 + 32);
  buf.writeUInt8(InstructionTag.Initialize, 0);
  verifier.toBuffer().copy(buf, 1);
  return buf;
}

function serializeCreateEscrow(
  intentId: Uint8Array,
  amount: bigint,
  expiryDuration?: bigint
): Buffer {
  // 1 byte tag + 32 bytes intentId + 8 bytes amount + 1 byte option flag + 8 bytes optional expiry
  const hasExpiry = expiryDuration !== undefined;
  const buf = Buffer.alloc(1 + 32 + 8 + 1 + (hasExpiry ? 8 : 0));
  let offset = 0;

  buf.writeUInt8(InstructionTag.CreateEscrow, offset);
  offset += 1;

  Buffer.from(intentId).copy(buf, offset);
  offset += 32;

  buf.writeBigUInt64LE(amount, offset);
  offset += 8;

  if (hasExpiry) {
    buf.writeUInt8(1, offset); // Some
    offset += 1;
    buf.writeBigInt64LE(expiryDuration!, offset);
  } else {
    buf.writeUInt8(0, offset); // None
  }

  return buf;
}

function serializeClaim(intentId: Uint8Array, signature: Uint8Array): Buffer {
  const buf = Buffer.alloc(1 + 32 + 64);
  let offset = 0;

  buf.writeUInt8(InstructionTag.Claim, offset);
  offset += 1;

  Buffer.from(intentId).copy(buf, offset);
  offset += 32;

  Buffer.from(signature).copy(buf, offset);

  return buf;
}

function serializeCancel(intentId: Uint8Array): Buffer {
  const buf = Buffer.alloc(1 + 32);
  buf.writeUInt8(InstructionTag.Cancel, 0);
  Buffer.from(intentId).copy(buf, 1);
  return buf;
}

// ============================================================================
// SETUP FUNCTIONS
// ============================================================================

/**
 * Initialize the IntentEscrow program state with a verifier
 */
export async function initializeProgram(
  connection: Connection,
  payer: Keypair,
  verifier: PublicKey
): Promise<{ statePda: PublicKey; stateBump: number }> {
  const [statePda, stateBump] = PublicKey.findProgramAddressSync(
    [Buffer.from("state")],
    PROGRAM_ID
  );

  // Check if already initialized
  const stateAccount = await connection.getAccountInfo(statePda);
  if (stateAccount !== null) {
    return { statePda, stateBump };
  }

  const data = serializeInitialize(verifier);

  const ix = new TransactionInstruction({
    keys: [
      { pubkey: statePda, isSigner: false, isWritable: true },
      { pubkey: payer.publicKey, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId: PROGRAM_ID,
    data,
  });

  const tx = new Transaction().add(ix);
  await sendAndConfirmTransaction(connection, tx, [payer]);

  return { statePda, stateBump };
}

/**
 * Set up a complete test environment with all necessary accounts
 */
export async function setupIntentEscrowTests(): Promise<TestContext> {
  const connection = new Connection("http://localhost:8899", "confirmed");

  // Use deterministic keypairs for consistent test state across runs
  const payerSeed = Buffer.alloc(32);
  payerSeed.write("intent-escrow-payer-seed-00001");
  const payer = Keypair.fromSeed(payerSeed);

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
  const airdropAmount = 10 * LAMPORTS_PER_SOL;
  await Promise.all([
    connection.requestAirdrop(payer.publicKey, airdropAmount),
    connection.requestAirdrop(verifier.publicKey, airdropAmount),
    connection.requestAirdrop(requester.publicKey, airdropAmount),
    connection.requestAirdrop(solver.publicKey, airdropAmount),
  ]);

  // Wait for airdrops to confirm
  await new Promise((resolve) => setTimeout(resolve, 2000));

  // Create token mint
  const tokenMint = await createMint(connection, requester);

  // Create token accounts
  const { requesterTokenAccount, solverTokenAccount } = await createTokenAccounts(
    connection,
    tokenMint,
    requester,
    solver
  );

  // Mint tokens to requester
  const mintAmount = 1_000_000_000n; // 1 billion tokens
  await mintTo(connection, tokenMint, requesterTokenAccount, requester, mintAmount);

  // Initialize program state
  const { statePda, stateBump } = await initializeProgram(
    connection,
    requester,
    verifier.publicKey
  );

  return {
    connection,
    payer,
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
// INSTRUCTION BUILDERS
// ============================================================================

/**
 * Build a CreateEscrow instruction
 */
export function buildCreateEscrowInstruction(
  intentId: Uint8Array,
  amount: bigint,
  requester: PublicKey,
  tokenMint: PublicKey,
  requesterTokenAccount: PublicKey,
  reservedSolver: PublicKey,
  expiryDuration?: bigint
): TransactionInstruction {
  const [escrowPda] = getEscrowPda(PROGRAM_ID, intentId);
  const [vaultPda] = getVaultPda(PROGRAM_ID, intentId);

  const data = serializeCreateEscrow(intentId, amount, expiryDuration);

  return new TransactionInstruction({
    keys: [
      { pubkey: escrowPda, isSigner: false, isWritable: true },
      { pubkey: requester, isSigner: true, isWritable: true },
      { pubkey: tokenMint, isSigner: false, isWritable: false },
      { pubkey: requesterTokenAccount, isSigner: false, isWritable: true },
      { pubkey: vaultPda, isSigner: false, isWritable: true },
      { pubkey: reservedSolver, isSigner: false, isWritable: false },
      { pubkey: new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"), isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: new PublicKey("SysvarRent111111111111111111111111111111111"), isSigner: false, isWritable: false },
    ],
    programId: PROGRAM_ID,
    data,
  });
}

/**
 * Build a Claim instruction
 */
export function buildClaimInstruction(
  intentId: Uint8Array,
  signature: Uint8Array,
  solverTokenAccount: PublicKey,
  statePda: PublicKey
): TransactionInstruction {
  const [escrowPda] = getEscrowPda(PROGRAM_ID, intentId);
  const [vaultPda] = getVaultPda(PROGRAM_ID, intentId);

  const data = serializeClaim(intentId, signature);

  return new TransactionInstruction({
    keys: [
      { pubkey: escrowPda, isSigner: false, isWritable: true },
      { pubkey: statePda, isSigner: false, isWritable: false },
      { pubkey: vaultPda, isSigner: false, isWritable: true },
      { pubkey: solverTokenAccount, isSigner: false, isWritable: true },
      { pubkey: new PublicKey("Sysvar1nstructions1111111111111111111111111"), isSigner: false, isWritable: false },
      { pubkey: new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"), isSigner: false, isWritable: false },
    ],
    programId: PROGRAM_ID,
    data,
  });
}

/**
 * Build a Cancel instruction
 */
export function buildCancelInstruction(
  intentId: Uint8Array,
  requester: PublicKey,
  requesterTokenAccount: PublicKey
): TransactionInstruction {
  const [escrowPda] = getEscrowPda(PROGRAM_ID, intentId);
  const [vaultPda] = getVaultPda(PROGRAM_ID, intentId);

  const data = serializeCancel(intentId);

  return new TransactionInstruction({
    keys: [
      { pubkey: escrowPda, isSigner: false, isWritable: true },
      { pubkey: requester, isSigner: true, isWritable: true },
      { pubkey: vaultPda, isSigner: false, isWritable: true },
      { pubkey: requesterTokenAccount, isSigner: false, isWritable: true },
      { pubkey: new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"), isSigner: false, isWritable: false },
    ],
    programId: PROGRAM_ID,
    data,
  });
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Generate a random 32-byte intent ID
 */
export function generateIntentId(): Uint8Array {
  return Keypair.generate().publicKey.toBytes();
}

/**
 * Convert a hex string to a 32-byte Uint8Array
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
 */
export async function advanceTime(
  connection: Connection,
  seconds: number
): Promise<void> {
  console.warn(
    `advanceTime: Waiting ${seconds}s (Solana doesn't support time manipulation like EVM)`
  );
  await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
}

/**
 * Get escrow PDA address for a given intent ID
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

// ============================================================================
// ERROR CODES
// ============================================================================

/**
 * Custom error codes from the program (must match error.rs)
 */
export const EscrowErrorCode = {
  EscrowAlreadyClaimed: 0,
  EscrowDoesNotExist: 1,
  NoDeposit: 2,
  UnauthorizedRequester: 3,
  InvalidSignature: 4,
  UnauthorizedVerifier: 5,
  EscrowExpired: 6,
  EscrowNotExpiredYet: 7,
  InvalidAmount: 8,
  InvalidSolver: 9,
  InvalidInstructionData: 10,
  AccountNotInitialized: 11,
  InvalidPDA: 12,
  InvalidAccountOwner: 13,
} as const;

/**
 * Check if an error contains a specific custom error code
 */
export function hasErrorCode(error: any, code: number): boolean {
  const errorStr = error.toString();
  // Solana formats custom errors as "custom program error: 0xN" in hex
  const hexCode = `0x${code.toString(16)}`;
  return errorStr.includes(`custom program error: ${hexCode}`) || 
         errorStr.includes(`Custom(${code})`);
}
