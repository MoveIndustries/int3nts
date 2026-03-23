# Security Hardening Plan

Implements the [security checklist](../security-checklist.md). Each task maps to a checklist item.

## Workflow

Before starting each task: explain what it does and which files it touches, then wait for approval.
After each task: `/review-me` → `/commit`.

## Current State

| Area | Status |
| ---- | ------ |
| Rate limiting | Missing |
| Idempotency keys | Missing |
| Input validation | Partial (signature format only) |
| Structured JSON logging | Missing (plaintext tracing only) |
| Correlation IDs | Missing |
| Retry/backoff | Missing |
| Multiple RPC endpoints | Missing (single endpoint per chain) |
| .gitignore | Done |
| Hardcoded secrets | None found |

## Tasks

### 1. Endpoint Abuse Prevention (checklist §1)

- [x] **1a. Rate limiting middleware** — Skipped. Coordinator is an internal service; rate limiting belongs at the infrastructure edge (AWS ALB, etc.), not in the application.
- [x] **1b. Idempotency via deterministic draft ID** — Draft ID is now SHA-256 of `(requester_addr, draft_data, expiry_time)`. Same request = same ID. If the ID already exists in the store, the existing draft is returned instead of creating a duplicate.
- [x] **1c. Input validation hardening** — Coordinator validates `requester_addr` (0x-prefixed hex) and `expiry_time` (must be in the future). `draft_data` validation left to the solver (coordinator is just a mailbox).

`/review-me` → `/commit`

### 2. Client Trust Elimination (checklist §2)

- [x] **2a. Audit MVM contracts** — No gaps. All 35+ public entry functions have proper signer checks (admin `@mvmt_intent`, solver Ed25519 signatures, token withdrawal, relay authorization).
- [x] **2b. Audit EVM contracts** — No gaps in production contracts. All state-changing functions have `onlyOwner`/`onlyGmpEndpoint`/`msg.sender` checks. `MockERC20.mint()` is unrestricted (test-only, intentional).
- [x] **2c. Audit SVM programs** — Fixed: `process_gmp_receive` in `intent-outflow-validator` was missing `is_signer` check on `gmp_caller`. Added check + `UnauthorizedGmpSource` error variant, matching inflow escrow's pattern.
- [x] **2d. Audit solver** — Signing keys correct (always from config/env, never request data). No runtime solver-authorization filter on drafts (FCFS design — not a bug, see coordinator `Draftintent` doc: "open to any solver, first to sign wins").

`/review-me` → `/commit`

### 3. Auth Hardening (checklist §3)

- [ ] **3a. Signature replay test** — Write test: reuse a valid solver signature on a different draft. Must be rejected.
- [ ] **3b. Expired draft signing test** — Write test: submit signature after draft expiry. Must be rejected.
- [ ] **3c. Out-of-order call test** — Write test: submit signature for non-existent draft. Must return 404.
- [ ] **3d. Concurrent FCFS test** — Write test: two solvers race to sign the same draft. Exactly one succeeds.
- [ ] **3e. Forged signer test** — Write test: signature from unregistered key. Must be rejected.
- [ ] **3f. GMP message auth audit** — Verify all GMP endpoints (MVM, EVM, SVM) check relay authorization, remote endpoint address, and message idempotency.

`/review-me` → `/commit`

### 4. Logging Infrastructure (checklist §4)

- [ ] **4a. Structured JSON logging** — Replace `tracing_subscriber::fmt::init()` in coordinator, integrated-gmp, and solver with `tracing_subscriber::fmt().json().init()`. Add structured fields (`intent_id`, `chain_id`, `action`) to key log lines.
- [ ] **4b. Correlation IDs** — Generate a `request_id` (UUID) at coordinator API entry. Attach as tracing span field. Propagate to integrated-gmp calls.
- [ ] **4c. Sensitive action logging** — Ensure all critical paths log: draft creation, signature submission, escrow creation, GMP message delivery, fulfillment, claim, refund.

`/review-me` → `/commit`

### 5. 3rd Party Resilience (checklist §5)

- [ ] **5a. Retry with backoff** — Add exponential backoff to all RPC calls in integrated-gmp chain pollers and solver outflow submissions. Use `backoff` crate. Max 3 retries, 100ms initial, 10s max, 2x factor.
- [ ] **5b. Multiple RPC endpoints** — Extend `ChainConfig`, `EvmChainConfig`, `SvmChainConfig` to accept `rpc_urls: Vec<String>`. Fail over to next URL on connection error.

`/review-me` → `/commit`

### 6. Secrets Management (checklist §6)

- [ ] **6a. .env.example files** — Create `.env.example` at repo root documenting all expected environment variables (with placeholder values). Reference from README.
- [ ] **6b. Key rotation documentation** — Document rotation steps for integrated-gmp operator key, solver keys, and RPC API keys. Add to `docs/operations/` or similar.

`/review-me` → `/commit`

### 7. Breach Response Plan (checklist §7)

- [ ] **7a. Solver revocation procedure** — Document and verify: how to remove a solver from `solver_registry.move` on-chain. Test on devnet.
- [ ] **7b. Relay deauthorization procedure** — Document and verify: how to remove a relay from GMP endpoint registries (MVM, EVM, SVM). Test on devnet.
- [ ] **7c. Incident response runbook** — Write runbook with concrete commands for each step (revoke, rotate, notify). Add to `docs/operations/`.

`/review-me` → `/commit`

### 8. Cleanup

- [ ] **8a. Delete this plan** — Remove `docs/architecture/plan/security-hardening.md`.

`/review-me` → `/commit`
