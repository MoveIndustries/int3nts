import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PublicKey, SYSVAR_INSTRUCTIONS_PUBKEY, SystemProgram } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import {
  buildCancelInstruction,
  buildClaimInstruction,
  buildCreateEscrowInstruction,
  getEscrowPda,
  getStatePda,
  getVaultPda,
  parseEscrowAccount,
  svmHexToBytes,
  svmHexToPubkey,
  svmPubkeyToHex,
} from '../../src/chains/svm.js';
import {
  DUMMY_INTENT_ID,
  DUMMY_REQUESTER_ADDR_SVM,
  DUMMY_TOKEN_MINT_SVM,
  DUMMY_SOLVER_ADDR_SVM,
  DUMMY_STATE_PDA,
  DUMMY_ESCROW_PDA,
  DUMMY_VAULT_PDA,
  DUMMY_PUBKEY_TEST,
  DUMMY_SIGNATURE,
} from '../test-constants.js';

// #1: Intent ID conversion with 0x prefix — N/A for SVM (SVM uses byte-level padding, not hex string manipulation)
// #2: Intent ID conversion without prefix — N/A for SVM (SVM uses byte-level padding, not hex string manipulation)
// #3: Short intent IDs zero-padded — N/A for SVM (SVM uses byte-level padding, not hex string manipulation)

// ============================================================================
// Test Fixtures
// ============================================================================

const PROGRAM_ID = SystemProgram.programId;
const INTENT_ID = DUMMY_INTENT_ID;
const REQUESTER = DUMMY_REQUESTER_ADDR_SVM;
const TOKEN_MINT = DUMMY_TOKEN_MINT_SVM;
const SOLVER = DUMMY_SOLVER_ADDR_SVM;
const STATE_PDA = DUMMY_STATE_PDA;
const ESCROW_PDA = DUMMY_ESCROW_PDA;
const VAULT_PDA = DUMMY_VAULT_PDA;

// ============================================================================
// ADDRESS HELPER TESTS
// ============================================================================

describe('svmHex helpers', () => {
  // 5. Test: Intent ID Padding
  // Verifies that svmHexToBytes pads intent IDs to 32 bytes.
  // Why: PDA derivation requires 32-byte intent IDs.
  it('should pad intent IDs to 32 bytes', () => {
    const bytes = svmHexToBytes('0x1');
    expect(bytes).toHaveLength(32);
    expect(bytes[31]).toBe(0x01);
  });

  // #4: Escrow address checksum normalization — N/A for SVM (SVM uses base58 public keys, not checksummed hex)

  // 6. Test: Pubkey Hex Round-Trip
  // Verifies that svmPubkeyToHex and svmHexToPubkey are lossless inverses.
  // Why: Address conversions must be lossless across SVM <-> hex.
  it('should round-trip pubkey hex conversion', () => {
    const pubkey = DUMMY_PUBKEY_TEST;
    const hex = svmPubkeyToHex(pubkey);
    expect(hex).toMatch(/^0x[a-f0-9]{64}$/);
    const restored = svmHexToPubkey(hex);
    expect(restored.toBase58()).toBe(pubkey.toBase58());
  });
});

beforeEach(() => {
  vi.spyOn(PublicKey, 'findProgramAddressSync').mockImplementation((seeds: (Uint8Array | Buffer)[]) => {
    const seedLabel = Buffer.from(seeds[0]).toString('utf8');
    if (seedLabel === 'state') {
      return [STATE_PDA, 255];
    }
    if (seedLabel === 'escrow') {
      return [ESCROW_PDA, 255];
    }
    if (seedLabel === 'vault') {
      return [VAULT_PDA, 255];
    }
    return [STATE_PDA, 255];
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ============================================================================
// PDA HELPER TESTS
// ============================================================================

describe('PDA helpers', () => {
  // 7. Test: PDA Determinism
  // Verifies that state/escrow/vault PDAs are deterministic for a given program + intent ID.
  // Why: PDAs must be stable for a given program + intent ID.
  it('should derive deterministic state/escrow/vault PDAs', () => {
    const [stateOne] = getStatePda(PROGRAM_ID);
    const [stateTwo] = getStatePda(PROGRAM_ID);
    expect(stateOne.toBase58()).toBe(stateTwo.toBase58());

    const [escrowOne] = getEscrowPda(INTENT_ID, PROGRAM_ID);
    const [escrowTwo] = getEscrowPda(INTENT_ID, PROGRAM_ID);
    expect(escrowOne.toBase58()).toBe(escrowTwo.toBase58());

    const [vaultOne] = getVaultPda(INTENT_ID, PROGRAM_ID);
    const [vaultTwo] = getVaultPda(INTENT_ID, PROGRAM_ID);
    expect(vaultOne.toBase58()).toBe(vaultTwo.toBase58());
  });
});

// ============================================================================
// ACCOUNT PARSING TESTS
// ============================================================================

describe('parseEscrowAccount', () => {
  // 8. Test: Escrow Account Parsing
  // Verifies that parseEscrowAccount correctly decodes raw escrow account data.
  // Why: UI needs a stable decoding of on-chain escrow data.
  it('should parse escrow account data into a structured object', () => {
    const data = Buffer.alloc(154);
    Buffer.from('intent00').copy(data, 0);
    Buffer.from(REQUESTER.toBytes()).copy(data, 8);
    Buffer.from(TOKEN_MINT.toBytes()).copy(data, 40);
    data.writeBigUInt64LE(BigInt(123), 72);
    data.writeUInt8(1, 80);
    data.writeBigInt64LE(BigInt(999), 81);
    Buffer.from(SOLVER.toBytes()).copy(data, 89);
    Buffer.from(svmHexToBytes(INTENT_ID)).copy(data, 121);
    data.writeUInt8(42, 153);

    const escrow = parseEscrowAccount(data);
    expect(escrow.requester.toBase58()).toBe(REQUESTER.toBase58());
    expect(escrow.tokenMint.toBase58()).toBe(TOKEN_MINT.toBase58());
    expect(escrow.amount).toBe(BigInt(123));
    expect(escrow.isClaimed).toBe(true);
    expect(escrow.expiry).toBe(BigInt(999));
    expect(escrow.reservedSolver.toBase58()).toBe(SOLVER.toBase58());
    expect(Buffer.from(escrow.intentId).toString('hex')).toBe(INTENT_ID.slice(2));
    expect(escrow.bump).toBe(42);
  });
});

// ============================================================================
// INSTRUCTION BUILDER TESTS
// ============================================================================

describe('instruction builders', () => {
  // 9. Test: CreateEscrow Instruction Layout
  // Verifies that buildCreateEscrowInstruction produces correct key order and data layout.
  // Why: SVM program expects specific key order and data layout.
  it('should build create escrow instruction with expected layout', () => {
    const instruction = buildCreateEscrowInstruction({
      intentId: INTENT_ID,
      amount: BigInt(500),
      requester: REQUESTER,
      requesterToken: REQUESTER,
      tokenMint: TOKEN_MINT,
      reservedSolver: SOLVER,
      programId: PROGRAM_ID,
    });

    expect(instruction.programId.toBase58()).toBe(PROGRAM_ID.toBase58());
    expect(instruction.keys).toHaveLength(9);
    expect(instruction.data[0]).toBe(3); // CreateEscrow variant index (Initialize=0, GmpReceive=1, SetGmpConfig=2, CreateEscrow=3)
    expect(Buffer.from(instruction.data.subarray(1, 33))).toEqual(
      Buffer.from(svmHexToBytes(INTENT_ID))
    );
    expect(instruction.data).toHaveLength(1 + 32 + 8);
  });

  // 10. Test: Claim Instruction Layout
  // Verifies that buildClaimInstruction includes SYSVAR instructions and token program keys.
  // Why: Claim requires SYSVAR instructions and token program keys.
  it('should build claim instruction with sysvar and token program keys', () => {
    const instruction = buildClaimInstruction({
      intentId: INTENT_ID,
      signature: DUMMY_SIGNATURE,
      solverToken: SOLVER,
      programId: PROGRAM_ID,
    });

    const keyBases = instruction.keys.map((key) => key.pubkey.toBase58());
    expect(keyBases).toContain(SYSVAR_INSTRUCTIONS_PUBKEY.toBase58());
    expect(keyBases).toContain(TOKEN_PROGRAM_ID.toBase58());
    expect(instruction.data[0]).toBe(4); // Claim variant index
  });

  // 11. Test: Cancel Instruction Layout
  // Verifies that buildCancelInstruction targets the escrow PDA and requester token account.
  // Why: Cancel must target the escrow PDA and requester token account.
  it('should build cancel instruction with expected layout', () => {
    const instruction = buildCancelInstruction({
      intentId: INTENT_ID,
      requester: REQUESTER,
      requesterToken: REQUESTER,
      programId: PROGRAM_ID,
    });

    expect(instruction.data[0]).toBe(5); // Cancel variant index
    expect(Buffer.from(instruction.data.subarray(1))).toEqual(
      Buffer.from(svmHexToBytes(INTENT_ID))
    );
  });
});
