---
name: Intent Framework Frontend
overview: Build a cross-chain intent protocol frontend in Next.js 14 that connects Nightly (MVM) and MetaMask (EVM) wallets, allows users to create intents, and tracks their status through the verifier API.
todos:
  - id: setup
    content: Initialize Next.js 14 project with TypeScript and Tailwind
    status: pending
  - id: readme
    content: Create frontend/README.md with quick start
    status: pending
    dependencies:
      - setup
  - id: wallets
    content: Integrate Nightly (MVM) + MetaMask (EVM) wallet adapters
    status: pending
    dependencies:
      - setup
  - id: verifier-client
    content: Build type-safe verifier API client with polling
    status: pending
    dependencies:
      - setup
  - id: intent-builder
    content: Create intent builder form component
    status: pending
    dependencies:
      - wallets
      - verifier-client
  - id: status-tracker
    content: Build status tracker with real-time updates
    status: pending
    dependencies:
      - verifier-client
  - id: tx-signing
    content: Implement transaction signing for inflow and outflow
    status: pending
    dependencies:
      - wallets
      - intent-builder
  - id: integration
    content: Wire up full flow end-to-end
    status: pending
    dependencies:
      - intent-builder
      - status-tracker
      - tx-signing
  - id: docs
    content: Create docs/frontend/README.md and update docs/README.md
    status: pending
    dependencies:
      - integration
  - id: commit-phase1
    content: Commit and test Phase 1 (Project Setup)
    status: pending
    dependencies:
      - readme
  - id: commit-phase2
    content: Commit and test Phase 2 (Wallet Connection)
    status: pending
    dependencies:
      - wallets
  - id: commit-phase3
    content: Commit and test Phase 3 (Verifier API Client)
    status: pending
    dependencies:
      - verifier-client
  - id: commit-phase4
    content: Commit and test Phase 4 (Intent Builder)
    status: pending
    dependencies:
      - intent-builder
  - id: commit-phase5
    content: Commit and test Phase 5 (Status Tracker)
    status: pending
    dependencies:
      - status-tracker
  - id: commit-phase6
    content: Commit and test Phase 6 (Transaction Signing)
    status: pending
    dependencies:
      - tx-signing
  - id: commit-phase7
    content: Commit and test Phase 7 (Documentation)
    status: pending
    dependencies:
      - docs
---

# Intent Framework Frontend

## Overview

A Next.js 14 frontend for the cross-chain intent protocol, enabling users to:

- Connect Nightly wallet (for MVM chains) + MetaMask (for EVM chains)
- Create inflow/outflow intents
- Submit drafts to the verifier and poll for solver signatures
- Track intent lifecycle through completion

## Architecture

```mermaid
flowchart LR
    subgraph frontend [Frontend]
        UI[React UI]
        Nightly[Nightly Wallet]
        MetaMask[MetaMask]
        API[Verifier Client]
    end
    
    subgraph mvm [MVM Chains]
        Hub[Movement Hub Chain]
        MVMConnected[MVM Connected Chain]
    end
    
    subgraph evm [EVM Chains]
        EVMConnected[EVM Connected Chain]
    end
    
    subgraph services [Services]
        Verifier[Trusted Verifier :3333]
    end
    
    UI --> Nightly
    UI --> MetaMask
    UI --> API
    API --> Verifier
    Nightly --> Hub
    Nightly --> MVMConnected
    MetaMask --> EVMConnected
```

## Key Files

- `frontend/src/app/layout.tsx` - Wallet providers (Nightly + wagmi)
- `frontend/src/app/page.tsx` - Main intent creation page
- `frontend/src/lib/verifier.ts` - Verifier API client
- `frontend/src/lib/types.ts` - Protocol types (DraftIntent, IntentStatus)
- `frontend/src/components/wallet/` - Wallet connection UI
- `frontend/src/components/intent/IntentBuilder.tsx` - Intent creation form
- `frontend/src/components/status/StatusTracker.tsx` - Intent lifecycle tracker

## Documentation Approach

Following repo's three-layer pattern:

- `frontend/README.md` - Quick start, build commands, link to docs
- `docs/frontend/README.md` - Overview, links to existing protocol.md for flows
- Update `docs/README.md` - Add Frontend to Components list

No duplication of protocol flows - link to [protocol.md](docs/protocol.md) instead.

## Inflow User Flow

Tokens locked on connected chain, received on hub.

```mermaid
sequenceDiagram
    participant User
    participant Frontend
    participant Verifier
    participant Solver
    participant Hub as Hub Chain
    participant Connected as Connected Chain
    
    User->>Frontend: 1. Connect Nightly + MetaMask
    User->>Frontend: 2. Build inflow intent
    Frontend->>Verifier: 3. POST /draftintent
    loop Poll
        Frontend->>Verifier: 4. GET /draftintent/:id/signature
    end
    Solver->>Verifier: Solver signs draft
    Verifier->>Frontend: Return signature
    User->>Hub: 5. Sign tx: create_inflow_intent (Nightly)
    User->>Connected: 6. Sign tx: create_escrow (MetaMask or Nightly)
    Note over User,Connected: Escrow locks tokens on connected chain
    Solver->>Hub: 7. Fulfills intent on hub
    Verifier->>Verifier: 8. Generates approval
    Solver->>Connected: 9. Claims escrow
    Frontend->>User: 10. Show completion
```

## Outflow User Flow

Tokens locked on hub, received on connected chain.

```mermaid
sequenceDiagram
    participant User
    participant Frontend
    participant Verifier
    participant Solver
    participant Hub as Hub Chain
    participant Connected as Connected Chain
    
    User->>Frontend: 1. Connect Nightly + MetaMask
    User->>Frontend: 2. Build outflow intent
    Frontend->>Verifier: 3. POST /draftintent
    loop Poll
        Frontend->>Verifier: 4. GET /draftintent/:id/signature
    end
    Solver->>Verifier: Solver signs draft
    Verifier->>Frontend: Return signature
    User->>Hub: 5. Sign tx: create_outflow_intent (Nightly)
    Note over User,Hub: Intent locks tokens on hub
    Solver->>Connected: 6. Transfers tokens to user
    Solver->>Verifier: 7. POST /validate-outflow-fulfillment
    Verifier->>Solver: 8. Approval signature
    Solver->>Hub: 9. Fulfills intent with approval
    Frontend->>User: 10. Show completion
```

## Tech Stack

- **Framework**: Next.js 14 (App Router)
- **MVM Wallet**: Nightly via @nightlylabs/aptos-wallet-adapter-react
- **EVM Wallet**: MetaMask via wagmi + viem + @tanstack/react-query
- **Styling**: Tailwind CSS
- **Design**: Dark theme, monospace typography, terminal aesthetic

## Implementation Phases

### Phase 1: Project Setup

- Initialize Next.js with TypeScript
- Configure Tailwind with dark theme
- Set up wallet providers
- Create `frontend/README.md`
- **Commit and test**

### Phase 2: Wallet Connection

- Nightly adapter integration (for MVM Hub + MVM Connected chains)
- MetaMask integration via wagmi (for EVM Connected chains)
- Unified wallet status display
- **Commit and test**

### Phase 3: Verifier API Client

- Type-safe API client for all endpoints
- Polling hooks for signature/status
- Error handling
- **Commit and test**

### Phase 4: Intent Builder

- Flow type selector (inflow/outflow)
- Chain + token selection
- Amount inputs with validation
- Expiry configuration
- **Commit and test**

### Phase 5: Status Tracker

- Visual step progression (draft, signed, on-chain, escrow, fulfilled, complete)
- Real-time polling updates
- Transaction hash links
- **Commit and test**

### Phase 6: Transaction Signing

- Inflow: create_inflow_intent (hub) + create_escrow (connected)
- Outflow: create_outflow_intent (hub)
- Handle both MVM and EVM connected chains
- **Commit and test**

### Phase 7: Documentation

- Create `docs/frontend/README.md` (link to protocol.md for flows)
- Update `docs/README.md` to add Frontend component
- **Commit and test**

## Environment Variables

```javascript
NEXT_PUBLIC_VERIFIER_URL=http://localhost:3333
NEXT_PUBLIC_MVM_HUB_RPC=https://testnet.movementnetwork.xyz
NEXT_PUBLIC_EVM_RPC=https://...
```

