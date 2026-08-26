---
id: F10
name: gmail-invoice-pull
status: SPECCED
owners: ["inngest-handler", "db-handler"]
last_updated: 2026-08-26
---

# F10 — Gmail Invoice Pull

> F10 searches a connected Gmail inbox for PDF invoices that match an O04 checklist item, stores the file in S3 as a `documents` row, and marks the item collected. It uses F09 helpers only (never decrypts tokens itself). Search is gated: high-confidence and user-confirmed collect items only — never pending clarifications, Never-policy payees, or credits. Multi-account UI is out of scope; the job loops every active `gmail_connections` row for the org and records `gmail_connection_id` on the document.

---

## Status

`SPECCED` (2026-08-26) — approved with the BO invoice-checklist plan. Implementation may begin.

This is **not** D06 (matching engine). F10 does not write `transaction_document_matches` and does not change `bank_transactions.match_status`.

---

## 1. Purpose

The BO checklist is useful only if obvious subscription invoices actually appear under Collected. F10 is the background pull: given an eligible checklist item, query Gmail for a PDF, persist it like a D04 upload, and link `document_id` on the item. Failures are soft — the item stays “to collect” / “find yourself” rather than failing the statement.

---

## 2. Inputs and Outputs

**Inputs**

- Inngest event `muneem/gmail.invoice-search` `{ clientOrgId, statementId, itemId }`.
- Checklist item + O05 policy + statement period.
- F09 `gmail_connections` (`status = active`) for `client_users` in the org.
- F09 `src/lib/gmail/client.ts` (connection-id wrappers).

**Outputs**

- S3 object under `documents/{clientOrgId}/...`
- `documents` row with `gmail_connection_id`, `gmail_address`, `submitted_by_client` = the connection’s `user_id`, `scan_status = 'clean'`, `ocr_status = 'pending'`, `file_type = 'pdf'`.
- Checklist item: `document_id`, `status = collected`, `gmail_connection_id`, `gmail_search_status = complete` (or `skipped_no_gmail` / `failed` with status still `to_collect`).

This module does NOT produce: OCR fields, match links, journal entries, BO UI, or OAuth connect/disconnect (F09).

---

## 3. Trigger Mechanism

- Inngest function `gmail-invoice-pull`, trigger `muneem/gmail.invoice-search`.
- Publishers: O04 builder (high-confidence items) and O04 clarification-answer API (landlord / supplier).
- No HTTP routes in this module. View URLs are issued by O04 via `presignGet`.

---

## 4. Schema Tables Owned

| Table                          | Ownership                  | Notes                                                                                        |
| ------------------------------ | -------------------------- | -------------------------------------------------------------------------------------------- |
| `documents`                    | shared writer with D04     | F10 owns **create** of Gmail-sourced rows and columns `gmail_connection_id`, `gmail_address` |
| `invoice_checklist_items`      | shared with O04            | F10 updates `document_id`, `status`, `gmail_connection_id`, `gmail_search_status`            |
| `gmail_connections`            | reader + F09 token helpers | F09 sole writer of tokens                                                                    |
| `payee_memory`                 | reader only                | O05                                                                                          |
| `transaction_document_matches` | never touches              | D06                                                                                          |

### `documents` columns added (F10)

| Column                | Type                                      | Notes                                       |
| --------------------- | ----------------------------------------- | ------------------------------------------- |
| `gmail_connection_id` | uuid nullable FK → `gmail_connections.id` | which inbox fetched the file                |
| `gmail_address`       | text nullable                             | denormalised for display hint; not a secret |

Manual D04 uploads leave both null.

---

## 5. API Contracts

None. O04 `GET checklist` may include `viewUrl` and `fromGmail`.

---

## 6. Queue Jobs

**Consumes**

```ts
muneem / gmail.invoice - search;
{
  clientOrgId: string;
  statementId: string;
  itemId: string;
}
```

- Function id: `gmail-invoice-pull`
- Inngest id / idempotency: `gmail-pull-{itemId}` (dedupe retries)
- Attempts: 3, exponential backoff
- Concurrency: throttle per `clientOrgId` to respect Gmail quota (e.g. 5/min/org)
- All I/O inside `step.run`

**Publishes:** none required in v1 (`muneem/document.uploaded` optional; D05 has no consumer — emit on successful insert so D05 can subscribe later, matching D04).

---

## 7. Business Logic Rules

### 7.1 Gate (must all hold)

1. Item belongs to `clientOrgId` / `statementId`.
2. `status = to_collect`.
3. O05 `invoice_policy` is not `never` (missing row is OK if item is already `to_collect`).
4. Item is not `awaiting_clarification`.
5. `gmail_search_status` is `queued` or `not_eligible` only if being re-queued after a user confirm — skip if already `complete` with `document_id`.

If the gate fails: no-op, non-retriable.

### 7.2 Connections

Load every `gmail_connections` row with `status = active` whose `user_id` is a `client_users.id` for the org. v1 is usually one row. Search all; first PDF wins. Record that connection’s `id` and `gmail_address` on the document.

If none: set `gmail_search_status = skipped_no_gmail`, leave `to_collect`. Do not fail the job.

If `needs_reauth`: same as none for that connection; try other connections; if none usable, `skipped_no_gmail`. O04 may surface `gmailHint: needs_reauth`.

### 7.3 Search

Use F09 wrappers keyed by **connection id** (lookup `user_id` internally; do not decrypt in F10).

Query shape:

```
has:attachment filename:pdf "{display_name}" after:YYYY/MM/DD before:YYYY/MM/DD
```

Date window: statement `period_start` / `period_end` ± 7 days (ISO dates in IST). `maxResults` ≤ 5. Walk messages via `getMessage`; first `application/pdf` attachment via `downloadAttachment`.

### 7.4 Store

- Enforce firm 500 MB cap (`getFirmStorageBytes` + file size) before PUT; on exceed set item `gmail_search_status = failed` (no 402 to the BO job — statement stays usable).
- Per-file cap 25 MB; skip oversized attachments.
- PUT via muneem S3 client (`src/lib/muneem-storage`), key from `documentS3Key`. Do not use Indie Kit `uploadFromServer` (it strips characters from the path).
- Insert `documents` with `submitted_by_client` = connection user, `scan_status = 'clean'` (F03 deferred, same as D01/D04).
- Link item: `document_id`, `status = collected`, `gmail_connection_id`, `gmail_search_status = complete`.

If no PDF found: `gmail_search_status = complete` still (search ran) but **no** `document_id`; item stays `to_collect` (counts as find yourself).

### 7.5 What not to do

- Do not search pending clarification items.
- Do not search `not_needed`.
- Do not write journals or match rows.
- Do not show LLM reasoning (N/A).
- Do not block statement upload on missing Gmail (O04 / D01).

---

## 8. LLM Usage

None.

---

## 9. Economics

| Component                     | Per unit     | Frequency         | Notes                         |
| ----------------------------- | ------------ | ----------------- | ----------------------------- |
| Gmail `messages.list` + `get` | Google quota | per eligible item | Watch 429s                    |
| S3 PUT                        | storage      | per found PDF     | Counts toward 500 MB firm cap |

Watch metric: Gmail 429 rate and `skipped_no_gmail` share.

---

## 10. Failure Modes

| Failure                  | Trigger       | Impact                               | Severity | Recovery                                   |
| ------------------------ | ------------- | ------------------------------------ | -------- | ------------------------------------------ |
| `GmailNotConnectedError` | No row        | skipped_no_gmail                     | low      | BO connects Gmail; optional later re-queue |
| `GmailNeedsReauthError`  | invalid_grant | skipped; hint on checklist           | med      | Reconnect                                  |
| Storage cap              | firm ≥ 500 MB | failed search, item still to_collect | med      | Free space / raise later                   |
| No attachment            | Query empty   | find yourself                        | low      | Manual D04 upload                          |
| Gmail 429                | Quota         | Inngest retry                        | med      | Throttle                                   |

---

## 11. Dependencies

- **Depends on (modules):** F09 (helpers + `gmail_connections`), O04 (items + events), O05 (never gate), D04 (`documents` shape + storage cap helpers), F03 deferred scan policy (set `clean`).
- **Depended on by (modules):** D05/D06 later may OCR/match Gmail-sourced docs; not this slice.
- **External services:** Gmail API, AWS S3, Inngest, PostgreSQL.

---

## 12. Open Questions

None. Outlook and multi-Gmail **UI** remain out of scope; looping all active connections is the v1 data-model hint.

---

## 13. Change Log

| Date       | Change                                                      | By           |
| ---------- | ----------------------------------------------------------- | ------------ |
| 2026-08-26 | Initial SPECCED — gated Gmail PDF pull onto checklist items | Bani / agent |

---
