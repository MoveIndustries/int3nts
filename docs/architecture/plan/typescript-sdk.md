# Plan: TypeScript Requester SDK

## Problem

All protocol integration logic (coordinator API, escrow management, chain interactions, balance fetching) lives inside the React frontend. This means:

- Non-frontend consumers (bots, CLIs, backend services, other UIs) cannot use this logic without copying code from React components
- Business logic is tangled with React state management in a 2000+ line `IntentBuilder.tsx`
- Code is coupled to `process.env` reads and framework-specific imports

## Solution

Extract requester-side protocol logic into a framework-agnostic npm package at `packages/sdk/`. The frontend becomes a thin UI layer that imports from `@int3nts/sdk`.

> **Scope:** Requester flow only (submit intent → poll signature → create escrow → track fulfillment). Solver SDK deferred — solver integration remains in Rust (`solver/` crate).

## Target Structure

```text
packages/sdk/
├── .gitignore                    # node_modules/, dist/, package-lock.json
├── package.json                  # @int3nts/sdk
├── tsconfig.json
├── tsconfig.build.json
├── vitest.config.ts
├── src/
│   ├── index.ts                  # Barrel export (public API)
│   ├── types.ts                  # Protocol types (from frontend/src/lib/types.ts)
│   ├── config.ts                 # ChainConfig, TokenConfig, helpers (from config/chains.ts + tokens.ts)
│   ├── coordinator.ts            # CoordinatorClient class (from lib/coordinator.ts)
│   ├── utils.ts                  # Hex/bytes helpers (from move-transactions.ts)
│   ├── balances.ts               # Multi-chain balance fetching (from lib/balances.ts)
│   ├── intent.ts                 # IntentFlow orchestration class (from IntentBuilder.tsx logic)
│   └── chains/
│       ├── evm.ts                # EVM escrow + checks (from lib/escrow.ts)
│       ├── svm.ts                # SVM escrow + PDA + instruction builders (from lib/svm-escrow.ts)
│       ├── svm-transactions.ts   # SVM tx helpers with generic signer (from lib/svm-transactions.ts)
│       └── mvm.ts                # MVM helpers (from lib/move-transactions.ts)
└── tests/
    ├── extension-checklist.md    # Test completeness tracking (per-chain symmetry)
    ├── coordinator.test.ts
    ├── chains.test.ts
    ├── tokens.test.ts
    ├── utils.test.ts
    ├── balances.test.ts
    ├── intent.test.ts
    └── chains/
        ├── evm.test.ts
        ├── svm.test.ts
        ├── svm-transactions.test.ts
        └── mvm.test.ts
```

## What Moves vs What Stays

### Stays in frontend (React-specific)

- `IntentBuilder.tsx` — React component, `useState`/`useEffect`, UI rendering
- Wallet adapter hooks (`useAccount`, `useMvmWallet`, `useSvmWallet`)
- Wagmi hooks (`useWriteContract`, `useWaitForTransactionReceipt`)
- Concrete `CHAIN_CONFIGS` with `process.env.NEXT_PUBLIC_*` reads
- Concrete `SUPPORTED_TOKENS` array with hardcoded addresses

### Frontend file changes after extraction

```text
frontend/
├── package.json                              # UPDATE — add "@int3nts/sdk": "file:../packages/sdk"
├── src/
│   ├── config/
│   │   ├── chains.ts                         # SLIM DOWN — keep only CHAIN_CONFIGS constant with process.env reads; ChainConfig interface + helpers move to SDK
│   │   ├── chains.test.ts                    # MOVE TO SDK → tests/chains.test.ts
│   │   ├── tokens.ts                         # SLIM DOWN — keep only SUPPORTED_TOKENS array; TokenConfig interface + toSmallestUnits/fromSmallestUnits move to SDK
│   │   └── tokens.test.ts                    # MOVE TO SDK → tests/tokens.test.ts
│   ├── lib/
│   │   ├── types.ts                          # MOVE TO SDK → src/types.ts (verbatim)
│   │   ├── coordinator.ts                    # MOVE TO SDK → src/coordinator.ts (remove process.env default; require URL in constructor)
│   │   ├── escrow.ts                         # MOVE TO SDK → src/chains/evm.ts (accept explicit config params instead of global lookups)
│   │   ├── escrow.test.ts                    # MOVE TO SDK → tests/chains/evm.test.ts
│   │   ├── svm-escrow.ts                     # MOVE TO SDK → src/chains/svm.ts (parameterize config)
│   │   ├── svm-escrow.test.ts                # MOVE TO SDK → tests/chains/svm.test.ts
│   │   ├── svm-transactions.ts               # SLIM DOWN — keep only wallet-adapter wrapper; logic moves to SDK (replace WalletContextState with generic SvmSigner)
│   │   ├── svm-transactions.test.ts          # MOVE TO SDK → tests/chains/svm-transactions.test.ts
│   │   ├── move-transactions.ts              # MOVE TO SDK → src/utils.ts + src/chains/mvm.ts (hex/bytes helpers + address padding)
│   │   ├── move-transactions.test.ts         # MOVE TO SDK → tests/chains/mvm.test.ts
│   │   ├── balances.ts                       # MOVE TO SDK → src/balances.ts (accept RPC URL params instead of global config)
│   │   └── test-constants.ts                 # MOVE TO SDK → tests/test-constants.ts
│   └── components/
│       └── intent/
│           └── IntentBuilder.tsx              # REFACTOR — remove ~600 lines of business logic; import from SDK
```

## Key Design Decisions

### 1. No environment variables

SDK accepts all config as constructor/function parameters. No `process.env` reads. The frontend passes its env-var-populated configs into SDK functions.

The frontend currently reads `NEXT_PUBLIC_*` env vars at module level in `coordinator.ts` (coordinator URL) and `config/chains.ts` (RPC URLs, contract addresses, program IDs). These are public values — they get bundled into client-side JS and contain only publicly visible on-chain data (no secrets). After extraction, the frontend keeps reading `.env` as before and passes the values into SDK constructors/functions. The SDK itself never touches `process.env`, making it usable in any runtime (Node.js, Deno, browser, CLI).

### 2. No React dependency

The current frontend embeds all protocol logic inside React hooks and components. `IntentBuilder.tsx` alone is 2000+ lines mixing business logic with `useState`, `useEffect`, and UI rendering. This makes the logic impossible to reuse outside React.

The SDK is framework-agnostic. The `IntentFlow` class uses an event emitter pattern instead of hooks:

```typescript
const flow = new IntentFlow({ coordinator, chains, tokens });
flow.on((event) => {
  // { type: 'draft_created', draftId, intentId }
  // { type: 'signature_received', signature }
  // { type: 'fulfilled' }
  // { type: 'error', error }
});
```

The React frontend wraps this in hooks. A Node.js bot would use it directly. A Vue or Svelte app would use its own adapter. The SDK doesn't care.

### 3. Generic signer interfaces (all VMs)

The frontend currently handles signing inconsistently: SVM has `WalletContextState` (a React-specific type) imported directly into `svm-transactions.ts`, while EVM and MVM return unsigned transaction data and let `IntentBuilder.tsx` sign via framework hooks. This is a concrete problem — `WalletContextState` is a React-specific import that makes `svm-transactions.ts` unusable outside React. The SDK extraction fixes this asymmetry by replacing all framework-coupled signing with generic signer interfaces for all three VMs:

```typescript
// SVM
interface SvmSigner {
  publicKey: PublicKey;
  sendTransaction(tx: Transaction, connection: Connection): Promise<string>;
}

// EVM
interface EvmSigner {
  address: string;
  sendTransaction(tx: { to: string; data: string; value?: bigint }): Promise<string>;
}

// MVM
interface MvmSigner {
  address: string;
  signAndSubmitTransaction(payload: InputTransactionData): Promise<{ hash: string }>;
}
```

This requires two changes: (1) remove the `WalletContextState` import from `svm-transactions.ts` and replace it with the generic `SvmSigner` interface, and (2) add `EvmSigner` and `MvmSigner` interfaces where EVM/MVM currently return unsigned transaction data and rely on `IntentBuilder.tsx` to sign via framework hooks. After this, all three chain modules accept a generic signer — signing logic is no longer split between lib code and the React component.

The frontend adapts its wallet hooks (Solana wallet adapter, wagmi, Aptos wallet adapter) to these interfaces. A CLI tool would implement them with local keys. This keeps the SDK symmetric across chains and free of any framework dependency.

### 4. Peer dependencies

Consumer provides: `viem`, `@solana/web3.js`, `@solana/spl-token`.

These are listed as `peerDependencies` rather than direct `dependencies` because:

- The frontend already has these installed — bundling them again would cause version conflicts and duplicate code
- Different consumers may need different versions (e.g., `viem` v2.x vs a future v3.x)
- This is standard practice for SDK packages — the consumer controls the version, the SDK just declares compatibility

### 5. Plain tsc build

No bundler (no webpack, rollup, or esbuild). Plain `tsc` emits `.js` + `.d.ts` files.

Why no bundler: the SDK is consumed by other build tools (Next.js, Vite, etc.) that handle bundling themselves. A pre-bundled SDK would make tree-shaking harder and could cause issues with duplicate dependencies. Raw TypeScript output gives consumers maximum flexibility.

The frontend consumes it via a local file reference during development:

```json
"dependencies": {
  "@int3nts/sdk": "file:../packages/sdk"
}
```

When published to npm later, this becomes a normal version reference (`"@int3nts/sdk": "^0.1.0"`).

## Implementation Steps

Each step below is a separate commit. Use `/commit` after completing each step.

**"Move" means `git mv` then edit in place.** Never copy a file and delete the original — always use `git mv` first so git tracks the rename history, then make modifications to the moved file.

**Update `tests/extension-checklist.md` in every commit that adds or moves tests.** The checklist must reflect the actual tests after each commit — not deferred to Commit 8.

### ✅ Commit 1: `feat(sdk): scaffold packages/sdk with build tooling`

- Create `packages/sdk/` with `.gitignore`, `package.json`, `tsconfig.json`, `tsconfig.build.json`, `vitest.config.ts`
- Create `src/index.ts` (empty barrel export)
- Create `tests/extension-checklist.md` (initial skeleton)
- Verify `tsc` compiles cleanly

### ✅ Commit 2: `feat(sdk): move types, config, and utils from frontend`

- Move `types.ts` → `src/types.ts`
- Extract `ChainConfig`, `TokenConfig` interfaces and pure helpers → `src/config.ts`
- Move hex/bytes helpers → `src/utils.ts`
- Move corresponding tests
- Delete original frontend files
- Update `src/index.ts` exports
- Update root `README.md`, `run-all-unit-tests.sh`, and `.claude/rules.md` with SDK test command
- Verify SDK builds and tests pass

### ✅ Commit 3: `feat(sdk): move CoordinatorClient from frontend`

- Move `coordinator.ts` → `src/coordinator.ts`
- Remove `process.env` default; require URL in constructor
- Add `tests/coordinator.test.ts` (no frontend test existed — new tests for constructor, endpoints, error handling, polling)
- Update `src/index.ts` exports
- Verify SDK builds and tests pass

### ✅ Commit 4: `feat(sdk): move chain modules (evm, svm, mvm) from frontend`

- Move `escrow.ts` → `src/chains/evm.ts`; parameterize config
- Move `svm-escrow.ts` → `src/chains/svm.ts`; parameterize config
- Move `svm-transactions.ts` → `src/chains/svm-transactions.ts`; replace `WalletContextState` with generic `SvmSigner`
- Move `move-transactions.ts` → `src/chains/mvm.ts`; parameterize config
- Define symmetric signer interfaces for all three VMs (`SvmSigner`, `EvmSigner`, `MvmSigner`) — fixes current asymmetry where only SVM had wallet coupling in lib code (see Key Design Decision #3)
- Move corresponding tests
- Delete original frontend files
- Update `src/index.ts` exports
- Verify SDK builds and tests pass

### ✅ Commit 5: `feat(sdk): move balances module from frontend`

- Move `balances.ts` → `src/balances.ts`; accept RPC URL params
- Move corresponding tests (if any)
- Delete original frontend file
- Update `src/index.ts` exports
- Verify SDK builds and tests pass

### ✅ Commit 6: `feat(sdk): add IntentFlow orchestration class`

- Extract from `IntentBuilder.tsx`: fee calculation, draft creation, argument building, polling loops
- Create `src/intent.ts` with `IntentFlow` class
- Add `tests/intent.test.ts`
- Update `src/index.ts` exports
- Verify SDK builds and tests pass

### ✅ Commit 7: `refactor(frontend): consume @int3nts/sdk instead of local lib`

- Add `"@int3nts/sdk": "file:../packages/sdk"` to frontend `package.json`
- Replace all `@/lib/*` and `@/config/*` imports with `@int3nts/sdk`
- Slim down `src/config/chains.ts` (keep only `CHAIN_CONFIGS` constant)
- Slim down `src/config/tokens.ts` (keep only `SUPPORTED_TOKENS` array)
- Slim down `src/lib/svm-transactions.ts` (keep only wallet-adapter wrapper)
- Refactor `IntentBuilder.tsx` to use `IntentFlow` / SDK functions
- Delete all moved files that remain
- Verify frontend builds and all frontend tests pass

### ✅ Commit 8: `docs(sdk): finalize extension-checklist`

- Complete `tests/extension-checklist.md` with all test categories and per-chain status
- Verify all tests pass (SDK + frontend)

## Testing

- **Unit tests**: vitest, same as frontend. Tests move with the code.
- **No E2E in SDK**: E2E coverage stays in `testing-infra/`.
- Frontend tests verify the thin React layer still works after migration.
- SDK test command: `nix develop ./nix -c bash -c "cd packages/sdk && npm test"`
