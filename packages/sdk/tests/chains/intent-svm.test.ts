import { describe, it } from 'vitest';

// ============================================================================
// buildIntentArguments — SVM
// ============================================================================
//
// Tests for SVM-specific intent argument building.
// Covers inflow/outflow paths with SVM pubkey hex conversion.
//
// This file exists to maintain test structure alignment across frameworks.

describe('buildIntentArguments (SVM)', () => {
  /// 1. Test: Builds Inflow SVM Arguments
  /// Verifies that inflow arguments are built with hex-converted SVM pubkeys.
  /// Why: Move entry functions require 32-byte hex; SVM base58 pubkeys must be converted.
  /// TODO: Implement - SVM path exists in buildIntentArguments, needs test fixtures with base58 pubkey conversion
  it('builds inflow SVM arguments');

  /// 2. Test: Builds Outflow SVM Arguments
  /// Verifies that outflow arguments are built with hex-converted SVM pubkeys.
  /// Why: Outflow desired metadata and requester address need hex conversion for Move.
  /// TODO: Implement - SVM path exists in buildIntentArguments, needs test fixtures with base58 pubkey conversion
  it('builds outflow SVM arguments');

  /// 3. Test: Throws When Solver Lacks SVM Address
  /// Verifies that missing solver_svm_addr causes an error.
  /// Why: SVM inflow/outflow paths require the solver's SVM address for the connected chain.
  /// TODO: Implement - SVM path exists in buildIntentArguments, needs test fixtures with base58 pubkey conversion
  it('throws when solver lacks SVM address');
});
