# Testing Infrastructure

Infrastructure for local CI testing and network (testnet/mainnet) deployment.

## CI/E2E Tests

Local testing using Docker containers (`ci-e2e/`):

- **[Move VM E2E Tests](./ci-e2e/e2e-tests-mvm/README.md)** - MVM-only cross-chain intents (Chain 1 → Chain 2)
- **[EVM E2E Tests](./ci-e2e/e2e-tests-evm/README.md)** - Mixed-chain intents (MVM Chain 1 → EVM Chain 3)
- **[SVM E2E Tests](./ci-e2e/e2e-tests-svm/README.md)** - Mixed-chain intents (MVM Chain 1 → SVM Chain 4)

**Full documentation: [docs/testing-infra/](../docs/testing-infra/README.md)**

## Network Deployment

Deploy and configure scripts live under `networks/`, organized by network and shared logic:

- **[networks/testnet/](./networks/testnet/README.md)** - Testnet deployment (Movement Bardock, Base Sepolia, Solana Devnet)
- **networks/mainnet/** - Mainnet deployment (Movement Mainnet, Base Mainnet, HyperEVM Mainnet)
- **networks/common/** - Shared scripts and utilities sourced by both testnet and mainnet wrappers
