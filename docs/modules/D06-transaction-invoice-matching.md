---
id: D06
name: transaction-invoice-matching
status: SPECCED
owners: ["inngest-handler", "db-handler"]
last_updated: 2026-08-31
---

# D06 — Transaction–Invoice Matching

> D06 links stored invoice documents (from F10 Gmail pull or D04 manual upload) to the correct `bank_transactions` rows that need them. It is the sole writer of `transaction_document_matches` and owns transitions on `bank_transactions.match_status` out of `unmatched`. Matching is heuristic in v1 (email subject, filename, light PDF text, merchant billing hints, FX conversion) — D05 OCR improves confidence later but is not required. O04 consumes match counts for BO progress (“2 of 3 payments matched”); the CA statement detail shows per-transaction status.

---

## Status

`SPECCED` — approved 2026-08-31. Implementation may begin.

Coordinates with **F10 v1.1** (per-transaction Gmail search + document hint columns) and **O04 v1.1** (`matchProgress` on checklist API). F10/O04 amendments are listed in §14; they are not blockers for the matcher core but are required for the full BO experience.

---

## 0. Scope (explicit)

### In scope (v1)

- Inngest matcher on `muneem/document.uploaded` and `muneem/interpretation.complete`
- Heuristic scorer: invoice ref in bank description, same-currency amount, cross-currency FX band, vendor + date
- Writes `transaction_document_matches` (`match_type = 'auto'`)
- Updates `bank_transactions.match_status`: `unmatched` → `matched` or `flagged`
- Reads `document_extractions` when present (D05 future) — boosts confidence, not required
- `fx_reference_rates` table + daily fetch for USD→INR (and extensible pairs)
- Merchant billing hints (USD list prices for SaaS) in `src/lib/matching/merchant-billing.ts`
- Idempotent, tenant-scoped, safe to retry
- Unit tests on INR exact, USD→INR band, invoice-ref, ambiguous cluster

### Explicitly out of scope

| Concern                                            | Owned by           | Notes                                                                  |
| -------------------------------------------------- | ------------------ | ---------------------------------------------------------------------- |
| Gmail search / PDF fetch                           | F10                | F10 emits `document.uploaded`; D06 never calls Gmail                   |
| OCR / `document_extractions` write                 | D05                | D06 reads extractions if `ocr_status = 'complete'`                     |
| Journal entries                                    | D07                | Matching does not write `journal_entries`                              |
| BO checklist builder / clustering                  | O04                | O04 reads match counts; does not write match rows                      |
| CA manual match UI / override API                  | D09 or later slice | v1: auto only; `match_type = 'manual'` reserved                        |
| LLM-assisted disambiguation                        | future D06.1       | v1 is rules-only                                                       |
| Multi-currency bank statements                     | V1 guard           | Org statement currency is INR; foreign amounts appear on invoices only |
| Credit-card auth-hold vs settlement duplicate docs | v1                 | First high-confidence win; duplicates ignored                          |

---

## 1. Purpose

After D03 flags debits that need invoices and F10/D04 lands PDFs in S3, someone must answer: **which payment does this invoice belong to?** Without D06, documents sit orphaned and `match_status` stays `unmatched` forever — blocking CA review and day-book export. D06 closes the loop with testable rules, handles INR and USD invoice amounts against INR bank lines, and exposes progress so BOs see “2 of 3 matched” without a transaction table.

---

## 2. Inputs and Outputs

**Inputs**

- `documents` row — `client_org_id`, `filename`, optional F10 hint columns (§4.1), `gmail_address`, `ocr_status`
- `document_extractions` row — when `ocr_status = 'complete'` (optional boost)
- `bank_transactions` — candidates where `needs_invoice = true`, `match_status IN ('unmatched', 'flagged')`, same `client_org_id`
- `invoice_checklist_item_txs` — narrows candidates when document is tied to a checklist item (F10 path)
- `client_orgs.currency` — org statement currency (INR in V1)
- `fx_reference_rates` — USD→INR (etc.) by date
- Merchant billing hints — static catalog (Anthropic $20, etc.)

**Outputs**

- `transaction_document_matches` row per successful link
- `bank_transactions.match_status` updated:
  - `matched` — auto confidence ≥ 0.85 (same currency) or ≥ 0.75 (FX tight band)
  - `flagged` — auto confidence in review band, or FX wide band (8–18%), or ambiguous tie
  - unchanged `unmatched` — no candidate met threshold
- No HTTP responses (worker-only module in v1)

This module does NOT produce: OCR fields, checklist rows, Gmail searches, journal entries, or BO-facing JSON (O04 aggregates match counts).

---

## 3. Trigger Mechanism

- **Inngest function** `transaction-invoice-match` — no HTTP routes in v1.

---

## 4. Schema Tables Owned

### 4.1 Amendments required before implementation

**`documents`** — F10/D06 shared hint columns (migration owned by D06; F10 populates on Gmail pull):

| Column                 | Type                                        | Notes                                                |
| ---------------------- | ------------------------------------------- | ---------------------------------------------------- |
| `source_email_subject` | `text` nullable                             | Gmail subject; matcher input                         |
| `source_email_date`    | `timestamptz` nullable                      | Gmail `internalDate`                                 |
| `amount_hint_minor`    | `bigint` nullable                           | Parsed from subject/filename/PDF text                |
| `amount_hint_currency` | `char(3)` nullable                          | ISO 4217, e.g. `USD`, `INR`                          |
| `invoice_ref_hint`     | `text` nullable                             | e.g. `INV-4521` from subject/filename                |
| `bank_transaction_id`  | `uuid` nullable FK → `bank_transactions.id` | F10 per-tx search target; narrows matcher candidates |

Manual D04 uploads leave hint columns null; matcher uses filename + open candidates only.

**`fx_reference_rates`** — sole writer D06:

| Column          | Type                     | Notes                                                                    |
| --------------- | ------------------------ | ------------------------------------------------------------------------ |
| `id`            | `uuid` PK                |                                                                          |
| `rate_date`     | `date` NOT NULL          | UTC date of the rate                                                     |
| `from_currency` | `char(3)` NOT NULL       | e.g. `USD`                                                               |
| `to_currency`   | `char(3)` NOT NULL       | e.g. `INR`                                                               |
| `rate`          | `numeric(18,8)` NOT NULL | multiply `from` minor units → `to` major via rate × amount / 10^decimals |
| `source`        | `text` NOT NULL          | e.g. `frankfurter`, `seed`                                               |
| `created_at`    | `timestamptz`            |                                                                          |

Unique: `(rate_date, from_currency, to_currency)`.

**`transaction_document_matches`** — add unique index:

```sql
CREATE UNIQUE INDEX transaction_document_matches_tx_unique
  ON transaction_document_matches (bank_transaction_id)
  WHERE match_type = 'auto';
```

v1: at most one **auto** match per transaction. A new higher-confidence match replaces the row (same tx). Manual matches (future) exempt from this index.

### 4.2 Ownership

| Table                                   | Ownership                                                                               | Notes                                                          |
| --------------------------------------- | --------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `transaction_document_matches`          | **sole writer**                                                                         | `match_type`, `confidence`, `matched_by` (null for auto)       |
| `bank_transactions.match_status`        | **shared** — D06 owns transitions out of `unmatched`/`flagged` into `matched`/`flagged` | D03 sets initial value; D09 may override via corrections later |
| `fx_reference_rates`                    | **sole writer**                                                                         |                                                                |
| `documents` hint columns                | **shared** — D06 owns migration; F10/D04 populate                                       |                                                                |
| `document_extractions`                  | reader only                                                                             | D05                                                            |
| `bank_transactions` (other columns)     | reader only                                                                             | D03                                                            |
| `invoice_checklist_items` / `_item_txs` | reader only                                                                             | O04 / F10                                                      |

---

## 5. API Contracts

None in v1. O04 `GET /api/v1/owner/statements/:sid/checklist` gains `matchProgress` (owned by O04 §14) by **reading** `transaction_document_matches` + `invoice_checklist_item_txs` — D06 does not implement that route.

Future (not v1): `POST /api/v1/clients/:id/transactions/:tid/match` for CA manual link (`match_type = 'manual'`).

---

## 6. Queue Jobs

### Consumes

**`muneem/document.uploaded`**

```ts
{
  documentId: string;
  clientOrgId: string;
  bankTransactionId?: string; // F10 per-tx pull; optional for D04
}
```

- Function id: `transaction-invoice-match`
- Idempotency: `match-doc-{documentId}` (dedupe retries)
- Attempts: 3, exponential backoff
- Concurrency: 4 (global), throttle 10/min per `clientOrgId`

**`muneem/interpretation.complete`**

```ts
{
  clientOrgId: string;
  statementId: string;
  trigger: string;
}
```

- Same function or sibling step `match-statement-{statementId}`
- Idempotency: `match-stmt-{statementId}`
- Action: for each `needs_invoice` tx on statement, try matching against all unmatched docs for org (upload-order race: invoices before statement)
- Replaces D03 placeholder `match.scan` / `match.queue` — D03 emitters should send `interpretation.complete` only (O04 already consumes); D06 **also** subscribes to `interpretation.complete` for matching. No separate `match.scan` event in v1.

### Publishes

None required. Optional future: `muneem/match.complete` for X05 — not v1.

### Scheduled (optional v1.1)

- Daily cron: fetch missing `fx_reference_rates` for yesterday USD→INR. v1 may seed 90 days at deploy + lazy-fetch on miss.

---

## 7. Business Logic Rules

### 7.1 Gate — when to run

**On `document.uploaded`:**

1. `documents.scan_status = 'clean'`
2. Document not already auto-matched to a tx (existing row → no-op unless re-scan forced later)

**On `interpretation.complete`:**

1. Statement `status = 'parsed'`
2. Process txs where `needs_invoice = true` AND `match_status IN ('unmatched', 'flagged')`

Always scope every query by `client_org_id`. Never match across orgs.

### 7.2 Candidate transactions

Build candidate set `C`:

1. If `documents.bank_transaction_id` set → `C = { that tx }` (must still pass `needs_invoice` and not `out_of_scope`)
2. Else if document linked via F10 to checklist item → `C = txs in invoice_checklist_item_txs` for that item
3. Else → all open txs for org (`needs_invoice = true`, `match_status IN ('unmatched','flagged')`)

Exclude `match_status = 'out_of_scope'`. Debits only: `amount_minor < 0`.

### 7.3 Document hints — extraction order

Merge hints (first non-null wins per field):

| Priority | Source                                                                                                        |
| -------- | ------------------------------------------------------------------------------------------------------------- |
| 1        | `document_extractions` (D05) — `total_amount_minor`, `currency`, `invoice_number`                             |
| 2        | `documents.amount_hint_*`, `invoice_ref_hint`, `source_email_*` (F10)                                         |
| 3        | Parse `documents.filename` — amounts, `INV-*` refs                                                            |
| 4        | Merchant billing hint — if vendor resolved and amount missing, use `typicalAmountsMinor` in `billingCurrency` |

Implement parsers in `src/lib/matching/extract-hints.ts`. No LLM.

**Invoice ref from bank description** — regex on candidate tx `description`:

```
/\b(INV|INVOICE|BILL)[-#]?\s*([A-Z0-9][-A-Z0-9]{2,})\b/i
```

If ref matches `invoice_ref_hint` or filename → score boost (+0.15).

### 7.4 Scoring

For each `(document, transaction)` pair compute `score` ∈ [0, 1]:

| Signal               | Condition                                                                                   | Score component             |
| -------------------- | ------------------------------------------------------------------------------------------- | --------------------------- |
| Invoice ref          | Ref in tx description AND in doc hints                                                      | 0.95 cap (auto-match alone) |
| Vendor               | `matchMerchant(payee_key)` or checklist `display_name` in email subject / extraction vendor | +0.25                       |
| Date                 | `                                                                                           | tx_date − doc_date          | ≤ 7d`(INR) or`≤ 14d` (cross-currency) | +0.20 / +0.10 if 8–14d |
| Amount (tier A)      | Same currency, `delta_pct ≤ 1%` (min ₹1)                                                    | +0.50                       |
| Amount (tier B)      | Cross-currency FX (§7.5), tight band                                                        | +0.40                       |
| Amount (tier B wide) | Cross-currency, wide band                                                                   | +0.25                       |

`delta_pct = abs(tx_inr − expected_inr) / tx_inr` where `tx_inr = |amount_minor|`.

**Decision:**

| Total score                                       | Outcome                  |
| ------------------------------------------------- | ------------------------ |
| ≥ 0.85 AND amount tier A OR invoice ref           | `match_status = matched` |
| ≥ 0.75 AND (tier B tight OR invoice ref + vendor) | `match_status = matched` |
| ≥ 0.60 OR tier B wide                             | `match_status = flagged` |
| < 0.60                                            | no match                 |

**Tie-break:** one doc → pick highest score tx; if top two within 0.05 → `flagged` on best tx. One tx → pick highest score doc.

**Replace rule:** if tx already has auto match with lower confidence, replace when new score is ≥ 0.10 higher.

### 7.5 Cross-currency (FX) rules

V1 org statements are INR. Invoice may be USD (Anthropic, AWS, GitHub, etc.).

```
expected_inr = convert(amount_hint_minor, amount_hint_currency, 'INR', tx.transaction_date)
```

`convert` uses `fx_reference_rates` for `(rate_date = tx_date or nearest prior business day)`. If no rate, try `rate_date = tx_date - 1..5`. If still missing, fetch from Frankfurter API (`USD`→`INR`), upsert row, then convert.

**Tolerance on INR debit magnitude:**

| Band   | `delta_pct`  | Matcher                                    |
| ------ | ------------ | ------------------------------------------ |
| Tight  | ≤ 8%         | Tier B tight → `matched` if score ≥ 0.75   |
| Wide   | 8% < δ ≤ 18% | Tier B wide → `flagged`                    |
| Reject | > 18%        | Amount signal ignored (vendor + date only) |

18% covers FX drift, ~3% card markup, and billing vs settlement lag.

**Merchant billing hints** (`src/lib/matching/merchant-billing.ts`):

```ts
{ aliases: ['ANTHROPIC','CLAUDE'], billingCurrency: 'USD', typicalAmountsMinor: [2000n] }
```

When email says `$20` and bank shows ~₹1,982, convert $20 — do not compare 2000 to 198200.

**Implied rate learning (v1 optional, v1.1):** when both USD and INR appear in same email subject, upsert `payee_memory.metadata.implied_fx_rate` for future txs to same `payee_key`. O05 table is reader/writer via existing upsert helper — D06 may call `upsertPayeeMemory` with `source = 'd06_implied_fx'` only when both amounts present. If too invasive for v1, defer to v1.1.

### 7.6 Initial `match_status` (D03 recap — read-only)

D03 sets: `unmatched` (normal), `flagged` (LLM fallback), `out_of_scope` (inter-account, salary, bank charge). D06 never matches `out_of_scope`.

### 7.7 After match write

1. Insert `transaction_document_matches` (`match_type = 'auto'`, `confidence = score`)
2. Update `bank_transactions.match_status` per §7.4
3. Do **not** change `invoice_checklist_items.status` — O04 derives `collected` / `matchProgress` from match rows
4. Do **not** write `journal_entries`

### 7.8 Idempotency

- Re-running same document with same best tx → no duplicate match row
- `interpretation.complete` for statement with all txs matched → cheap no-op

---

## 8. LLM Usage

None in v1.

---

## 9. Economics

| Component            | Per unit     | Frequency                                  | Notes                                                                                |
| -------------------- | ------------ | ------------------------------------------ | ------------------------------------------------------------------------------------ |
| Matcher compute      | Inngest step | per document + per parsed statement        | Cheap vs D03/F10                                                                     |
| FX API (Frankfurter) | free         | ≤ 1 fetch/day/currency pair + cache misses | Upsert `fx_reference_rates`                                                          |
| DB reads             | few queries  | per match                                  | Index `bank_transactions(client_org_id, match_status)` if missing — add in migration |

Watch: `flagged` rate > 40% on SaaS merchants → tune FX band or hints.

---

## 10. Failure Modes

| Failure              | Trigger                        | Impact                                                                | Severity | Recovery                     |
| -------------------- | ------------------------------ | --------------------------------------------------------------------- | -------- | ---------------------------- |
| `DOCUMENT_NOT_FOUND` | Bad event payload              | no-op                                                                 | low      | NonRetriableError            |
| No candidates        | D04 upload before statement    | doc unmatched until `interpretation.complete`                         | low      | Automatic on statement parse |
| FX rate missing      | API down + empty table         | cross-currency degrades to vendor+date; likely `flagged` or unmatched | med      | Seed rates; retry            |
| Ambiguous tie        | Two txs same score             | `flagged` on best                                                     | low      | CA review (future UI)        |
| Tenant leak          | Missing `client_org_id` filter | **critical**                                                          | critical | Tests + code review          |

---

## 11. Dependencies

- **Depends on (modules):** D03 (`bank_transactions`, `needs_invoice`), D04/F10 (`documents`), F02 (tenant scope), O04 (`invoice_checklist_item_txs` reader)
- **Depended on by (modules):** O04 (match progress UI), X01 (export needs matched txs), D07 (journal on confirmed match — future)
- **External services:** Frankfurter (or ECB) for FX; PostgreSQL; Inngest

---

## 12. Open Questions

None — FX bands (8% / 18%), per-tx Gmail (F10), and BO progress (O04) decided 2026-08-31.

---

## 13. Acceptance Criteria

1. INR invoice hint ₹4,500 against ₹4,500.00 debit → `matched`, confidence ≥ 0.90.
2. USD $20 hint against ₹1,982 debit with rate such that δ ≤ 8% → `matched`.
3. Same with δ in (8%, 18%] → `flagged`.
4. `INV-4521` in bank description + same ref in filename → `matched` even if amount slightly off.
5. `document.uploaded` from D04 with no hints → matches when exactly one open tx same amount + vendor cluster.
6. `interpretation.complete` matches pre-uploaded doc to new statement txs.
7. No writes to `journal_entries` or `document_extractions`.
8. Every query includes `client_org_id`.
9. At most one `auto` match per `bank_transaction_id`.
10. O04 can compute `matchProgress.matched / matchProgress.total` per checklist item from D06 rows.

---

## 14. Coordination — F10 and O04 amendments (not D06 code)

### F10 v1.1 (separate implementation)

- Event payload: `{ clientOrgId, statementId, bankTransactionId }` — replaces item-only pull as primary path; may retain item pull for backward compat during migration.
- Gmail query per tx: `displayName`, amount token, `tx_date ± 14 days`.
- Cap 15 searches/statement (prioritise by `|amount_minor|` desc).
- Populate `documents` hint columns + `bank_transaction_id`.

### O04 v1.1 (separate implementation)

Extend `ChecklistItem` in `GET .../checklist`:

```ts
matchProgress?: {
  matched: number;
  total: number;
  status: 'searching' | 'partial' | 'complete' | 'not_found';
}
```

- `total` = count of `invoice_checklist_item_txs` where linked tx `needs_invoice = true`
- `matched` = count of those txs with an auto (or manual) row in `transaction_document_matches`
- `status`: `searching` if any linked tx has Gmail queued and no doc; `complete` if matched === total; `partial` if 0 < matched < total; `not_found` if matched === 0 and Gmail complete

Summary bar: `matchedPayments` / `totalPayments` across statement.

---

## 15. Implementation Layout

```
src/lib/matching/
  extract-hints.ts       # subject, filename, PDF text layer (optional)
  extract-invoice-ref.ts # from bank description
  fx-convert.ts          # rate lookup + convert
  fx-rates.ts            # DB + Frankfurter fetch
  merchant-billing.ts    # USD typical amounts
  score-pair.ts          # (doc, tx) → score + tier
  apply-match.ts         # DB writes
  list-candidates.ts     # tenant-scoped candidate sets

src/lib/inngest/functions/transaction-invoice-match.ts
```

Register in `src/lib/inngest/functions/index.ts`.

---

## 16. Change Log

| Date       | Change                                                                                    | By           |
| ---------- | ----------------------------------------------------------------------------------------- | ------------ |
| 2026-08-31 | Initial SPECCED — heuristic matcher, FX bands, per-tx F10 coordination, O04 matchProgress | Bani / agent |
