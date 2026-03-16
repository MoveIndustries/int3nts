# TypeScript Requester SDK

Framework-agnostic TypeScript SDK for the int3nts cross-chain intent protocol (requester flow).

**Full documentation: [docs/sdk/](../../docs/sdk/README.md)**

## Quick Start

```bash
# Install (local development)
npm install

# Build
npm run build

# Run tests
npm test

# Type check
npm run typecheck
```

## Install

During development, the frontend consumes the SDK via a local file reference:

```json
{
  "dependencies": {
    "@int3nts/sdk": "file:../packages/sdk"
  }
}
```

## Peer Dependencies

The SDK requires the consumer to provide:

- `viem` ^2.0.0
- `@solana/web3.js` ^1.98.0
- `@solana/spl-token` ^0.4.0
