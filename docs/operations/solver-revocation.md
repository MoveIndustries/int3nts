# Solver Revocation

Procedures for removing a solver from the on-chain registry and stopping it from fulfilling intents.

## MVM Solver Registry

The `solver_registry.move` module on the MVM hub manages solver registrations. The registry is permissionless: solvers self-register and self-deregister. There is no admin-override function to forcibly remove a solver.

### Deregistration (solver-initiated)

The solver calls `deregister_solver` using its own account:

```bash
movement move run \
  --function-id '<hub_addr>::solver_registry::deregister_solver' \
  --profile <solver_profile>
```

This removes the solver's `SolverInfo` (Ed25519 public key, chain addresses) from the registry and emits a `SolverDeregistered` event.

### Verification

```bash
movement move view \
  --function-id '<hub_addr>::solver_registry::is_registered' \
  --args 'address:<solver_addr>'
```

Returns `false` after successful deregistration.

### Limitation: no admin removal

`deregister_solver` requires the solver's own signer. If the solver key is compromised, the attacker holds the only key that can deregister. Mitigations:

1. **Rotate the solver key first** (see [key-rotation.md](key-rotation.md) — Solver MVM Profile). Call `update_solver` from the compromised account to replace the Ed25519 public key with a known-good one, then deregister. This only works if you still control the account's auth key.
2. **On-chain signature rejection**: even if the solver remains registered, the intent contracts verify Ed25519 signatures against the registered public key. If you can rotate the public key via `update_solver`, the compromised private key becomes useless for signing intents.
3. **Freeze the service**: stop the solver binary and revoke its EVM/SVM keys (below) so it cannot fulfill outflows on any chain, even if it remains in the MVM registry.

> **Gap**: there is no `admin_remove_solver` function. If the solver account's auth key is also compromised (attacker can sign MVM transactions as the solver), the only recourse is freezing downstream chain keys and deploying a contract upgrade that adds admin removal.

## EVM and SVM Solver Keys

The solver's EVM and SVM addresses are not registered in on-chain registries — they just need funds to submit transactions. Revocation means draining or freezing them:

### EVM

1. **Transfer remaining funds** out of the solver's EVM address to a safe address using a wallet or CLI.
2. **Update the environment variable** (`SOLVER_EVM_PRIVATE_KEY` or whatever `private_key_env` is set to) to a new key, or remove it entirely.
3. **Restart the solver service** (or stop it).

### SVM

1. **Transfer remaining SOL and SPL tokens** out of the solver's Solana address.
2. **Update the environment variable** to a new keypair, or remove it.
3. **Restart the solver service** (or stop it).

## Verifying full revocation

After revoking across all chains, confirm:

- [ ] `solver_registry::is_registered` returns `false` (or public key has been rotated)
- [ ] Solver EVM address has zero balance (native + relevant ERC20s)
- [ ] Solver SVM address has zero balance (SOL + relevant SPL tokens)
- [ ] Solver service is stopped or restarted with new keys
