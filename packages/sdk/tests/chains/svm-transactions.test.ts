import { afterEach, describe, expect, it, vi } from 'vitest';
import { Ed25519Program, TransactionInstruction } from '@solana/web3.js';
import { DUMMY_MESSAGE, DUMMY_SIGNATURE_BYTES, DUMMY_PUBKEY_BYTES } from '../test-constants.js';
import {
  buildEd25519VerificationIx,
  decodeBase64,
  fetchSolverSvmAddress,
  getSvmConnection,
} from '../../src/chains/svm-transactions.js';

// All tests in this file are SVM-specific (N/A for MVM/EVM).
// MVM/EVM use raw fetch to RPC endpoints instead of SVM-specific Connection/Ed25519/registry helpers.

// ============================================================================
// CONNECTION TESTS
// ============================================================================

describe('getSvmConnection', () => {
  /// 1. Test: SVM RPC Selection
  /// Verifies that getSvmConnection uses the provided RPC URL.
  /// Why: Connection must use the caller-provided RPC endpoint, not a hardcoded value.
  it('should use the provided RPC URL', () => {
    const connection = getSvmConnection('https://example.invalid');
    expect(connection.rpcEndpoint).toBe('https://example.invalid');
  });
});

// ============================================================================
// HELPER TESTS
// ============================================================================

describe('decodeBase64', () => {
  /// 2. Test: Base64 Decoding
  /// Verifies that decodeBase64 correctly decodes base64 to bytes.
  /// Why: Integrated-gmp signatures arrive as base64 and must be decoded for Solana.
  it('should decode base64 to bytes', () => {
    const bytes = decodeBase64('AQID');
    expect(Array.from(bytes)).toEqual([1, 2, 3]);
  });

  /// 3. Test: Whitespace Handling
  /// Verifies that decodeBase64 trims leading/trailing whitespace.
  /// Why: Inputs may contain leading/trailing whitespace.
  it('should trim whitespace around base64 input', () => {
    const bytes = decodeBase64('  AQID  ');
    expect(Array.from(bytes)).toEqual([1, 2, 3]);
  });
});

describe('buildEd25519VerificationIx', () => {
  /// 4. Test: Ed25519 Instruction Builder
  /// Verifies that buildEd25519VerificationIx returns an instruction targeting the Ed25519 program.
  /// Why: SVM claim flow depends on a valid Ed25519 verification instruction.
  it('should return an instruction targeting the Ed25519 program', () => {
    const mockInstruction = new TransactionInstruction({
      keys: [],
      programId: Ed25519Program.programId,
      data: new Uint8Array([1]),
    });
    const spy = vi
      .spyOn(Ed25519Program, 'createInstructionWithPublicKey')
      .mockReturnValue(mockInstruction);
    const instruction = buildEd25519VerificationIx({
      message: DUMMY_MESSAGE,
      signature: DUMMY_SIGNATURE_BYTES,
      publicKey: DUMMY_PUBKEY_BYTES,
    });
    expect(spy).toHaveBeenCalledWith({
      message: DUMMY_MESSAGE,
      signature: DUMMY_SIGNATURE_BYTES,
      publicKey: DUMMY_PUBKEY_BYTES,
    });
    expect(instruction.programId.toBase58()).toBe(Ed25519Program.programId.toBase58());
    expect(instruction.data.length).toBeGreaterThan(0);
  });
});

// ============================================================================
// REGISTRY QUERY TESTS
// ============================================================================

describe('fetchSolverSvmAddress', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetAllMocks();
  });

  /// 5. Test: Failed RPC Request
  /// Verifies that fetchSolverSvmAddress returns null when the RPC request fails.
  /// Why: Missing registry data should resolve to null.
  it('should return null when the request fails', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false });
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchSolverSvmAddress('https://rpc.invalid/v1', '0x1', '0xsolver');
    expect(result).toBeNull();
  });

  /// 6. Test: Empty Registry Entry
  /// Verifies that fetchSolverSvmAddress returns null when the registry vec is empty.
  /// Why: Empty registry responses should resolve to null.
  it('should return null when the registry vec is empty', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([{ vec: [] }]),
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchSolverSvmAddress('https://rpc.invalid/v1', '0x1', '0xsolver');
    expect(result).toBeNull();
  });

  /// 7. Test: String Address Normalization
  /// Verifies that fetchSolverSvmAddress returns normalized hex when vec is a string.
  /// Why: Registry can return a hex string without 0x prefix.
  it('should return normalized hex when vec is a string', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([{ vec: 'abcd' }]),
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchSolverSvmAddress('https://rpc.invalid/v1', '0x1', '0xsolver');
    expect(result).toBe('0xabcd');
  });

  /// 8. Test: Vector<u8> Address Conversion
  /// Verifies that fetchSolverSvmAddress converts byte arrays to hex.
  /// Why: Registry can return byte arrays that must be hex-encoded.
  it('should convert vec byte array to hex', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([{ vec: [1, 2, 255] }]),
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchSolverSvmAddress('https://rpc.invalid/v1', '0x1', '0xsolver');
    expect(result).toBe('0x0102ff');
  });
});
