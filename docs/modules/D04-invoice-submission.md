---
id: D04
name: invoice-submission
status: SPECCED
owners: ["api", "frontend", "db-handler"]
last_updated: 2026-08-26
---

# D04 — Invoice Submission

> D04 is the user-facing on-ramp for invoice and receipt files. A CA or linked BO uploads one or more invoice files (PDF or image including HEIC, ≤ 25 MB each). The module issues a pre-signed S3 URL, creates a `documents` row, and — after the file lands in S3 and is confirmed — marks the row ready for later OCR (D05) and emits `muneem/document.uploaded`. **This module does not OCR, match, or interpret.** It is the invoice equivalent of D01 (bank-statement-upload): storage + metadata only.

---

## Status

`SPECCED` — approved 2026-08-18. Open questions resolved (see §16). Implementation may begin.

---

## 0. Scope (explicit)

### In scope (this slice)

- Bulk-friendly manual upload of invoice / receipt files from BO and CA surfaces
- Pre-signed S3 PUT + `documents` row creation + confirm flow (mirror of D01)
- Listing uploaded documents for a client org
- Storage-cap enforcement: shared firm **500 MB** across bank statements **and** documents (size only — no per-client document count cap)
- Leaving `ocr_status = 'pending'` so D05 can pick up later
- Emit `muneem/document.uploaded` on confirm (required; no consumer in this slice)
- UI/UX on owner and accountant sides that matches the existing statements panel patterns
- HEIC accepted and stored as `file_type = 'image'`

### Explicitly out of scope

| Concern                                                     | Owned by       | Notes                                                                                             |
| ----------------------------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------- |
| OCR / field extraction                                      | D05            | Do not call vision models; do not write `document_extractions`                                    |
| Matching invoice → bank transaction                         | D06            | Do not write `transaction_document_matches`; do not change `bank_transactions.match_status`       |
| Improving `needs_invoice` identification                    | D03 / D09      | Read-only consumer of existing flags if shown in UI                                               |
| Email / Gmail / Outlook auto-pull                           | F10            | Gmail PDF pull is F10; Outlook remains out of D04                                                 |
| Virus scanning                                              | F03 (deferred) | Confirm sets `scan_status = 'clean'` exactly as D01 does today                                    |
| Linking an upload to a specific transaction at upload time  | D06            | Upload is free-standing; matching is later                                                        |
| Open-items / “what’s still needed” dashboard productisation | X05            | May _display_ open items next to the uploader in a later UI pass; not required for D04 acceptance |
| Guest-token uploads                                         | future         | Schema column exists (`submitted_by_guest`); not wired in this slice                              |
| Deletion / replace of documents                             | later          | List + upload only                                                                                |

---

## 1. Purpose

Give CAs and linked BOs a single, guarded entry point for uploading invoice and receipt files so they are stored, tenant-scoped, and visible. Downstream modules (D05 OCR, D06 matching) must be able to discover new documents without re-uploading. D04 owns the file landing and the `documents` lifecycle up to “file is safely stored”; nothing more.

---

## 2. Inputs and Outputs

**Inputs**

- `clientOrgId` — UUID from URL path; must be accessible via `requireFirmOrOwnerForClient`
- `filename` — string, 1–255 chars
- `contentType` — MIME type (allowed: `application/pdf`, `image/png`, `image/jpeg`, `image/webp`, `image/heic`, `image/heif`, `application/octet-stream`)
- `fileSizeBytes` — integer > 0, ≤ 25 MB; used for storage-cap pre-check
- File binary — uploaded directly from browser to S3 via pre-signed PUT URL

**Outputs**

- `documents` row with `scan_status = 'clean'` after confirm, `ocr_status = 'pending'`
- Pre-signed S3 PUT URL (15 min expiry) returned to client
- Inngest event `muneem/document.uploaded` fired on confirm (required; no consumer in this slice — D05 will subscribe later)

This module does NOT produce: OCR fields, match links, journal entries, changes to `bank_transactions`, or reminder emails.

---

## 3. Trigger Mechanism

- `POST /api/v1/clients/:clientOrgId/documents` — request pre-signed URL + create row
- `POST /api/v1/clients/:clientOrgId/documents/confirm` — after S3 PUT succeeds; set `scan_status = 'clean'`; emit `muneem/document.uploaded`
- `GET  /api/v1/clients/:clientOrgId/documents` — list documents for the client

No worker is required for this slice.

---

## 4. Schema Tables Owned

### 4.1 Amendments required before implementation

The existing `documents` table is the target table but is missing fields D01 relies on for parity and cap enforcement. D04 owns the following migration:

| Change                                                                                               | Type                             | Notes                                                                     |
| ---------------------------------------------------------------------------------------------------- | -------------------------------- | ------------------------------------------------------------------------- |
| `file_size_bytes`                                                                                    | `bigint` nullable                | Stored at create time from client-reported size; used in firm storage sum |
| `submitted_by_user`                                                                                  | `text` nullable, FK → `users.id` | CA staff uploader (mirrors `bank_statements.uploaded_by_user`)            |
| Check: exactly one of `submitted_by_user` / `submitted_by_client` / `submitted_by_guest` is non-null | check constraint                 | Guest path unused in this slice but column retained                       |

`ocr_status` remains default `'pending'`. No writes to `document_extractions` or `transaction_document_matches`.

### 4.2 Ownership

| Table                          | Ownership                                                             | Notes                                                                                                                                                                 |
| ------------------------------ | --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `documents`                    | sole writer for **manual** create + scan_status transition on confirm | D05 will later own `ocr_status` transitions; D06 owns match rows. **F10 is a shared writer** for Gmail-sourced rows and owns `gmail_connection_id` / `gmail_address`. |
| `client_orgs`                  | reader only                                                           | firm_id + currency resolution for caps                                                                                                                                |
| `bank_statements`              | reader only                                                           | firm storage sum includes statement bytes + document bytes                                                                                                            |
| `document_extractions`         | **never touches**                                                     | D05                                                                                                                                                                   |
| `transaction_document_matches` | **never touches**                                                     | D06                                                                                                                                                                   |

### 4.3 S3 key layout

```
documents/{clientOrgId}/{timestamp}-{random8hex}-{sanitisedFilename}
```

Sanitisation: strip path separators; keep basename only; max 180 chars for the filename segment.

---

## 5. API Contracts

### `POST /api/v1/clients/:id/documents`

- **Auth:** CA session (`ca_admin` / `ca_staff`) OR linked-BO session via `requireFirmOrOwnerForClient`
- **Request body:**
  ```ts
  {
    filename: string; // 1–255
    contentType: string; // see allowed list
    fileSizeBytes: number; // int, 1 .. 25_000_000
  }
  ```
- **Response 200:**
  ```ts
  {
    documentId: string;
    uploadUrl: string;
    s3Key: string;
  }
  ```
- **Errors:**
  - `400` — validation failure
  - `401` / `403` — auth
  - `402` — `STORAGE_LIMIT_EXCEEDED` (firm ≥ 500 MB **including** existing statements + documents; size only — no document count cap)
  - `415` — disallowed content type (octet-stream allowed for mobile camera quirks; HEIC/HEIF allowed)

**Create-time row defaults**

| Column                                      | Value                                         |
| ------------------------------------------- | --------------------------------------------- |
| `scan_status`                               | `'pending'`                                   |
| `ocr_status`                                | `'pending'`                                   |
| `file_type`                                 | `'pdf'` if contentType is PDF, else `'image'` |
| `submitted_by_user` / `submitted_by_client` | set from session kind (exactly one)           |
| `file_size_bytes`                           | client-reported value                         |

### `POST /api/v1/clients/:id/documents/confirm`

- **Auth:** same as create
- **Request body:**
  ```ts
  {
    documentId: string;
  } // uuid
  ```
- **Response 200:**
  ```ts
  {
    confirmed: true;
  }
  ```
- **Behaviour:**
  1. Load row; must belong to `:id`; `scan_status` must be `'pending'` else `409 ALREADY_CONFIRMED`
  2. S3 HEAD; object must exist else `404 UPLOAD_NOT_FOUND`
  3. Reject if `ContentLength > 25 MB` → `413 FILE_TOO_LARGE`
  4. Set `scan_status = 'clean'` (virus scan deferred per F03)
  5. `inngest.send({ name: 'muneem/document.uploaded', data: { documentId } })` — required; no consumer in this slice
- **Errors:** `404`, `409`, `413`, auth errors

### `GET /api/v1/clients/:id/documents`

- **Auth:** same
- **Response 200:**
  ```ts
  {
    documents: Array<{
      id: string;
      filename: string;
      fileType: "pdf" | "image";
      fileSizeBytes: number | null;
      scanStatus: string;
      ocrStatus: string;
      createdAt: string; // ISO
    }>;
  }
  ```
- Ordered by `created_at DESC`
- No pagination in V1 (protected by firm 500 MB size cap only)

---

## 6. Queue Jobs

**Publishes**

- `muneem/document.uploaded` — `{ documentId: string }` — **required** on confirm. No consumer in this slice. D05 will subscribe later.

**Consumes**

- None.

---

## 7. Business Logic Rules

1. **Storage cap is checked before issuing the pre-signed URL.** If the check fails, no row is created and no URL is issued.
2. **Shared firm storage budget:** 500 MB total across `bank_statements.file_size_bytes` **and** `documents.file_size_bytes` for all clients of the firm. D01’s storage sum must be updated in the same implementation work so the pool is truly shared.
3. **No per-client document count cap.** Size (500 MB firm + 25 MB per file) is the only limit.
4. **Per-file hard limit:** 25 MB, enforced at create (schema) and again via S3 HEAD on confirm.
5. **Allowed types:** PDF and common image types including HEIC/HEIF. No CSV, no ZIP, no Office docs in this slice. HEIC/HEIF → `file_type = 'image'`.
6. **Bulk upload is client-side fan-out:** the API accepts one file per request (same as D01). The UI may select multiple files and call create → PUT → confirm sequentially or with limited concurrency (max 3 in flight).
7. **Abandoned uploads** (row created, confirm never called) are harmless orphans; no cleanup job in V1.
8. **Idempotent confirm:** second confirm on an already-clean row returns `409`, not a second event.
9. **No transaction linkage at upload time.** Even if the UI later shows open items beside the uploader, D04 does not accept a `bankTransactionId` in the create body.
10. **Tenant isolation:** every query is scoped by `clientOrgId` after `requireFirmOrOwnerForClient`.
11. **Both CA and linked BO** may upload (same auth helper as D01).

---

## 8. LLM Usage

None. D04 is pure upload orchestration.

---

## 9. Economics

| Component     | Per unit               | Frequency   | Notes                  |
| ------------- | ---------------------- | ----------- | ---------------------- |
| S3 PUT        | ~$0.000005             | per file    | negligible             |
| S3 storage    | ~$0.023/GB/month       | per file    | shared 500 MB firm cap |
| Inngest event | free tier / negligible | per confirm | required emit          |

No LLM cost. Watch metric: firm storage approaching 80% of 500 MB.

---

## 10. Failure Modes

| Failure                  | Trigger                                | Impact                         | Severity         | Recovery                                     |
| ------------------------ | -------------------------------------- | ------------------------------ | ---------------- | -------------------------------------------- |
| `STORAGE_LIMIT_EXCEEDED` | Firm ≥ 500 MB (statements + documents) | Upload blocked; 402            | medium           | Delete old files (manual in V1)              |
| S3 PUT failure           | Network / expired presign              | Row left `scan_status=pending` | low              | User retries; orphan harmless                |
| `UPLOAD_NOT_FOUND`       | Confirm before PUT finishes            | 404                            | low              | Retry confirm after PUT                      |
| `FILE_TOO_LARGE`         | HEAD size > 25 MB                      | 413; row stays pending         | low              | User uploads smaller file                    |
| `ALREADY_CONFIRMED`      | Double confirm                         | 409                            | low              | UI treats as success / refreshes list        |
| Inngest down at confirm  | Outage                                 | Row is clean; event missing    | low (this slice) | D05 can also poll `ocr_status=pending` later |

---

## 11. Dependencies

- **Depends on:** F02 (tenant helpers), `lib/muneem-storage` (presign + S3 client)
- **Depended on by (future):** D05 (OCR), D06 (matching), X05 (status surfaces)
- **External:** AWS S3, Inngest (emit on confirm)
- **UI parity:** mirror `StatementsPanel` patterns and frontend conventions (`docs/frontend-conventions.md`)

---

## 12. Frontend / UX requirements

### Surfaces

1. **Owner (BO):** new section or page under the owner app — e.g. `/owner/invoices` or a panel on the dashboard — titled “Invoices & receipts”.
2. **Accountant (CA):** panel on the client detail page (sibling of `StatementsPanel`), e.g. `DocumentsPanel`.

### Interaction (minimum)

- Multi-file picker + optional drag-and-drop zone (dashed border, primary tint — matches design system).
- Per-file progress: idle → uploading → confirming → done / error.
- After success, list refreshes and shows newest first.
- Empty state: “No invoices uploaded yet.”
- Helper copy: user does **not** need to pick which payment the invoice belongs to (matching is later).
- Errors surfaced inline (`STORAGE_LIMIT_EXCEEDED`, network failure) in plain language.

### Visual reference

See `/home/workdir/artifacts/indie-kit-invoice-upload-frame.svg` for the intended frame (header, status chips optional in this slice, dropzone, list). Status chips that depend on matching may be omitted until D06; this slice only needs upload + list.

### What the UI must NOT do in this slice

- Show OCR fields
- Offer “link to transaction”
- Call any interpret / match API
- Block upload because `needs_invoice` is false

---

## 13. Acceptance criteria

A build passes D04 when **all** of the following are true:

### Functional

1. Linked BO can upload a PDF invoice for their `clientOrgId` and see it in `GET .../documents`.
2. CA staff can upload an image invoice for a client of their firm and see it listed.
3. File lands in S3 at the documented key prefix; `documents.s3_key` matches.
4. After confirm, `scan_status = 'clean'` and `ocr_status = 'pending'`.
5. Firm storage sum of statements + documents blocks a new upload at 500 MB with HTTP 402.
6. There is no per-client document count limit (many small files under the firm size budget still succeed).
7. File > 25 MB is rejected (at create and/or confirm).
8. Disallowed MIME (e.g. `text/csv`) is rejected with 400/415; HEIC is allowed.
9. User from firm A cannot list or confirm documents for firm B’s client (403).
10. Confirm without a successful S3 PUT returns 404 `UPLOAD_NOT_FOUND`.
11. Second confirm returns 409; only one clean transition occurs; event is not double-fired.
12. Multi-select of 3 files in the UI results in 3 independent successful rows.
13. Confirm emits `muneem/document.uploaded` with `{ documentId }`.

### Non-functional / product

14. Owner and CA UIs follow `docs/frontend-conventions.md` (primary button, card, neutral hierarchy).
15. No route or worker writes to `document_extractions` or `transaction_document_matches`.
16. Module index entry for D04 updated to `IMPLEMENTED` only after the above pass.

---

## 14. Test plan & harnesses

### 14.1 Automated (API)

Prefer route-level tests (same style as existing API tests if present) or a thin integration harness under `scripts/` / test folder.

| ID  | Case             | Setup                                                       | Assert                                                        |
| --- | ---------------- | ----------------------------------------------------------- | ------------------------------------------------------------- |
| T01 | Happy path PDF   | Auth as owner; POST create → mock/real S3 PUT → confirm     | 200; row clean + pending OCR; S3 object exists; event emitted |
| T02 | Happy path PNG   | Auth as CA                                                  | `file_type = 'image'`                                         |
| T03 | Happy path HEIC  | Auth as owner; contentType image/heic                       | 200; `file_type = 'image'`                                    |
| T04 | Cap: firm 500 MB | Seed statements/docs summing ≥ 500 MB − 1 byte + large file | 402                                                           |
| T05 | Oversize create  | `fileSizeBytes = 26_000_000`                                | 400                                                           |
| T06 | Oversize confirm | PUT object > 25 MB; confirm                                 | 413                                                           |
| T07 | Missing PUT      | Create only; confirm                                        | 404 UPLOAD_NOT_FOUND                                          |
| T08 | Double confirm   | Confirm twice                                               | second 409; event not double-fired                            |
| T09 | Cross-tenant     | Owner of org A hits org B                                   | 403                                                           |
| T10 | List order       | Upload 2 files                                              | GET newest first                                              |
| T11 | Auth required    | No session                                                  | 401                                                           |
| T12 | No count cap     | Seed 250 small docs under firm size budget                  | POST still succeeds                                           |

### 14.2 UI harness (manual checklist)

| ID  | Case                    | Assert                                              |
| --- | ----------------------- | --------------------------------------------------- |
| U01 | Owner multi-upload      | Select 3 files; all appear in list with filenames   |
| U02 | CA panel on client page | Upload visible without leaving client context       |
| U03 | Error copy              | Trigger 402; message is human-readable              |
| U04 | Disabled state          | Button shows “Uploading…” and ignores double-submit |
| U05 | Empty state             | New client shows empty copy, not a broken table     |

### 14.3 Out-of-scope tests (do not write yet)

- OCR accuracy
- Match to `bank_transactions`
- Reminder emails
- Guest upload links

---

## 15. Implementation notes (non-normative)

- Reuse `presignPut` from `lib/muneem-storage/presign.ts` and the D01 create → PUT → confirm client sequence from `StatementsPanel`.
- Extract a small shared helper for “firm storage bytes (statements + documents)” and retrofit D01 in the same work so the shared pool is real.
- Prefer adding `DocumentsPanel` next to `StatementsPanel` rather than a one-off page structure.
- Emit `muneem/document.uploaded` on every successful confirm; absence of a consumer is fine.

---

## 16. Decisions (resolved 2026-08-18)

| #   | Decision                        | Resolution                                                                       |
| --- | ------------------------------- | -------------------------------------------------------------------------------- |
| Q1  | Shared storage pool             | **Yes** — firm 500 MB counts statements + documents; update D01 sum in same work |
| Q2  | Emit `muneem/document.uploaded` | **Yes** — required on confirm; no consumer yet                                   |
| Q3  | Document count cap              | **None** — size cap only (500 MB firm + 25 MB/file)                              |
| Q4  | HEIC                            | **Yes** — allow `image/heic` and `image/heif`; store as `file_type = 'image'`    |
| Q5  | Who uploads                     | **Both** CA and linked BO                                                        |

---

## 17. Change log

| Date       | Change                                                                                              | By                  |
| ---------- | --------------------------------------------------------------------------------------------------- | ------------------- |
| 2026-08-18 | Initial DRAFT — upload + store only; OCR/match deferred                                             | Grok / Bani session |
| 2026-08-18 | SPECCED — Q1–Q5 resolved: shared pool, event required, no count cap, HEIC yes, CA+BO                | Bani                |
| 2026-08-26 | F10 may insert Gmail-sourced `documents` rows (shared writer); D04 remains the manual-upload owner. | Bani / agent        |
