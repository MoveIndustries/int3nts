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
| Retry/backoff | Done (integrated-gmp + solver) |
| Multiple RPC endpoints | Skipped (infra-level concern) |
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

- [x] **3a. Signature replay test** — N/A for coordinator. Coordinator is a mailbox: it stores signature bytes without cryptographic verification. Replay prevention is enforced on-chain (Move VM verifies signature against intent data). Adding crypto verification to the coordinator would change its architecture.
- [x] **3b. Expired draft signing test** — `test_draft_creation_rejected_for_past_expiry` in `auth_hardening_tests.rs`. Coordinator rejects draft creation with past expiry_time. Storage-level expiry-on-sign tested in `storage_tests::test_signature_expired_draft`.
- [x] **3c. Out-of-order call test** — `test_signature_rejected_for_nonexistent_draft` in `auth_hardening_tests.rs`. Handler returns error when draft doesn't exist.
- [x] **3d. Concurrent FCFS test** — `test_fcfs_second_solver_rejected_via_http` in `auth_hardening_tests.rs`. First signature succeeds (200), second gets 409 Conflict.
- [x] **3e. Forged signer test** — `test_signature_rejected_for_unregistered_solver` in `auth_hardening_tests.rs`. Mock MVM returns error for unregistered solver; handler rejects.
- [x] **3f. GMP message auth audit** — All three chains verified: (1) Relay authorization: MVM `is_authorized_relay`, EVM `authorizedRelays[msg.sender]`, SVM `gmp_caller.is_signer`. (2) Remote endpoint address: all three check `src_chain_id` and `remote_gmp_endpoint_addr` against stored config. (3) Idempotency: MVM/EVM use dedupe keys (intent_id + msg_type), SVM checks `data_len > 0` / `fulfilled` flag. No gaps.

`/review-me` → `/commit`

### 4. Logging Infrastructure (checklist §4)

- [x] **4a. Structured JSON logging** — All three services (coordinator, integrated-gmp, solver) now use `tracing_subscriber::fmt().json().init()`. `tracing-subscriber` Cargo.toml entries updated with `features = ["json"]`. Structured fields (`action`, `draft_id`, `intent_id`, `chain_id`, `solver_addr`, etc.) added to key log lines.
- [x] **4b. Correlation IDs** — Coordinator API wraps every request in a `warp::trace` span containing a UUID v4 `request_id`, plus `method` and `path`. All log lines within a request inherit these fields automatically. Added `uuid` crate dependency.
- [x] **4c. Sensitive action logging** — Coordinator handlers: draft creation, idempotent return, signature submission, FCFS acceptance/rejection all log with structured fields. Integrated-GMP: added EVM polling idle/event-count/dedupe logging (matching existing MVM/SVM coverage). Solver: added `add_signed_intent` tracker entry logging, and full entry/success/failure logging for connected EVM client operations (transfer, outflow fulfillment).

`/review-me` → `/commit`

### 5. 3rd Party Resilience (checklist §5)

- [x] **5a. Retry with backoff** — Already implemented. Integrated-GMP: `DeliveryAttempt` with 3 retries, 5s initial exponential backoff, permanent-error detection (`should_attempt_delivery` / `record_delivery_failure`). Solver: `record_outflow_failure` with 3 retries, exponential backoff, `Failed` state transition. Polling loops naturally re-read on each iteration so transient RPC blips just waste one 2-second cycle.
- [x] **5b. Multiple RPC endpoints** — Skipped. Overkill for current stage. Single endpoint per chain is sufficient; multi-endpoint failover is infrastructure-level concern.

`/review-me` → `/commit`

### 6. Secrets Management (checklist §6)

- [x] **6a. .env.example files** — Skipped. No component loads `.env` from repo root (no dotenv/dotenvy in Rust, no dotenv in JS). Existing `.env` files are component-specific (`evm/.env`, `frontend/.env.local`, `testing-infra/networks/`). A root `.env.example` wouldn't be consumed by anything.
- [x] **6b. Key rotation documentation** — `docs/operations/key-rotation.md` covers integrated-GMP Ed25519 keypair (with on-chain relay re-registration), solver EVM/SVM private keys, solver MVM profile, and RPC API keys.

`/review-me` → `/commit`

### 7. Breach Response Plan (checklist §7)

- [ ] **7a. Solver revocation procedure** — Document and verify: how to remove a solver from `solver_registry.move` on-chain. Test on devnet.
- [ ] **7b. Relay deauthorization procedure** — Document and verify: how to remove a relay from GMP endpoint registries (MVM, EVM, SVM). Test on devnet.
- [ ] **7c. Incident response runbook** — Write runbook with concrete commands for each step (revoke, rotate, notify). Add to `docs/operations/`.

`/review-me` → `/commit`

### 8. Cleanup

- [ ] **8a. Delete plan and checklist** — Remove `docs/architecture/plan/plan.md`, `docs/architecture/security-checklist.md`, and their references in `docs/architecture/README.md`.

`/review-me` → `/commit`
