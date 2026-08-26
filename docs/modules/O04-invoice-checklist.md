---
id: O04
name: invoice-checklist
status: SPECCED
owners: ["api", "frontend", "inngest-handler", "db-handler"]
last_updated: 2026-08-26
---

# O04 — Invoice Checklist

> After D03 parses a bank statement, the business owner must not see a table of every debit and credit. O04 turns those internal `bank_transactions` into a clustered, editable **invoice checklist**: a short summary, at most five multiple-choice quick questions about ambiguous payees, a list of invoices to collect, and PDFs already pulled from Gmail. Edits and answers persist through O05 so the next statement is quieter. This is the primary independent-BO post-upload destination.

---

## Status

`SPECCED` (2026-08-26) — approved with the BO invoice-checklist plan. Implementation may begin.

O03 (CA client-knowledge form) is **not** part of the BO happy path. Do not send BOs to GST / vendor-list onboarding.

---

## 1. Purpose

Independent BOs upload a statement to learn which invoices they still need to find. Showing 1,000 parsed lines is the wrong surface: it leaks accounting internals and does not answer “what should I collect?”. O04 clusters debits by payee, biases uncertain spend onto the collect list, asks a few in-app questions about person-name transfers, and hands eligible items to F10 for Gmail search. The BO verifies the list (remove / not needed). Transactions stay in `bank_transactions` for CAs and the engine.

---

## 2. Inputs and Outputs

**Inputs**

- A `bank_statements` row with `status = 'parsed'` and its D03 `bank_transactions`.
- O05 `payee_memory` for the `client_org_id`.
- Linked `documents` when F10 (or later D04 manual upload) attaches a file to an item.

**Outputs**

- `invoice_checklist_items` (+ join rows to underlying txs — internal).
- `payee_clarifications` (max 5 pending per statement).
- HTTP JSON for the BO checklist UI (no reasoning, confidence, or D03 categories).
- Inngest events `muneem/gmail.invoice-search` for Gmail-eligible `to_collect` items.
- Writes to O05 via `upsertPayeeMemory` on answer / Not needed.

This module does NOT produce: journal entries, `transaction_document_matches`, OCR, O03 profile rows, or a BO-visible transaction table.

---

## 3. Trigger Mechanism

- Inngest: consume `muneem/interpretation.complete` `{ clientOrgId, statementId, trigger }` — already emitted by D03. Run `buildInvoiceChecklist(statementId)` inside `step.run`. Idempotent: if any checklist item exists for that `statement_id`, no-op.
- HTTP: owner APIs listed in §5.
- Pages: `/owner/statements/[sid]/checklist` (primary). `/owner/statements/[sid]` redirects to checklist when `parsed`; otherwise parsing/error/unlock only.

---

## 4. Schema Tables Owned

| Table                        | Ownership                     | Notes                                                                                                                                                                                                                                    |
| ---------------------------- | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `invoice_checklist_items`    | sole writer                   | Including `status`, `document_id` link, `gmail_search_status`. F10 may set `document_id`, `gmail_connection_id`, `status=collected`, `gmail_search_status` on items it searches — **shared writer with F10 on those four columns only**. |
| `invoice_checklist_item_txs` | sole writer                   | Internal; never in BO JSON                                                                                                                                                                                                               |
| `payee_clarifications`       | sole writer                   |                                                                                                                                                                                                                                          |
| `payee_memory`               | reader + caller of O05 upsert | O05 is sole table owner                                                                                                                                                                                                                  |
| `bank_transactions`          | reader only                   | D03                                                                                                                                                                                                                                      |
| `bank_statements`            | reader only                   | D01/D02/D03                                                                                                                                                                                                                              |
| `documents`                  | reader only                   | D04 / F10                                                                                                                                                                                                                                |

### `invoice_checklist_items`

| Column                      | Type             | Notes                                                                      |
| --------------------------- | ---------------- | -------------------------------------------------------------------------- |
| `id`                        | uuid PK          |                                                                            |
| `client_org_id`             | uuid FK          | tenant                                                                     |
| `statement_id`              | uuid FK          |                                                                            |
| `payee_key`                 | text             | O05 fingerprint                                                            |
| `display_name`              | text             | merchant / person label, not raw NEFT if avoidable                         |
| `amount_minor`              | bigint           | **sum of clustered debit magnitudes** (paise, stored positive)             |
| `currency`                  | char(3)          |                                                                            |
| `occurrence_count`          | int              | clustered line count                                                       |
| `period_label`              | text             | e.g. statement month “Feb” / “Feb 2026”                                    |
| `status`                    | text             | `to_collect` \| `collected` \| `not_needed` \| `awaiting_clarification`    |
| `source`                    | text             | `high_confidence` \| `user_confirmed` \| `clarified`                       |
| `document_id`               | uuid FK nullable | set when a PDF is linked                                                   |
| `gmail_connection_id`       | uuid nullable    | internal; F10; not shown in UI                                             |
| `gmail_search_status`       | text             | `not_eligible` \| `queued` \| `complete` \| `skipped_no_gmail` \| `failed` |
| `created_at` / `updated_at` | timestamptz      |                                                                            |

Unique: `(statement_id, payee_key)`. Indexes: `client_org_id`, `statement_id`, `status`.

### `invoice_checklist_item_txs`

`(item_id, bank_transaction_id)` composite PK. FKs cascade with the item. Not exposed to BO.

### `payee_clarifications`

| Column                 | Type          | Notes                                                    |
| ---------------------- | ------------- | -------------------------------------------------------- |
| `id`                   | uuid PK       |                                                          |
| `client_org_id`        | uuid FK       |                                                          |
| `statement_id`         | uuid FK       |                                                          |
| `payee_key`            | text          |                                                          |
| `prompt_text`          | text          | generated copy for UI                                    |
| `sample_amounts_minor` | jsonb         | bigint paise array (JSON numbers as strings in API)      |
| `occurrence_count`     | int           |                                                          |
| `status`               | text          | `pending` \| `answered` \| `skipped`                     |
| `answer`               | text nullable | `landlord` \| `supplier` \| `family` \| `self` \| `skip` |
| timestamps             |               |                                                          |

Unique: `(statement_id, payee_key)`.

---

## 5. API Contracts

All routes: `requireOwnerSession()` then `statement` / `item` / `clarification` must belong to `session.clientOrgId`. Never return `reasoning`, `interpretation_confidence`, `category`, or raw `bank_transaction_ids`.

Money in JSON: decimal string of paise (e.g. `"199900"`).

### `GET /api/v1/owner/statements/:sid/checklist`

- **Auth:** BO session; statement in org.
- **Response 200:**

```ts
{
  statement: { id, filename, status, periodStart, periodEnd, currency }
  summary: {
    toCollect: number      // to_collect + awaiting_clarification
    collected: number
    findYourself: number   // to_collect with no document_id after Gmail finished or skipped
    quickQuestions: number // pending clarifications
  }
  clarifications: Array<{
    id, payeeKey, promptText, occurrenceCount, sampleAmountsMinor: string[]
  }>  // pending only, max 5
  items: {
    toCollect: ChecklistItem[]
    collected: ChecklistItem[]
    notNeeded: ChecklistItem[]  // optional; UI may hide
  }
  gmailHint?: "needs_reauth" | "not_connected"  // optional, no jargon
}

type ChecklistItem = {
  id, displayName, amountMinor: string, currency, periodLabel,
  occurrenceCount, status, viewUrl?: string  // presigned GET when collected
  fromGmail?: boolean  // true when documents.gmail_address set; tiny hint only
}
```

- `awaiting_clarification` items are **not** in `items.toCollect`; they live in `clarifications`.
- **Errors:** `401 UNAUTHORIZED`, `404 STATEMENT_NOT_FOUND`, `409 NOT_READY` if statement is not `parsed`.

### `GET /api/v1/owner/checklist/summary`

- **Auth:** BO session.
- **Response 200:** org-level sums of the same `summary` fields (latest parsed statement, or zeros). Used by the dashboard. No transaction list.

### `PATCH /api/v1/owner/checklist/:itemId`

- **Auth:** BO; item in org.
- **Body:** `{ "action": "not_needed" }`
- **Effect:** item `status = not_needed`; O05 upsert `invoice_policy=never`, `source=list_edit`; do not enqueue Gmail; cancel eligibility.
- **Errors:** `400` invalid body, `401`, `404 ITEM_NOT_FOUND`.

### `POST /api/v1/owner/clarifications/:id/answer`

- **Auth:** BO; clarification in org; `status = pending`.
- **Body:** `{ "answer": "landlord" | "supplier" | "family" | "self" | "skip" }`
- **Effect:** see §7 answer map. May emit `muneem/gmail.invoice-search`.
- **Errors:** `400`, `401`, `404`, `409 ALREADY_ANSWERED`.

Replace `GET /api/v1/my/pending`: must **not** return a transaction table. Delegate to checklist summary or return `410` with `{ error: "GONE", use: "/api/v1/owner/checklist/summary" }`.

D01 `GET /api/v1/clients/:id/statements/:sid/transactions` remains for CA. BO pages must not call it.

---

## 6. Queue Jobs

**Consumes**

- `muneem/interpretation.complete` — `{ clientOrgId, statementId, trigger }`
  - Function id: `build-invoice-checklist`
  - Idempotency: skip if items exist for `statementId`
  - After insert, publish Gmail events for eligible items

**Publishes**

- `muneem/gmail.invoice-search` — `{ clientOrgId, statementId, itemId }` — F10. Also published from the clarification-answer API when the answer makes the item eligible.
  - Idempotency key for F10: `gmail-pull-{itemId}`

---

## 7. Business Logic Rules

### 7.1 Builder — which bank lines

- Debits only: `amount_minor < 0n`. Exclude all credits.
- Exclude categories `bank_charge`, `salary`, `inter_account_transfer`, `loan_emi`, `tax_payment`, `owner_drawing`, and `match_status = out_of_scope`, **unless** O05 `invoice_policy = always` for that fingerprint.
- Include if `needs_invoice = true` **or** high-confidence vendor-like (§7.3). Uncertain debits default **onto** the list (false positives OK).

### 7.2 Cluster

- Group by `fingerprintPayee(description)` within the statement.
- One checklist item per `(statement_id, payee_key)`.
- `amount_minor` = sum of `|amount_minor|` of clustered txs.
- `occurrence_count` = cluster size.
- `display_name` = memory.display_name, else merchant alias, else title-cased fingerprint.
- Persist `invoice_checklist_item_txs` for every clustered tx (internal).

### 7.3 High confidence (list immediately, Gmail eligible if other gates pass)

- Curated merchant aliases (Claude / Anthropic, Spotify, AWS, Amazon, Netflix, Google, Microsoft, Adobe, Slack, Zoom, GitHub, Vercel, Notion, Figma, Swiggy, Zomato, Uber, Jio, Airtel, and similar SaaS / India consumer brands), **or**
- O05 `invoice_policy = always`, **or**
- `category = vendor_payment` and `interpretation_confidence >= 0.80`.

These items get `status = to_collect`, `source = high_confidence` (or `user_confirmed` if from memory always), `gmail_search_status = queued` when F10 should run.

**Never show** confidence, category, or LLM reasoning in the UI — these inputs are internal only.

### 7.4 Clarification candidates

- Person-name IMPS / UPI / NEFT / RTGS clusters, not high-confidence, not in memory as `always` or `never` (and not family/self).
- Cap **5 per statement**, ranked by cluster `|amount_minor|` descending.
- Those 5: create `payee_clarifications` (`status=pending`) and item `status=awaiting_clarification`, `gmail_search_status=not_eligible`.
- Extra ambiguous clusters: still appear as `to_collect` on the list but `gmail_search_status=not_eligible` until the user removes them. No extra questions in v1.

Prompt copy:

```
You paid {displayName} {formatINR(typicalAmount)} ({count} times in {month}). What was this?
```

Use the largest sample amount as `{typicalAmount}` when count > 1. Buttons: Rent / landlord · Supplier · Personal / family · My other account · Skip for now.

### 7.5 O05 at build time

- `never` or relationship `family`/`self` → omit from collect list (or insert `not_needed` if we must keep a row for audit — prefer **omit**). No question. No Gmail.
- `always` → `to_collect`, Gmail eligible, skip question.
- Missing → apply §7.3 / §7.4.

Second statement with the same payee therefore skips the question.

### 7.6 Answer map

| Answer   | Clarification | Item                             | O05               | Gmail   |
| -------- | ------------- | -------------------------------- | ----------------- | ------- |
| landlord | answered      | `to_collect`, `source=clarified` | landlord / always | enqueue |
| supplier | answered      | `to_collect`, `source=clarified` | vendor / always   | enqueue |
| family   | answered      | `not_needed`                     | family / never    | no      |
| self     | answered      | `not_needed`                     | self / never      | no      |
| skip     | skipped       | stays `awaiting_clarification`   | **no write**      | no      |

### 7.7 Gmail eligibility (O04 sets the flag; F10 enforces)

Search only when `status = to_collect` AND policy ≠ `never` AND not `awaiting_clarification`. Do not search Not needed, pending questions, credits, bank fees, confirmed personal.

### 7.8 Summary counts

- To collect — `to_collect` + `awaiting_clarification`
- Collected — `document_id` present
- Find yourself — `to_collect` and no `document_id` after Gmail `complete` / `skipped_no_gmail` / `failed`, or no connection
- Quick questions — pending clarifications

### 7.9 UI / nav (normative for BO)

- Primary URL: `/owner/statements/[sid]/checklist`
- After parse: land here within two clicks (upload → progress page → redirect).
- `/owner/statements/[sid]`: never a transaction table. In-flight copy: “Analyzing your statement… this usually takes 1–2 minutes.” Poll including `phase1_complete`.
- `/owner/pending`: redirect to `/owner/dashboard`. Remove Pending from owner nav.
- Nav: Dashboard, Onboarding, Statements, Invoices (manual D04 remains secondary).
- Dashboard: checklist summary counts + CTAs for Connect Gmail and Upload statement. Do not hard-block upload if Gmail is disconnected.
- Follow `docs/frontend-conventions.md`. No accounting jargon.

### 7.10 Idempotency

If D03 retries after `parsed`, builder no-ops. Do not wipe user `not_needed` edits.

---

## 8. LLM Usage

None. Clustering and questions are deterministic. D03 may have used an LLM upstream; its reasoning is never forwarded.

---

## 9. Economics

| Component       | Per unit          | Frequency                           | Notes        |
| --------------- | ----------------- | ----------------------------------- | ------------ |
| Builder compute | Inngest step      | once per parsed statement           | Cheap vs D03 |
| Gmail events    | 0–N per statement | high-confidence + answered clusters | F10 cost     |

Watch: average pending clarifications per statement (target ≤ 5, trending down with memory).

---

## 10. Failure Modes

| Failure              | Trigger                        | Impact                      | Severity | Recovery                         |
| -------------------- | ------------------------------ | --------------------------- | -------- | -------------------------------- |
| `NOT_READY`          | GET checklist before `parsed`  | BO stays on progress page   | low      | Poll                             |
| Builder skip         | Items already exist            | Stale if D03 data was wrong | med      | Manual rebuild later (out of v1) |
| Missing memory write | Skip vs Not needed confused    | Repeat questions            | low      | Tests                            |
| BO API leak          | Returning tx table / reasoning | Product violation           | high     | Tests + review                   |

---

## 11. Dependencies

- **Depends on (modules):** D01 (statement row), D02/D03 (parsed txs + `interpretation.complete`), O05 (memory), F09 (connection presence hint only), F02 (`requireOwnerSession`).
- **Depended on by (modules):** F10 (events + item rows), X05 remains PLANNED (O04 covers statement-level “what’s still needed”).
- **External services:** PostgreSQL, Inngest. Presigned GET via existing muneem S3 helper.

---

## 12. Open Questions

None for v1. Download summary PDF is deferred. Multi-Gmail UI is deferred; schema already stores `gmail_connection_id` on the item when F10 fills it.

---

## 13. Change Log

| Date       | Change                                                            | By           |
| ---------- | ----------------------------------------------------------------- | ------------ |
| 2026-08-26 | Initial SPECCED — BO checklist, clarifications cap 5, no tx table | Bani / agent |

---
