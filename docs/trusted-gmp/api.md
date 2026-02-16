# Integrated GMP API

The integrated-gmp service is a pure relay with no client-facing API. The coordinator is the single API surface for frontends and solvers.

The only endpoint is for operational monitoring:

## GET /health

Health check for monitoring the relay process.

**Response**

```json
{
  "status": "ok"
}
```

## Removed Endpoints

The following endpoints were removed as part of the GMP architecture migration. Their functionality is now handled on-chain by GMP messages or by the coordinator:

- `GET /public-key` — no longer needed; GMP replaces signatures
- `GET /approvals` — no signatures exist in GMP architecture
- `GET /approvals/:escrow_id` — no signatures exist in GMP architecture
- `POST /approval` — GMP message is the proof
- `POST /validate-outflow-fulfillment` — now done on-chain by validation contracts
- `POST /validate-inflow-escrow` — now auto-releases via GMP FulfillmentProof
- `GET /events` — coordinator has its own `/events`
