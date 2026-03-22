# Testing Infrastructure

## CI/E2E Tests

- [CI/E2E Tests](../../testing-infra/ci-e2e/) — Local E2E testing using Docker containers

## E2E Test Flows

All USD tokens use 6 decimals (1,000,000 units = \$1). Fee = \$0.015 per intent (1% base + 50 bps).
Each test runs two connected chains against the same hub. Hub balances carry; connected chains start fresh.

### Inflow (Connected Chain → Hub)

Requester offers USDcon on connected chain, wants USDhub on hub.

```mermaid
sequenceDiagram
    participant R as Requester
    participant S as Solver
    participant Hub as Hub
    participant Con1 as Connected 1
    participant Con2 as Connected 2

    Note over Hub: R=$2, S=$2
    Note over Con1: R=$2, S=$2
    Note over Con2: R=$2, S=$2

    rect rgb(240, 248, 255)
    Note over R,Con2: Connected 1: $1 USDcon → $0.985 USDhub
    R->>Hub: Create intent (negotiated via coordinator)
    R->>Con1: Escrow $1 USDcon
    S->>Hub: Fulfill: $0.985 USDhub → Requester
    Con1->>S: Release escrow: $1 USDcon → Solver
    Note over Hub: R=$2.985, S=$1.015
    Note over Con1: R=$1, S=$3
    end

    rect rgb(240, 248, 255)
    Note over R,Con2: Connected 2: $1 USDcon → $0.985 USDhub
    R->>Hub: Create intent (negotiated via coordinator)
    R->>Con2: Escrow $1 USDcon
    S->>Hub: Fulfill: $0.985 USDhub → Requester
    Con2->>S: Release escrow: $1 USDcon → Solver
    Note over Hub: R=$3.97, S=$0.03
    Note over Con2: R=$1, S=$3
    end

    rect rgb(255, 240, 240)
    Note over R,Con2: Rejection: solver has $0.03 USDhub
    R->>Hub: Submit draft ($1.03 USDcon → $1.015 USDhub)
    Hub--xR: Solver rejects (insufficient liquidity)
    end
```

### Outflow (Hub → Connected Chain)

Requester offers USDhub on hub, wants USDcon on connected chain.

```mermaid
sequenceDiagram
    participant R as Requester
    participant S as Solver
    participant Hub as Hub
    participant Con1 as Connected 1
    participant Con2 as Connected 2

    Note over Hub: R=$2, S=$2
    Note over Con1: R=$2, S=$2
    Note over Con2: R=$2, S=$2

    rect rgb(240, 248, 255)
    Note over R,Con2: Connected 1: $1 USDhub → $0.985 USDcon
    R->>Hub: Create intent + lock $1 USDhub (negotiated via coordinator)
    S->>Con1: Fulfill: $0.985 USDcon → Requester
    Hub->>S: Release escrow: $1 USDhub → Solver
    Note over Hub: R=$1, S=$3
    Note over Con1: R=$2.985, S=$1.015
    end

    rect rgb(240, 248, 255)
    Note over R,Con2: Connected 2: $1 USDhub → $0.985 USDcon
    R->>Hub: Create intent + lock $1 USDhub (negotiated via coordinator)
    S->>Con2: Fulfill: $0.985 USDcon → Requester
    Hub->>S: Release escrow: $1 USDhub → Solver
    Note over Hub: R=$0, S=$4
    Note over Con2: R=$2.985, S=$1.015
    end

    rect rgb(255, 240, 240)
    Note over R,Con2: Rejection: requester has $0 USDhub
    R->>Hub: Submit draft ($1.03 USDhub → $1.015 USDcon)
    Hub--xR: Solver rejects (insufficient liquidity)
    end
```

## Network Deployment

- [Supported Networks](./supported-networks.md) — Which networks are supported and deployment cost estimates
- [Network Deployment](../../testing-infra/networks/) — Deploy and configure scripts for testnet and mainnet
