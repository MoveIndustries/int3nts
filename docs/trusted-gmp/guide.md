# Integrated GMP – Usage Guide

This guide covers how to configure and run the integrated-gmp relay service.

## Overview

The integrated-gmp service is a integrated GMP relay — it watches for `MessageSent` events on source chains and delivers messages to destination chains. It is invisible to clients; the coordinator is the single API surface.

## Configuration

File: `integrated-gmp/config/integrated-gmp.toml` (relative to project root)

### Operator Wallet Keys

The relay needs operator wallet keys for each chain to submit `deliver_message` transactions:

- **MVM**: Movement account private key
- **EVM**: Ethereum private key
- **SVM**: Solana keypair

**Security Warning**: The configuration file contains sensitive private keys. Protect this file with appropriate file system permissions and never commit it to version control.

### Running

```bash
# Default (local config)
cargo run --bin integrated-gmp

# Testnet config
cargo run --bin integrated-gmp -- --testnet

# Custom config path
cargo run --bin integrated-gmp -- --config path/to/config.toml
```

Environment variable `INTEGRATED_GMP_CONFIG_PATH` overrides all flags.

## GMP Message Flow

The relay handles three GMP message types:

1. **IntentRequirements** — hub → connected chain: delivers intent requirements after intent creation
2. **EscrowConfirmation** — connected chain → hub: confirms escrow was created on connected chain
3. **FulfillmentProof** — hub → connected chain: proves fulfillment happened on hub, triggers escrow release

## Debugging

- Check relay logs for `MessageSent` event detection and `deliver_message` submissions
- Verify GMP endpoint contracts are deployed and configured with correct remote GMP endpoints
- Ensure operator wallet has sufficient funds on each chain for gas
