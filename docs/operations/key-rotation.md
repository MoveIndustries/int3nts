# Key Rotation

Procedures for rotating secrets used by the int3nts services. Each section covers what the key is, where it lives, how to rotate it, and what to verify afterwards.

## Integrated-GMP Relay Keypair

The relay holds an Ed25519 keypair that derives addresses on all three chain types:

- **MVM**: `sha3_256(ed25519_pubkey || 0x00)` — registered via `intent_gmp::add_relay` on hub and each connected MVM chain
- **EVM**: `keccak256(secp256k1_pubkey)[12:]` — derived from the same 32-byte seed as a secp256k1 key, registered via `IntentGmp.addRelay(address)` on each EVM chain
- **SVM**: `base58(ed25519_pubkey)` — registered via `intent_escrow_cli gmp-add-relay` on each SVM chain

### Where configured

- **Environment variables**: `INTEGRATED_GMP_PRIVATE_KEY` (base64-encoded 32-byte Ed25519 seed) and `INTEGRATED_GMP_PUBLIC_KEY` (base64-encoded Ed25519 public key). Variable names are configurable in the TOML via `integrated_gmp.private_key_env` / `integrated_gmp.public_key_env`.

### How to rotate

1. **Generate a new Ed25519 keypair.** Any tool that produces a 32-byte seed and corresponding public key works. Base64-encode both.
2. **Derive the new relay addresses** for each chain type. Use `integrated-gmp/src/bin/get_relay_addresses.rs` (set the new env vars and run it) to get the MVM, EVM, and SVM addresses.
3. **Register the new relay on every chain** (before deauthorizing the old one):
   - MVM hub + each connected MVM chain: `intent_gmp::add_relay(admin, relay_addr)`
   - Each EVM chain: `IntentGmp.addRelay(newEthAddress)` (owner-only)
   - Each SVM chain: `intent_escrow_cli gmp-add-relay`
4. **Update the environment variables** on the relay host with the new key pair.
5. **Restart the integrated-gmp service.** It verifies the public key matches the private key on startup.
6. **Verify delivery works** by checking that new GMP messages are relayed successfully (monitor logs for delivery confirmations).
7. **Deauthorize the old relay** on every chain:
   - MVM: `intent_gmp::remove_relay(admin, old_relay_addr)`
   - EVM: `IntentGmp.removeRelay(oldEthAddress)`
   - SVM: `intent_escrow_cli gmp-remove-relay`

### Zero-downtime notes

Steps 3-5 allow overlap: the old relay keeps running while the new one is registered. After step 5, only the new key is active. Deauthorize the old key (step 7) after confirming the new relay is delivering successfully.

## Solver EVM Private Key

The solver signs EVM transactions (outflow fulfillment) using a private key loaded from an environment variable.

### Where configured

- **TOML field**: `connected_chain.evm.private_key_env` — names the environment variable (e.g., `"SOLVER_EVM_PRIVATE_KEY"`)
- **Environment variable**: contains the raw hex private key

### How to rotate

1. **Generate a new EVM keypair.** Note the new address.
2. **Fund the new address** with native gas tokens and any ERC20 tokens the solver needs for fulfillment.
3. **Update the environment variable** on the solver host.
4. **Restart the solver service.**
5. **Verify** by checking that the next outflow fulfillment succeeds (monitor logs).

### On-chain impact

The solver's EVM address is not registered on-chain in a registry — it just needs funds. No contract updates required.

## Solver SVM Private Key

The solver signs Solana transactions (outflow fulfillment) using a private key loaded from an environment variable.

### Where configured

- **TOML field**: `connected_chain.svm.private_key_env` — names the environment variable
- **Environment variable**: contains the base58-encoded keypair

### How to rotate

1. **Generate a new Solana keypair** (`solana-keygen new`).
2. **Fund the new address** with SOL and any SPL tokens the solver needs.
3. **Update the environment variable** on the solver host.
4. **Restart the solver service.**
5. **Verify** by checking that the next outflow fulfillment succeeds.

### On-chain impact

Same as EVM — the solver address is not registered in a contract. It just needs funds.

## Solver MVM Profile

The solver uses a Movement/Aptos CLI profile for MVM transactions.

### Where configured

- **TOML fields**: `hub_chain.profile` and `connected_chain.mvm.profile` — CLI profile names
- **Key storage**: managed by the Movement/Aptos CLI in `~/.aptos/config.yaml`

### How to rotate

1. **Create a new CLI profile** with `aptos init --profile <new-profile>` (or `movement init`).
2. **Fund the new account** on both hub and connected MVM chains.
3. **Update the TOML** with the new profile name and address.
4. **Restart the solver service.**
5. **Verify** by checking that the next hub/MVM fulfillment succeeds.

## RPC API Keys

If RPC URLs contain embedded API keys (e.g., `https://eth-mainnet.g.alchemy.com/v2/<API_KEY>`), rotation is straightforward:

1. **Generate a new API key** in the provider dashboard (Alchemy, Infura, etc.).
2. **Update the `rpc_url` field** in the relevant TOML config file.
3. **Restart the affected service(s).**
4. **Revoke the old API key** in the provider dashboard after confirming the service is working.
