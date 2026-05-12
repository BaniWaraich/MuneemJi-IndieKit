---
id: D01
name: bank-statement-upload
status: SPECCED
owners: ["api", "frontend", "db-handler"]
last_updated: 2026-05-12
---

# D01 — Bank Statement Upload

> D01 is the user-facing on-ramp for the entire document pipeline. A CA or linked BO uploads a bank statement (PDF or CSV, ≤ 25 MB). The module issues a pre-signed S3 URL, creates a `bank_statements` row, and — after the file lands in S3 and is confirmed clean — fires the `muneem/statement.uploaded` Inngest event that triggers D02 (format extraction) → D03 (interpretation). Nothing downstream can run without D01's clean-file gate.

---

## Status

`SPECCED`

---

## 1. Purpose

Gives CAs and linked BOs a single, guarded entry point for uploading bank statements. It enforces storage caps before issuing an upload URL, creates the tracking row with the correct lifecycle state, and fires the downstream Inngest event only after confirming the file is safe. It does not parse, classify, or match — it hands off to D02 the moment the file is ready.

---

## 2. Inputs and Outputs

**Inputs**
- `clientOrgId` — UUID, from URL path; must be owned by the CA's firm
- `filename` — string, 1–255 chars
- `contentType` — MIME type (must be `application/pdf`, `text/csv`, or `application/octet-stream`)
- `fileSizeBytes` — integer > 0, provided by client upfront; used for storage cap pre-check
- File binary — uploaded directly from browser to S3 via pre-signed PUT URL

**Outputs**
- `bank_statements` row with `scan_status = 'pending'` (or `'clean'` in dev)
- Pre-signed S3 PUT URL (15 min expiry) returned to client
- Inngest event `muneem/statement.uploaded` fired on confirm when `scan_status = 'clean'`

This module does NOT parse statement content, classify transactions, or write journal entries.

---

## 3. Trigger Mechanism

- `POST /api/v1/clients/:clientOrgId/statements` — CA or linked BO requests a pre-signed URL
- `POST /api/v1/clients/:clientOrgId/statements/confirm` — called by the client after S3 PUT succeeds; fires Inngest event if file is already clean (dev), or waits for ClamAV callback (prod)

---

## 4. Schema Tables Owned

| Table | Ownership | Notes |
|---|---|---|
| `bank_statements` | sole writer (D01 creates rows; D02/D03 update status/content) | D01 owns: `s3_key`, `filename`, `file_size_bytes`, `scan_status` (initial), `status` (initial), `uploaded_by_user`, `uploaded_by_client`, `currency` |
| `client_orgs` | reader only | owned by O01 — used to resolve `firm_id` for storage cap |

---

## 5. API Contracts

### `POST /api/v1/clients/:id/statements`

- **Auth:** CA session (`ca_admin` or `ca_staff`) OR linked-BO session; firm/owner ownership verified via `requireFirmOrOwnerForClient`
- **Request body:**
  ```ts
  { filename: string; contentType: string; fileSizeBytes: number }
  ```
- **Response 200:**
  ```ts
  { statementId: string; uploadUrl: string; s3Key: string }
  ```
- **Errors:**
  - `402` — `STORAGE_LIMIT_EXCEEDED` — firm is at or over 500 MB, or client org has ≥ 50 statements

### `POST /api/v1/clients/:id/statements/confirm`

- **Auth:** CA session OR linked-BO session; same ownership check
- **Request body:**
  ```ts
  { statementId: string }
  ```
- **Response 200:**
  ```ts
  { queued: boolean }
  ```
  `queued: true` means Inngest event fired immediately (dev / already-clean). `queued: false` means waiting for ClamAV callback.
- **Errors:**
  - `404` — statement not found or doesn't belong to this client
  - `409` — statement already confirmed / processed

### `GET /api/v1/clients/:id/statements`

- **Auth:** CA session OR linked-BO session
- **Response 200:**
  ```ts
  { statements: Array<{ id, filename, status, periodStart, periodEnd, currency, createdAt }> }
  ```

---

## 6. Queue Jobs

**Publishes**
- `muneem/statement.uploaded` — `{ statementId: string }` — fired by confirm route when `scan_status = 'clean'`; consumed by D02

**Consumes**
- None. (ClamAV callback updates `scan_status` and fires `muneem/statement.uploaded` — that callback is part of F03.)

---

## 7. Business Logic Rules

- Storage cap is checked **before** issuing the pre-signed URL. If the check fails, no row is created and no URL is issued.
- Storage cap: 500 MB total file bytes per firm; 50 statement rows per client org. Both are enforced.
- `fileSizeBytes` is provided by the client and stored as-is. It is a best-effort cap gate, not a cryptographic guarantee.
- The Inngest event is only fired when `scan_status = 'clean'`. A `pending` file must wait for F03's ClamAV callback.
- `SKIP_VIRUS_SCAN=true` is dev-only: presign route sets `scan_status = 'clean'` immediately; confirm route fires Inngest at once.
- `SKIP_VIRUS_SCAN=true` must throw at module load time in production (this check already exists in the presign route).
- A statement row created by D01 and never confirmed (upload abandoned) is garbage — the processing pipeline will never fire. No cleanup is specified for V1.

---

## 8. LLM Usage

None. D01 is pure upload orchestration.

---

## 9. Economics

| Component | Per unit | Frequency | Notes |
|---|---|---|---|
| S3 PUT request | ~$0.000005 | per upload | negligible |
| S3 storage | ~$0.023/GB/month | per file | capped at 500 MB/firm |

No LLM costs. No watch metric — straightforward.

---

## 10. Failure Modes

| Failure | Trigger | Impact | Severity | Recovery |
|---|---|---|---|---|
| `STORAGE_LIMIT_EXCEEDED` | Firm over 500 MB or client over 50 docs | Upload blocked; 402 returned | medium | CA must delete old statements (V1: manual) |
| S3 PUT failure | Browser network error or presign expiry | Row exists with `processing` status; no Inngest event | low | User retries upload; orphan row is harmless |
| Confirm called on wrong statementId | Bug or replay | 404 / ownership check fails | low | Returns error; no state change |
| ClamAV down (prod) | Daemon outage | `scan_status` stays `pending`; pipeline blocked | high | F03 owns recovery; D01 is not involved |
| Inngest unavailable at confirm | Inngest outage | Row is clean but event not fired; pipeline stuck | high | Inngest retry / manual re-fire via dashboard |

---

## 11. Dependencies

- **Depends on (modules):** F02 (tenant-isolation helpers), F03 (scan_status lifecycle in prod)
- **Depended on by (modules):** D02 (consumes `muneem/statement.uploaded`)
- **External services:** AWS S3 (pre-signed URL + storage), ClamAV (prod scan — via F03), Inngest

---

## 12. Open Questions

None. Module is fully specced for V1 scope.

---

## 13. Change Log

| Date | Change | By |
|---|---|---|
| 2026-05-12 | Initial spec | Claude Code |
