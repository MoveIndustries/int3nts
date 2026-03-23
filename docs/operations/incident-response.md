# Incident Response Runbook

Step-by-step procedures for responding to a security incident. Each section has concrete commands.

## 1. Identify and classify

Determine what was compromised:

| Compromised asset | Impact | Severity |
|---|---|---|
| Solver private key (any chain) | Attacker can fulfill intents, drain solver funds | High |
| Relay keypair | Attacker can forge GMP messages between chains | Critical |
| RPC API key | Attacker can make RPC calls on your quota | Low |
| Admin key (MVM/EVM/SVM) | Attacker can modify contract config, add/remove relays | Critical |

## 2. Contain — revoke access

Execute the relevant procedure based on what was compromised. Order matters: contain first, rotate second.

### Compromised relay keypair

1. **Deauthorize the relay on all chains** immediately — see [relay-deauthorization.md](relay-deauthorization.md) for per-chain commands.
2. **Stop the integrated-gmp service** to prevent the compromised key from being used if still running.
3. **Rotate the relay keypair** — see [key-rotation.md](key-rotation.md) (Integrated-GMP Relay Keypair). Register new relay, update env vars, restart service.

### Compromised solver key

1. **Stop the solver service.**
2. **Drain solver funds** on the compromised chain(s) — transfer native tokens and relevant ERC20/SPL tokens to a safe address.
3. **Deregister or rotate the solver** on MVM — see [solver-revocation.md](solver-revocation.md).
4. **Generate new keys** and reconfigure — see [key-rotation.md](key-rotation.md) (Solver sections).

### Compromised admin key

1. **Transfer contract ownership** (EVM) or rotate the admin profile (MVM/SVM) to a new key immediately.
2. **Audit recent admin actions**: check for unauthorized `addRelay`, `removeRelay`, `update_solver`, or config changes.
3. **Revert unauthorized changes** (re-add removed relays, remove unauthorized relays, etc.).

### Compromised RPC API key

1. **Revoke the key** in the provider dashboard (Alchemy, Infura, etc.).
2. **Generate a new key** and update config — see [key-rotation.md](key-rotation.md) (RPC API Keys).
3. **Restart affected services.**

## 3. Preserve evidence

Before cleaning up:

- Save service logs (structured JSON) covering the incident window. Correlation IDs in coordinator logs link related requests.
- Save on-chain transaction history for affected addresses.
- Note timestamps, affected intent IDs, and chain IDs.

## 4. Verify recovery

After containment and rotation:

- [ ] Compromised keys are revoked/deauthorized on all chains
- [ ] New keys are registered and services are running
- [ ] GMP message delivery works end-to-end (relay a test message)
- [ ] Solver can fulfill an intent on each chain (or is intentionally stopped)
- [ ] No unauthorized entries remain in relay registries or solver registry

## 5. Post-mortem

After the incident is resolved:

1. Document the timeline: detection, containment, recovery.
2. Identify the root cause (key leak, compromised host, insider, etc.).
3. Determine what monitoring or process changes would catch this faster.
4. Update this runbook if procedures were missing or incorrect.
