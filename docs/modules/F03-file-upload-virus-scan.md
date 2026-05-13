---
id: F03
name: file-upload-virus-scan
status: DRAFT
owners: ["api", "db-handler", "inngest-handler"]
last_updated: 2026-05-13
---

# F03 — File Upload & Virus Scan

> F03 is the universal "trust gate" for every byte that enters Muneem Ji. It issues pre-signed S3 PUT URLs, drives the `scan_status` lifecycle for every uploadable row (`bank_statements` today; `invoices` and BO docs later), and brokers asynchronous AV scanning through an AWS Lambda + ClamAV pipeline triggered by S3 `ObjectCreated`. The Lambda HMAC-signs a callback into Vercel which flips `scan_status` and fires the downstream "cleared" Inngest event. Nothing downstream — parsing, OCR, journal writes — may touch a file whose `scan_status != 'clean'`.

---

## Status

`DRAFT`. The Inngest migration is already complete in code (`src/lib/inngest/functions/statement-extract.ts`, `statement-interpret.ts`); the D02 and D03 spec docs describing BullMQ are stale and should be refreshed independently of F03.

---

## 1. Purpose

Make file safety a single, enforced, module-owned concern instead of a per-route afterthought. D01 (and later D04, D05, BO doc uploads) all delegate file safety to F03: F03 owns the scan-state machine, the AV scan pipeline, and the operational policies around bad files (quarantine + alert) and long-term storage (7-year retention scaffolding). It does not parse, classify, or interpret any file content. **Storage-cap and per-file-size enforcement live in the calling module (D01) — F03 references rather than restates them.**

---

## 2. Inputs and Outputs

**Inputs**

- Presign request from a calling module (library call, not HTTP): `{ firmId, clientOrgId, kind: 'statement' | 'invoice' | 'bo_doc', filename, contentType, fileSizeBytes }`. The caller is responsible for storage-cap and per-file-size checks **before** invoking F03.
- Inngest event `muneem/statement.received` (emitted by D01 after S3 PUT confirmation + row insert). F03 subscribes and initiates the scan flow. Analogous events from D04/D05 (`muneem/invoice.received`, …) land later.
- S3 `ObjectCreated:Put` events on the upload bucket (consumed by the F03 Lambda — outside Vercel).
- HMAC-signed scan-result callbacks from the Lambda: `{ s3Key, status: 'clean' | 'infected' | 'error', reason?: string, scanProviderRef: string }`.

**Outputs**

- Pre-signed S3 PUT URL (15-min expiry) returned to the caller.
- Mutations to the `scan_status`, `scan_attempts`, `quarantined_at`, and (on quarantine) `s3_key` columns of the owning row. F03 is the **sole writer** of these columns.
- On `clean`: emits the upload-kind-specific Inngest event (`muneem/statement.cleared`, `muneem/invoice.cleared`, …). **Renamed from `*.uploaded`** to reflect post-scan semantics; `*.uploaded` is no longer used anywhere in the system.
- On `infected`: moves S3 object to `quarantine/` prefix; emits `muneem/scan.infected` (consumed by F06 notifications + F07 audit).
- On `error` (after 3 attempts): emits `muneem/statement.scan.failed` for uploader notification. **No quarantine on error** — error means we never got a verdict, not that the file is infected.

This module does NOT: parse statement content, classify, OCR, write journal entries, manage NextAuth sessions, enforce storage caps, enforce per-file size caps, or expose any user-facing API beyond the internal callback.

---

## 3. Trigger Mechanism

- **Library calls from other modules:**
  - `presignUpload(args)` — used by D01's `POST /statements`, D04's invoice presign, BO doc upload routes. Caller has already validated caps.
- **Inngest event subscription:** `muneem/statement.received` (and future `muneem/invoice.received`, …) — emitted by the calling module after S3 PUT confirmation + row insert. F03's Inngest function transitions `scan_status` from `pending` → `scanning` and waits for the Lambda callback.
- **AWS-side trigger:** S3 `ObjectCreated:Put` on `uploads/*` invokes the ClamAV Lambda. (Configured in infra, not in app code.)
- **HTTP route owned by F03:** `POST /api/v1/internal/scan-callback` — invoked only by the Lambda; HMAC-signed; verified before any DB write (see §5 and §7).

---

## 4. Schema Tables Owned

### Column ownership

F03 is the sole writer of the scan lifecycle columns on every uploadable table. Column ownership across modules is the source of truth in `docs/modules/bank_statements.schema.md` (to be extracted). For `bank_statements` the split is:

| Column                                                                                                              | Owner   | Notes                                         |
| ------------------------------------------------------------------------------------------------------------------- | ------- | --------------------------------------------- |
| `id`, `client_org_id`, `s3_key` (initial), `filename`, `file_size_bytes`, `uploaded_by_*`, `currency`, `created_at` | D01     | Identity / insert-time fields.                |
| `scan_status`, `scan_attempts`, `quarantined_at`, `s3_key` (post-quarantine update)                                 | **F03** | Scan lifecycle + post-quarantine key rewrite. |
| Parse-state columns                                                                                                 | D02     | See D02 §4.                                   |
| Interpret-state columns                                                                                             | D03     | See D03 §4.1.                                 |

### `scan_status` state machine

Enum values: `'pending' | 'scanning' | 'clean' | 'infected' | 'error'`. Enforced by a CHECK constraint on the column.

Transitions (F03 is the only writer):

```
pending ──(F03 picks up muneem/statement.received)──▶ scanning
scanning ──(callback status=clean)──▶ clean       [terminal]
scanning ──(callback status=infected)──▶ infected [terminal, after quarantine]
scanning ──(callback status=error, attempts<3)──▶ scanning  (retry)
scanning ──(callback status=error, attempts=3)──▶ error     [terminal]
```

Terminal states are immutable; idempotency guard (see §6) drops late callbacks.

### Tables

| Table                    | Ownership                                                  | Notes                                                                                                                                        |
| ------------------------ | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `bank_statements`        | inserter: D01; F03 writes the scan-lifecycle columns above | F03's migration adds `scan_attempts` (int, default 0) and `quarantined_at` (timestamptz, nullable) and the `scan_status` CHECK constraint.   |
| `invoices` (future, D04) | same shape                                                 | added when D04 lands.                                                                                                                        |
| `scan_log`               | F03 sole writer (new)                                      | Append-only row per scan attempt: `(id, s3_key, attempt, result, reason, provider_ref, created_at)`. Powers debugging and the retry counter. |

No new top-level entity tables in V1 beyond `scan_log`.

---

## 5. API Contracts

### `POST /api/v1/internal/scan-callback`

- **Auth:** HMAC SHA-256 signature in `X-Muneem-Scan-Sig` header, computed over the raw request body using `SCAN_CALLBACK_SECRET` from env. **Signature verified before any DB read or write.** Request rejected with `401` if signature missing or mismatched. Timestamp header `X-Muneem-Scan-Timestamp` required; reject if skew > 5 minutes.
- **Request body:**
  ```ts
  {
    s3Key: string;
    status: 'clean' | 'infected' | 'error';
    reason?: string;
    scanProviderRef: string;   // ClamAV daemon scan id / Lambda invocation id
  }
  ```
- **Response 200:** `{ ok: true }`
- **Errors:**
  - `401` — bad/missing HMAC or stale timestamp.
  - `404` — no row in any uploadable table matches `s3Key`.
  - `409` — idempotency guard (see §6): row's `scan_status` is not in `{pending, scanning}`; logged to `scan_log` but no state change and no event emission.

### Internal library surface (not HTTP)

```ts
presignUpload(args): Promise<{ s3Key, uploadUrl, expiresAt }>
```

This module exposes no public-user-facing HTTP routes beyond the internal callback. Storage-cap enforcement is owned by the caller (D01) — F03 does not provide a `requireStorageHeadroom` helper.

---

## 6. Queue Jobs

**Subscribes**

- `muneem/statement.received` — `{ statementId }` — emitted by D01 after S3 PUT confirm + row insert. F03 transitions `scan_status` from `pending` → `scanning`, records `scan_attempts = 1`, and awaits the Lambda callback. (Future: `muneem/invoice.received`, etc.)
- `muneem/scan.retry` — internal retry loop. Concurrency 5; max 3 attempts (initial + 2 retries); exponential backoff `30s, 5m`. Idempotency key: `scan-retry:{s3Key}:{attempt}`. Each retry increments `scan_attempts`.

**Publishes**

- `muneem/statement.cleared` — `{ statementId }` — fired on `clean` callback when the row is a `bank_statements`. **Consumed by D02.** (Renamed from `muneem/statement.uploaded`.)
- `muneem/invoice.cleared` — `{ invoiceId }` — fired on `clean` callback for invoices. Consumed by D05 (future).
- `muneem/scan.infected` — `{ rowTable, rowId, s3Key, reason }` — consumed by F06 (notify CA + uploader) and F07 (audit).
- `muneem/statement.scan.failed` — `{ rowTable, rowId, s3Key, attempts, lastReason }` — consumed by F06 (and the uploader UI). Fired only after 3 unsuccessful attempts; row is in terminal `error` state with file still in `uploads/` (no quarantine).

**Idempotency guard (callback + emit):** apply the state transition only if current `scan_status ∈ {pending, scanning}`. Otherwise no-op + `409` + `scan_log` row. This guarantees terminal-state immutability and prevents double-emission of `*.cleared` / `scan.infected` / `scan.failed` on duplicate callbacks.

---

## 7. Business Logic Rules

- **Storage cap (500 MB/firm, 50 statements/client org)** is enforced at the **caller** (D01 `/statements` presign + `/statements/confirm`). F03 does not re-check.
- **Per-file size cap (25 MB for statements)** is enforced at **D01 `/statements/confirm` via S3 HEAD**, not at F03. F03 trusts that an object reaching `muneem/statement.received` has already passed the per-file check. (Closes D02 §12 OQ4.)
- **Fail-closed:** `scan_status != 'clean'` blocks every downstream processor (D02, D05, D06, D07). No path bypasses this. Downstream functions never poll for `clean` — they are event-driven by `*.cleared`.
- **Quarantine on infected (only):** S3 object is server-side copied to `quarantine/<originalKey>` and the original deleted. The owning row's `s3_key` is updated to the quarantine key and `quarantined_at` set. Quarantine bucket prefix has an S3 lifecycle rule: auto-delete after **90 days**. **No quarantine on `error`** — error means no verdict, file stays in `uploads/`.
- **F03 self-failure path (sandbox timeout / 5xx / crash):** on scan-provider `error`, F03 fires `muneem/scan.retry` up to 2 times (3 total attempts). Each attempt increments `scan_attempts` and writes a `scan_log` row. Final failure flips `scan_status='error'` (terminal), emits `muneem/statement.scan.failed`, and the file stays in place pending manual re-upload by the user.
- **HMAC required:** callback route rejects any request without a valid signature + fresh timestamp, **before any DB read or write**. `SCAN_CALLBACK_SECRET` must be set in prod or app boot fails.
- **`SKIP_VIRUS_SCAN` is dev-only:** module throws at load time if `VERCEL_ENV === 'production'` and `SKIP_VIRUS_SCAN === 'true'`. (Already enforced at the D01 presign route; F03 centralises it.)
- **Sanctioned-country block** lives in **C09** (registration). F03 does NOT re-check this on every upload.
- **Retention (7-year scaffold):** uploads bucket has an S3 lifecycle rule tagging objects with `retention=7y`; archival transition (Standard → Glacier IR after 1 year) is wired now, final deletion rule is **disabled** until legal clarifies "minimum-retention" vs "mandatory-deletion". Constant `RETENTION_YEARS = 7` lives in `src/lib/storage/retention.ts`.
- **`scan_log` is append-only:** every callback writes a row, including duplicates and 409s. Powers forensic review.
- **Orphan S3 objects (incomplete multipart, abandoned presigns):** out of F03 scope. Covered by an S3 lifecycle policy (abort incomplete multipart, delete unconfirmed uploads after 24h) tracked separately.

---

## 8. LLM Usage

None.

---

## 9. Economics

| Component                    | Per unit                        | Frequency         | Notes                       |
| ---------------------------- | ------------------------------- | ----------------- | --------------------------- |
| S3 PUT request               | ~$0.000005                      | per upload        | negligible                  |
| S3 storage (Standard, ≤1y)   | $0.023/GB/month                 | per file          | capped 500 MB/firm at D01   |
| S3 storage (Glacier IR, >1y) | $0.004/GB/month                 | per file          | post-archival transition    |
| Lambda invocation (ClamAV)   | ~$0.0000002 + ~$0.00001667/GB-s | per upload        | ~2s @ 1 GB → ~$0.00003/scan |
| Quarantine retention         | $0.023/GB-month × ≤90 days      | per infected file | bounded                     |

**Watch metric:** scan-attempt-failure rate > 2% over 24h indicates Lambda or ClamAV signature problems.

---

## 10. Failure Modes

| Failure                | Trigger                                     | Impact                                                                          | Severity | Recovery                                                                                       |
| ---------------------- | ------------------------------------------- | ------------------------------------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------- |
| `HMAC_INVALID`         | Bad signature on callback                   | Callback rejected pre-DB; row stuck `scanning`                                  | high     | Investigate secret mismatch; manually re-trigger Lambda.                                       |
| `SCAN_TIMEOUT`         | Lambda > 60s or no callback in 10m          | Retry up to 3× then `scan_status='error'`, emit `scan.failed`, no quarantine    | medium   | Uploader notified; can re-upload.                                                              |
| `S3_QUARANTINE_FAILED` | Copy or delete fails during quarantine flow | Infected object may linger in `uploads/`                                        | high     | Alert; manual cleanup; lifecycle rule on `uploads/` deletes orphans after 30 days as backstop. |
| `INNGEST_EMIT_FAILED`  | Inngest outage at clean callback            | Row marked `clean` but downstream stalled                                       | high     | Inngest retries; manual re-fire via dashboard; F08 alerts.                                     |
| `CALLBACK_RACE`        | Two callbacks for same `s3Key`              | Idempotency guard: terminal state wins, `409` returned, both rows in `scan_log` | low      | None needed.                                                                                   |
| Lambda outage          | AWS region issue                            | New uploads sit at `scanning` indefinitely                                      | critical | Disable presign at the gate; show banner; F08 page oncall.                                     |

Note: `STORAGE_LIMIT_EXCEEDED` moved to D01 (no longer F03's failure mode).

---

## 11. Dependencies

- **Depends on (modules):** F02 (tenant isolation for ownership checks on callback row lookup).
- **Depended on by (modules):** D01 (emits `muneem/statement.received`, consumes `presignUpload`), D04, D05, X02, and every future module that ingests files.
- **External services:** AWS S3 (upload bucket + quarantine bucket/prefix), AWS Lambda (ClamAV layer), AWS S3 lifecycle policies, Inngest.

---

## 12. Open Questions

1. **Retention semantics.** Spec assumes 7-year minimum retention with archival transition; deletion rule disabled. Awaiting legal confirmation on whether 7y is a floor (keep ≥ 7y) or a ceiling (delete at 7y).
2. **Quarantine bucket vs prefix.** Spec uses a `quarantine/` prefix in the same bucket. A separate bucket with stricter IAM is cleaner but adds infra. Prefix-with-restrictive-IAM acceptable for V1.
3. **Shared `bank_statements.schema.md`.** Column-ownership table currently inlined in §4; extract to a shared schema-map file when D04 lands and a second table joins the pattern.

---

## 13. Change Log

| Date       | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | By          |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| 2026-05-13 | Initial draft from planning conversation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Claude Code |
| 2026-05-13 | Resolutions to cross-module contradictions: (1) F03 sole publisher of post-scan event, renamed to `muneem/statement.cleared`; D01 emits `muneem/statement.received` upstream. (2) Column ownership split — D01 inserts; F03 owns scan lifecycle columns + post-quarantine `s3_key`. (5) Quarantine F03-only. (7) Per-file 25 MB cap moved to D01 confirm via S3 HEAD. (10) Added `muneem/statement.received` subscription. (11) Added `scan_status` enum + CHECK + transition diagram; F03 sole writer. (12) Self-failure path: 3 attempts, terminal `error`, no quarantine on error, emit `muneem/statement.scan.failed`. (13) Idempotency guard on callback: state transition only if `scan_status ∈ {pending, scanning}`. (14) HMAC verified pre-DB. (17) Storage caps moved to D01; F03 references. (18) Orphan S3 cleanup out of scope, S3 lifecycle policy tracked separately. Merge blocked on D02/D03 Inngest refresh (item 16). | Claude Code |
