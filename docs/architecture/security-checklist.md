# Security Hardening Checklist

This checklist provides a comprehensive security review guide for the Intent Framework. Each area should be reviewed and hardened before production deployment.

**Total Estimated Time: ~1.5 weeks**

---

## Overview

| # | Area | Time Est | Priority |
|---|------|----------|----------|
| 1 | Endpoint Abuse Prevention | 1.5 days | High |
| 2 | Client Trust Elimination | 1 day | High |
| 3 | Auth Hardening | 1.5 days | High |
| 4 | Logging Infrastructure | 1.5 days | Medium |
| 5 | 3rd Party Resilience | 1 day | Medium |
| 6 | Secrets Management | 0.5 day | High |
| 7 | Breach Response Plan | 1 day | Medium |

---

## 1. Endpoint Abuse Prevention

**Time: 1.5 days** | **Components: Coordinator API, Solver endpoints**

Assume every endpoint will be abused. Attackers don't follow happy paths.

### Requirements

- [x] **Rate Limiting**: Skipped — coordinator is an internal service; rate limiting belongs at the infrastructure edge (AWS ALB, etc.), not in the application

- [x] **Idempotency for Writes**: Draft ID is SHA-256 of `(requester_addr, draft_data, expiry_time)`. Same request = same ID. Existing draft returned instead of creating a duplicate.

- [x] **Server-Side Validation Only**: Coordinator validates `requester_addr` (0x-prefixed hex) and `expiry_time` (must be in the future). `draft_data` validation left to the solver (coordinator is a mailbox).

### Components to Review

| Component | File/Module | Checks |
|-----------|-------------|--------|
| Coordinator API | `coordinator/src/api/` | Rate limits, input validation |
| Draft Intent Endpoint | `POST /draftintent` | Idempotency, rate limiting |
| Signature Endpoint | `POST /draftintent/:id/signature` | FCFS protection, replay prevention |
| EVM Inflow Escrow | `intent-frameworks/evm/contracts/IntentInflowEscrow.sol` | Input validation, deposit bounds |
| EVM Outflow Validator | `intent-frameworks/evm/contracts/IntentOutflowValidator.sol` | Input validation, fulfillment replay |
| EVM GMP Endpoint | `intent-frameworks/evm/contracts/IntentGmp.sol` | Message validation |
| SVM Inflow Escrow | `intent-frameworks/svm/programs/intent_inflow_escrow/` | Input validation, deposit bounds |
| SVM Outflow Validator | `intent-frameworks/svm/programs/intent-outflow-validator/` | Input validation, fulfillment replay |
| SVM GMP Endpoint | `intent-frameworks/svm/programs/intent-gmp/` | Message validation |

---

## 2. Client Trust Elimination

**Time: 1 day** | **Components: Contracts, Integrated GMP relay**

Frontend checks are for UX, not security. All security checks must be server-side.

### Requirements

- [x] **Server-Side Permission Checks**: Audited all three VMs. All 35+ MVM public entry functions have proper signer checks. All EVM state-changing functions have `onlyOwner`/`onlyGmpEndpoint`/`msg.sender` checks. SVM `process_gmp_receive` fixed — was missing `is_signer` check on `gmp_caller`.

- [x] **Server-Side Ownership Validation**: Solver signing keys always from config/env, never request data. No runtime solver-authorization filter on drafts (FCFS design — open to any solver, first to sign wins).

### Anti-Patterns to Eliminate

```text
❌ "The button is hidden" - not a security strategy
❌ "Frontend validates the input" - bots ignore this
❌ "Only authorized users see this page" - URL is guessable
```

### Components to Review

| Component | File | Checks |
| --------- | ---- | ------ |
| MVM Hub Contracts | `intent-frameworks/mvm/intent-hub/sources/` | `signer` verification, ownership checks |
| MVM Connected Contracts | `intent-frameworks/mvm/intent-connected/sources/` | `signer` verification, ownership checks |
| EVM Inflow Escrow | `intent-frameworks/evm/contracts/IntentInflowEscrow.sol` | Escrow ownership, claim authorization |
| EVM Outflow Validator | `intent-frameworks/evm/contracts/IntentOutflowValidator.sol` | Fulfillment authorization |
| EVM GMP Endpoint | `intent-frameworks/evm/contracts/IntentGmp.sol` | Relay authorization, remote endpoint verification |
| SVM Inflow Escrow | `intent-frameworks/svm/programs/intent_inflow_escrow/` | Escrow ownership, claim authorization |
| SVM Outflow Validator | `intent-frameworks/svm/programs/intent-outflow-validator/` | Fulfillment authorization |
| SVM GMP Endpoint | `intent-frameworks/svm/programs/intent-gmp/` | Relay authorization, remote endpoint verification |
| Solver | `solver/` | Transaction signing, permission checks |

---

## 3. Auth Hardening

**Time: 1.5 days** | **Components: GMP endpoint auth, relay authorization**

Auth working once doesn't mean auth is safe. Test edge cases.

### Test Scenarios

- [x] **Signature Replay**: N/A for coordinator (mailbox only — on-chain Move VM verifies signatures)
- [x] **Expired Draft Signing**: Tested in `auth_hardening_tests.rs` — coordinator rejects draft creation with past expiry
- [x] **Out-of-Order Calls**: Tested in `auth_hardening_tests.rs` — handler returns error when draft doesn't exist
- [x] **Concurrent FCFS**: Tested in `auth_hardening_tests.rs` — first signature succeeds (200), second gets 409 Conflict
- [x] **Forged Signer**: Tested in `auth_hardening_tests.rs` — mock MVM returns error for unregistered solver

### GMP Message Authentication Hardening

- [x] Verify relay is authorized on GMP endpoint before delivering messages — MVM `is_authorized_relay`, EVM `authorizedRelays[msg.sender]`, SVM `gmp_caller.is_signer`
- [x] Check remote GMP endpoint address matches expected source — all three check `src_chain_id` and `remote_gmp_endpoint_addr` against stored config
- [x] Prevent message replay across different intents (idempotency) — MVM/EVM use dedupe keys (intent_id + msg_type), SVM checks `data_len > 0` / `fulfilled` flag
- [x] Validate GMP message payload covers all relevant fields

### Components to Review

| Component | File | Checks |
|-----------|------|--------|
| Solver Registry | `intent-frameworks/mvm/intent-hub/sources/solver_registry.move` | Public key management |
| GMP Endpoint (Hub) | `intent-frameworks/mvm/intent-hub/sources/gmp/intent_gmp.move` | Relay authorization, remote endpoint verification |
| GMP Endpoint (Connected) | `intent-frameworks/mvm/intent-connected/sources/gmp/intent_gmp.move` | Relay authorization, remote endpoint verification |
| Intent Creation | `fa_intent_inflow.move`, `fa_intent_outflow.move` | Solver signature verification |
| EVM GMP Endpoint | `intent-frameworks/evm/contracts/IntentGmp.sol` | Relay authorization, remote endpoint verification |
| SVM GMP Endpoint | `intent-frameworks/svm/programs/intent-gmp/` | Relay authorization, remote endpoint verification |

---

## 4. Logging Infrastructure

**Time: 1.5 days** | **Components: Integrated GMP relay, Solver**

No logs means no answers. Not for bugs, not for breaches, not for refunds.

### Requirements

- [x] **Structured Logging**: All three services (coordinator, integrated-gmp, solver) use `tracing_subscriber::fmt().json().init()` with structured fields (`action`, `draft_id`, `intent_id`, `chain_id`, `solver_addr`, etc.)

- [x] **Sensitive Action Logging**: Draft creation, idempotent return, signature submission, FCFS acceptance/rejection, EVM polling, GMP delivery, solver tracker entries — all logged with structured fields

- [x] **Correlation IDs**: Coordinator API wraps every request in a `warp::trace` span with UUID v4 `request_id`, `method`, and `path`. All log lines within a request inherit these fields.

### Log Retention

| Log Type | Retention | Purpose |
|----------|-----------|---------|
| Security events | 1 year | Audit, compliance |
| Transaction logs | 6 months | Debugging, disputes |
| Debug logs | 7 days | Development |

---

## 5. 3rd Party Resilience

**Time: 1 day** | **Components: Chain RPC calls, GMP providers**

Third-party services will fail. Design for it.

### Requirements

- [x] **Retries with Limits**: Exponential backoff implemented
  - Integrated-GMP: `DeliveryAttempt` — 3 retries, 5s initial, 2x factor per message delivery
  - Solver: `record_outflow_failure` — 3 retries, exponential backoff, transitions to Failed state
  - Polling loops naturally retry on next cycle (2s interval)

- [x] **Redundant Providers**: Skipped — single endpoint per chain is sufficient at current stage; multi-endpoint failover is an infrastructure-level concern

- [x] **Resumable Flows**: Already implemented
  - Integrated-GMP: nonce-based polling resumes from last processed nonce; failed deliveries are retried with backoff across poll cycles
  - Solver: intent state machine (Created → outflow_attempted → Fulfilled/Failed) with per-intent retry tracking; each step either succeeds or fails explicitly

### Failure Scenarios to Handle

| Service | Failure Mode | Mitigation |
|---------|--------------|------------|
| Chain RPC | Timeout, rate limit | Multiple providers, caching |
| GMP Provider | Message delay | Timeout handling, retry |
| Integrated GMP relay | Unavailable | Queue pending messages |

---

## 6. Secrets Management

**Time: 0.5 day** | **Components: All**

API keys in code will leak. Not maybe. Will.

### Requirements

- [ ] **Environment Variables**: Use `.env` files
  - Never commit secrets to git
  - Use `.env.example` for documentation
  - Different secrets per environment

- [ ] **Proper .gitignore**: Exclude sensitive files

  ```text
  .env
  .env.local
  .env.*.local
  *.pem
  *.key
  config/secrets/
  ```

- [ ] **Server-Side Only**: Never expose secrets to client
  - No API keys in frontend code
  - No private keys in browser
  - No secrets in client-side config

- [ ] **Key Rotation Procedures**: Document and practice
  - How to rotate each key type
  - Automation where possible
  - Zero-downtime rotation

### Secrets Inventory

| Secret | Location | Rotation Frequency |
|--------|----------|-------------------|
| Integrated GMP operator wallet key | `.env` | Quarterly |
| Chain RPC API keys | `.env` | On compromise |
| Solver private keys | Secure storage | As needed |

---

## 7. Breach Response Plan

**Time: 1 day** | **Components: Documentation + tooling**

The question is not if but when. Be prepared.

### Immediate Response Capabilities

- [ ] **Fast Access Revocation**
  - Disable compromised API keys instantly
  - Revoke solver authorizations
  - Pause contract operations (if pausable)

- [ ] **Key Rotation Under Pressure**
  - Document rotation steps for each key
  - Have backup keys pre-generated
  - Test rotation in non-production

- [ ] **Relay Deauthorization**
  - Remove compromised relay from on-chain registry
  - Verify remaining relays still meet verification threshold
  - Re-attest pending messages with authorized relays

### Communication Plan

- [ ] **User Notification Template**: Pre-written incident disclosure
- [ ] **Internal Escalation Path**: Who to contact, in what order
- [ ] **Public Communication**: Status page, social media

### Incident Response Runbook

| Step | Action | Owner |
|------|--------|-------|
| 1 | Identify scope of breach | Security |
| 2 | Contain - revoke access | Engineering |
| 3 | Preserve evidence | Security |
| 4 | Rotate compromised secrets | Engineering |
| 5 | Assess user impact | Product |
| 6 | Notify affected users | Communications |
| 7 | Post-mortem | All |

---

## Review Schedule

| Phase | Timing | Focus |
|-------|--------|-------|
| Pre-Testnet | Before public testnet | All critical items |
| Pre-Mainnet | Before production | Full checklist |
| Quarterly | Ongoing | New code, dependencies |
| Post-Incident | After any security event | Affected areas |

---

## References

- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [Smart Contract Security Best Practices](https://consensys.github.io/smart-contract-best-practices/)
- [Move Security Guidelines](https://move-language.github.io/move/)
