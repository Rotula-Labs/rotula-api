# Reconciliation Admin Endpoints

Operational guide for the reconciliation worker and the admin endpoints exposed by
`src/routes/admin.routes.ts`. All four endpoints are gated on the `ADMIN_TOKEN` environment
variable and must be called with a matching `Bearer` token.

## Admin endpoints

All requests require the header `Bauthorization: Bearer <ADMIN_TOKEN>`. Requests with a
missing or incorrect token receive `401 Unauthorized`.

| Method | Path | Body | Success |
| ------ | ---- | ---- | ------- |
| `POST` | `/admin/key-rotation/start` | none | `200` with the new key version and start timestamp |
| `GET` | `/admin/key-rotation/status` | none | `200` with the current rotation state |
| `GET` | `/admin/reconciliation/status` | none | `200` with open mismatch counts and the latest run summary |
| `PATCH` | `/admin/reconciliation/:id/resolve` | `{ resolvedBy, note? }` | `200` with the updated mismatch record |

### `POST /admin/key-rotation/start`

Starts a key rotation. No request body is read.

Response body:

```json
{
  "started": true,
  "keyVersion": 7,
  "startedAt": "2024-06-01T12:00:00.000Z"
}
```

### `GET /admin/key-rotation/status`

Returns the current key rotation state.

```json
{
  "inProgress": false,
  "keyVersion": 7,
  "lastRotatedAt": "2024-06-01T12:00:00.000Z"
}
```

### `GET /admin/reconciliation/status`

Returns the number of open mismatches grouped by type and the summary of the most recent
worker run.

```json
{
  "open": {
    "missing_ledger_entry": 2,
    "amount_mismatch": 1
  },
  "lastRun": {
    "startedAt": "2024-06-01T11:59:00.000Z",
    "finishedAt": "2024-06-01T11:59:05.000Z",
    "checked": 1234,
    "mismatches": 3
  }
}
```

### `PATCH /admin/reconciliation/:id/resolve`

Marks a single `ReconciliationMismatch` as resolved. The `:id` path parameter is the
mismatch primary key.

Request body:

```json
{
  "resolvedBy": "operator@rotula.lab",
  "note": "Manually replayed the missing ledger entry."
}
```

`resolvedBy` is required and must be a non-empty string. `note` is optional and is
stored alongside the resolution for audit purposes.

A request without a `resolvedBy` field returns `400 Bad Request`.

Response body:

```json
{
  "id": "cd1f4e2a-3d4b-45c6-8a7b-9e0f12345678",
  "type": "missing_ledger_entry",
  "status": "resolved",
  "resolvedBy": "operator@rotula.lab",
  "note": "Manually replayed the missing ledger entry.",
  "resolvedAt": "2024-06-01T12:05:00.000Z"
}
```

If the mismatch is already resolved, the endpoint returns `409 Conflict` and leaves the
record unchanged. This prevents an operator from silently overwriting the original
resolution audit trail.

## What a `ReconciliationMismatch` is

The reconciliation worker compares the ledger against the external payment provider's
settlement records on a fixed cadence. When it finds a difference outside the configured
tolerance, it writes a `ReconciliationMismatch` row. The worker is the only component
that creates these rows.

Columns:

| Column | Meaning |
| ------ | ------- |
| `id` | Primary key, used as the `:id` in the resolve endpoint. |
| `type` | Kind of difference, e.g. `missing_ledger_entry` or `amount_mismatch`. |
| `status` | `open` until an operator resolves it, then `resolved`. |
| `details` | Payload describing the difference (ledger entry id, expected vs. actual amount, etc.). |
| `resolvedBy` | Operator identity supplied when the mismatch is closed. |
| `note` | Optional free-text explanation of the resolution. |
| `resolvedAt` | Timestamp of the resolution. |

## Why mismatches are never auto-resolved

A mismatch means the ledger and the provider disagree about money. Resolving it
requires a judgment call about which side is correct and what corrective action to take
(replay a ledger entry, adjust an amount, escalate to the provider). Automatically
closing a mismatch would hide a potential loss or duplicate payment and destroy the
audit trail. The worker therefore only opens mismatches and leaves them for a resolver
to close explicitly through `PATCH /admin/reconciliation/:id/resolve`.

## Operator runbook

1. Call `GET /admin/reconciliation/status` to see how many mismatches are open and
what the last worker run found.
2. Inspect the open mismatches and their `details` to understand the difference.
3. Decide on the corrective action. Typical cases:
   - `missing_ledger_entry`: the provider settled a payment the ledger never recorded.
     Replay the ledger entry, then resolve.
   - `amount_mismatch`: the amounts differ. Verify fees and rounding before adjusting.
4. Once the corrective action is complete, call
   `PATCH /admin/reconciliation/:id/resolve` with a `resolvedBy` identifying yourself and a
   `note` describing what you did.
5. Confirm the response shows `status: "resolved"`. If you receive `409 Conflict`, the
   mismatch was already closed by someone else; re-read the record before taking further
   action.

## See also

-  [Docs/README.md](README.md) — index of operational documentation.
