# SVM Intent Framework Scripts

Scripts for building, testing, deploying, and initializing the SVM Intent Framework.

## Deployment Workflow

```text
build.sh → deploy.sh → initialize.sh → initialize-gmp.sh
```

1. `build.sh` — compile all 3 Solana programs
2. `deploy.sh` — deploy all 3 programs to a validator
3. `initialize.sh` — initialize escrow with approver pubkey
4. `initialize-gmp.sh` — initialize GMP endpoint, outflow validator, escrow GMP config, and routing

## Scripts

### `build.sh`

Builds the native Solana program with workarounds for Solana CLI 2.x compatibility.

```bash
./scripts/build.sh
```

### `test.sh`

Builds and runs the Rust test suite using `solana-program-test`.

```bash
./scripts/test.sh
```

### `deploy.sh`

Builds and deploys all 3 Solana programs (intent_inflow_escrow, intent_gmp, intent_outflow_validator) to a local validator or configured RPC.

```bash
./scripts/deploy.sh
```

Environment variables:

- `SOLANA_URL` (optional, default `http://localhost:8899`)
- `PROGRAM_KEYPAIR` (optional, default `target/deploy/intent_inflow_escrow-keypair.json`)
- `PROGRAM_SO` (optional, default `target/deploy/intent_inflow_escrow.so`)
- `GMP_KEYPAIR` (optional, default `target/deploy/intent_gmp-keypair.json`)
- `GMP_SO` (optional, default `target/deploy/intent_gmp.so`)
- `OUTFLOW_KEYPAIR` (optional, default `target/deploy/intent_outflow_validator-keypair.json`)
- `OUTFLOW_SO` (optional, default `target/deploy/intent_outflow_validator.so`)

### `initialize.sh`

Initializes the program state with a approver pubkey.

```bash
./scripts/initialize.sh
```

Required environment variables:

- `SVM_APPROVER_PUBKEY` (required)
- `SVM_PROGRAM_ID` (optional, default is the built-in program id)
- `SVM_RPC_URL` (optional, default `http://localhost:8899`)
- `SVM_PAYER_KEYPAIR` (optional, default `~/.config/solana/id.json`)

### `initialize-gmp.sh`

Initializes GMP endpoint, outflow validator, escrow GMP config, and message routing. Run after `deploy.sh` and `initialize.sh`.

```bash
./scripts/initialize-gmp.sh
```

Required environment variables:

- `SVM_PROGRAM_ID` (required) — escrow program ID
- `SVM_GMP_ENDPOINT_ID` (required) — GMP endpoint program ID
- `SVM_OUTFLOW_VALIDATOR_ID` (required) — outflow validator program ID
- `SVM_CHAIN_ID` (required) — this chain's ID (e.g., `4`)
- `HUB_MODULE_ADDR` (required) — hub module address (64-char hex)
- `HUB_CHAIN_ID` (optional, default `1`)
- `SVM_RELAY_PUBKEY` (optional) — relay pubkey (base58) to authorize
- `SVM_RPC_URL` (optional, default `http://localhost:8899`)
- `SVM_PAYER_KEYPAIR` (optional, default `~/.config/solana/id.json`)

### `create-escrow.sh`

Creates a new escrow and deposits tokens atomically.

```bash
./scripts/create-escrow.sh
```

Required environment variables:

- `USD_SVM_MINT_ADDR` (required)
- `SVM_REQUESTER_TOKEN` (required)
- `SVM_SOLVER_PUBKEY` (required)
- `SVM_INTENT_ID` (required, hex)
- `SVM_AMOUNT` (required)
- `SVM_EXPIRY` (optional, seconds)
- `SVM_PROGRAM_ID` (optional)
- `SVM_RPC_URL` (optional)
- `SVM_PAYER_KEYPAIR` (optional)
- `SVM_REQUESTER_KEYPAIR` (optional, default `SVM_PAYER_KEYPAIR`)

### `claim-escrow.sh`

Claims escrow funds using a approver signature.

```bash
./scripts/claim-escrow.sh
```

Required environment variables:

- `SVM_SOLVER_TOKEN` (required)
- `SVM_INTENT_ID` (required, hex)
- `SVM_SIGNATURE_HEX` (required, 64-byte signature hex)
- `SVM_PROGRAM_ID` (optional)
- `SVM_RPC_URL` (optional)
- `SVM_PAYER_KEYPAIR` (optional)

### `cancel-escrow.sh`

Cancels an escrow and returns funds to the requester after expiry.

```bash
./scripts/cancel-escrow.sh
```

Required environment variables:

- `SVM_REQUESTER_TOKEN` (required)
- `SVM_INTENT_ID` (required, hex)
- `SVM_PROGRAM_ID` (optional)
- `SVM_RPC_URL` (optional)
- `SVM_PAYER_KEYPAIR` (optional)
- `SVM_REQUESTER_KEYPAIR` (optional, default `SVM_PAYER_KEYPAIR`)

### `get-escrow.sh`

Reads the escrow account state by intent ID.

```bash
./scripts/get-escrow.sh
```

Required environment variables:

- `SVM_INTENT_ID` (required, hex)
- `SVM_PROGRAM_ID` (optional)
- `SVM_RPC_URL` (optional)

### `get-token-balance.sh`

Reads the SPL token account balance.

```bash
./scripts/get-token-balance.sh
```

Required environment variables:

- `SVM_TOKEN_ACCOUNT` (required)
- `SVM_RPC_URL` (optional)

## Requirements

- **Nix** - for `build.sh`, `test.sh`, and CLI scripts

## Troubleshooting

### Cargo.lock issues

```bash
cd intent-frameworks/svm
rm Cargo.lock
cargo generate-lockfile
cargo update -p constant_time_eq --precise 0.3.1
cargo update -p blake3 --precise 1.5.0
```
