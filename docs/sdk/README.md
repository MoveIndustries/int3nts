# TypeScript Requester SDK

Framework-agnostic TypeScript SDK for the int3nts cross-chain intent protocol. Covers the full requester flow: submit intent, poll for solver signature, build on-chain arguments, create escrow, and track fulfillment.

## Overview

Any TypeScript consumer (React frontend, Node.js bot, CLI tool) can use the SDK to interact with the int3nts protocol. All configuration is passed as explicit parameters — the SDK never reads environment variables.

**Scope:** Requester flow only (submit intent -> track fulfillment). Solver integration is in Rust (`solver/` crate).

## Architecture

### Modules

- **types** - Protocol types: `DraftIntentRequest`, `DraftIntentSignature`, `IntentStatus`, etc.
- **config** - `ChainConfig` and `TokenConfig` interfaces, chain/token query helpers
- **utils** - Hex/bytes conversion, EVM address padding for Move
- **coordinator** - `CoordinatorClient` class for coordinator API interaction and polling
- **balances** - Multi-chain token balance fetching (EVM, SVM, MVM)
- **intent** - `IntentFlow` orchestration class, fee calculation, argument building, polling loops
- **chains/evm** - EVM escrow contract interaction, intent ID conversion, requirement/fulfillment checks
- **chains/svm** - SVM PDA derivation, escrow parsing, instruction builders (create/claim/cancel)
- **chains/svm-transactions** - SVM transaction helpers, Ed25519 verification, solver registry queries
- **chains/mvm** - MVM address helpers, requirement/fulfillment checks

### Design Decisions

- **No environment variables** - SDK accepts all config as constructor/function parameters
- **No React dependency** - `IntentFlow` uses an event emitter pattern instead of hooks
- **Generic signer interfaces** - `SvmSigner`, `EvmSigner`, `MvmSigner` replace framework-coupled wallet types
- **Peer dependencies** - Consumer provides `viem`, `@solana/web3.js`, `@solana/spl-token`
- **Plain tsc build** - No bundler; raw `.js` + `.d.ts` output for maximum consumer flexibility

## Usage

### IntentFlow (High-Level)

```typescript
import { IntentFlow, CoordinatorClient } from '@int3nts/sdk';

const coordinator = new CoordinatorClient('http://localhost:8080');
const flow = new IntentFlow({ coordinator, chainConfigs });

flow.on((event) => {
  // { type: 'draft_created', draftId, draftData }
  // { type: 'signature_received', signature }
  // { type: 'fulfilled' }
  // { type: 'error', error }
});

// 1. Calculate fee
const feeResult = flow.calculateFee(amount, offeredToken, desiredToken, rateData);

// 2. Create draft + poll for solver signature
await flow.requestDraft({ requesterAddr, offeredToken, ... });

// 3. Build Move transaction arguments
const args = flow.buildArguments({ flowType: 'inflow', requesterAddr, evmAddress });

// 4. (Caller submits on-chain transaction)

// 5. Poll for fulfillment
await flow.waitForFulfillment({ intentId, flowType: 'inflow' });
```

### Direct Function Usage (Low-Level)

```typescript
import {
  getChainType, isHubChain, getRpcUrl,
  fetchTokenBalance,
  checkHasRequirements, checkIsFulfilled,
  buildCreateEscrowInstruction,
} from '@int3nts/sdk';

// Config helpers take explicit chain configs
const chainType = getChainType(chainConfigs, 'base-sepolia');
const rpcUrl = getRpcUrl(chainConfigs, 'base-sepolia');

// Chain queries take explicit RPC/address params
const balance = await fetchTokenBalance(rpcUrl, walletAddr, token);
const hasEscrow = await checkHasRequirements(rpcUrl, escrowAddr, intentId);
```

## Quick Start

See the [component README](../../packages/sdk/README.md) for installation and build commands.

## Testing

```bash
nix develop ./nix -c bash -c "cd packages/sdk && npm test"
```

For test completeness tracking, see [`tests/extension-checklist.md`](../../packages/sdk/tests/extension-checklist.md).
