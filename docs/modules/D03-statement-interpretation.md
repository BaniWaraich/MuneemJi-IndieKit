---
id: D03
name: statement-interpretation
status: IMPLEMENTED
owners: [worker, schema]
last_updated: 2026-05-03
---

# D03 — Statement Interpretation

> Consumes the Markdown KV document produced by D02 and the client-specific business context held by O03 (`client-knowledge-capture`), and emits structured `bank_transactions` rows with category, `needs_invoice` flag, reasoning, and confidence. **All business logic in the bank-statement pipeline lives here.** A rule-based pre-filter handles the cases where client knowledge gives a deterministic answer (known vendors, customers, loans, inter-account transfers, owner drawings); GPT-4o mini handles only the residue, with the client context injected into the system prompt so the model reasons "as a CA who knows this business" rather than as a stranger seeing a statement for the first time.

---

## Status

`IMPLEMENTED` (2026-05-03) — `workers/interpret.worker.ts` is the new D03 worker, consuming `statement.interpret.queue`. Module dir `lib/statement-interpretation/` holds the six pieces: `parse-markdown-kv.ts`, `rule-prefilter.ts`, `build-context.ts`, `classify-llm.ts`, `integrity-checks.ts`, `insert-transactions.ts`. Schema migration `0009_add_d03_interpretation_columns.sql` added the six columns from §4.1 (`category`, `reasoning`, `interpretation_method`, `interpretation_confidence numeric(3,2)`, `matched_known_vendor_name`, `matched_active_loan_lender`). `match.scan` enqueue on success is wired (stub queue — D06 not yet specced). Operationally requires a `client_profiles` row per active client; missing → `MissingClientProfileError`, statement `failed`. Until O03 ships seed scripts, profiles must be seeded by hand.

---

## 1. Purpose

A bank-statement row that says "NEFT/RAMESH TEXTILES/INV-4521 ₹45,000 debit" means very different things depending on the business: for a Panipat yarn trader, Ramesh Textiles is a known supplier (a vendor payment, invoice expected); for a software consultancy, it's an unknown party (likely vendor, definitely needs invoice); for a textile manufacturer it might be a returned advance (no invoice). D03 closes that gap by reading per-client business context from O03 and using it to reason about every unmatched transaction. The output is what eventually drives the day book, the matching pipeline, and the CA's review workflow — every accuracy or correctness defect in this module shows up as wasted CA time downstream.

---

## 2. Inputs and Outputs

**Inputs**

- A `bank_statements` row in `status='phase1_complete'` with:
  - `phase1_markdown` — the Markdown KV document from D02 (frontmatter + per-transaction blocks)
  - `period_start`, `period_end`, `currency`, `client_org_id`
- The `client_profiles` row for the statement's `client_org_id`. **Required.** Missing → terminal `MissingClientProfileError` (see §10).
- The `client_knowledge` row for the same `client_org_id`. Optional — when missing, the rule pre-filter degrades to "inter-account-transfers only" (the one rule that doesn't depend on Tier 2) and the LLM works with Tier 1 context only.

**Outputs**

- `N` rows inserted into `bank_transactions` (one per `## Transaction N` block in the input KV), where N equals the frontmatter `transaction_count`.
- `bank_statements.status` transitions to `parsed` (success) or `failed` (terminal error).
- One row in `statement_parse_log` populating the D03 columns (`normalisation_mode`, `normalised_row_count`, `normalised_sum_minor`, plus `error_message` on failure).
- On success: one `match.scan` job enqueued per statement onto `match.queue` (see §6).

D03 does **not** produce: journal entries (D07), invoice records (D04), match links (D06), exports (X01), corrections (D09 reads what D03 wrote, not the other way around).

---

## 3. Trigger Mechanism

D03 runs as a BullMQ worker consuming jobs from `statement.interpret.queue`. There is no API route that invokes D03 directly.

- **Producer:** D02 (`statement-format-extraction`) enqueues `statement.interpret` with `{ statementId }` after writing `phase1_markdown` and transitioning the row to `phase1_complete`. Empty statements (`status='empty'`) are not enqueued.
- **Consumer:** `workers/interpret.worker.ts` (new file, created during D02/D03 implementation refactor — extracted from the current `workers/statement.worker.ts`).
- **Worker concurrency:** 2 (matches `statement.queue`).
- **Pre-flight gates checked at job start:**
  1. `bank_statements.status === 'phase1_complete'`. Anything else (`processing`, `parsed`, `failed`, `empty`) → no-op return; idempotent.
  2. `client_profiles` row exists for `client_org_id`. Missing → terminal `MissingClientProfileError`, mark statement `failed`, do not retry.
  3. `phase1_markdown` is non-null and parses against the D02 contract. Otherwise → `InvalidPhase1MarkdownError`, terminal.

---

## 4. Schema Tables Owned

D03 is the **sole writer** of `bank_transactions`. Every column is owned by D03 except those introduced by future modules (e.g. D06 will own `match_status` transitions out of `unmatched`; D09 will own future correction-derived columns).

### 4.1 Schema migration (D03 owns)

D03 ships a Drizzle migration that adds six columns to `bank_transactions`. All columns are nullable for backfill compatibility and tightened later if needed.

| New column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `category` | `text` | yes | null | TS-enforced enum: `vendor_payment` \| `customer_receipt` \| `salary` \| `bank_charge` \| `inter_account_transfer` \| `loan_emi` \| `owner_drawing` \| `tax_payment` \| `unknown`. India-only enum in V1; Ireland/Canada extension is an open question (§12). |
| `reasoning` | `text` | yes | null | One-sentence rule output or model output. Surfaces to CA on review. Read by D09 when promoting a correction back into `client_knowledge`. |
| `interpretation_method` | `text` | yes | null | TS-enforced enum: `rule_known_vendor` \| `rule_known_customer` \| `rule_active_loan` \| `rule_inter_account` \| `rule_owner_drawing` \| `llm` \| `llm_fallback`. Enables auditing accuracy by path. |
| `interpretation_confidence` | `numeric(3,2)` | yes | null | **Strict `numeric(3,2)` — never `real`/`double precision` to avoid float drift.** Range 0.00–1.00 enforced at write time. |
| `matched_known_vendor_name` | `text` | yes | null | Free-text name from `client_knowledge.known_vendors[].name` when `rule_known_vendor` matched. Not a FK because vendors live in JSONB. |
| `matched_active_loan_lender` | `text` | yes | null | Same idea for `active_loans[].lender`. |

### 4.2 Ownership table

| Table | Ownership | Notes |
|---|---|---|
| `bank_transactions` | sole writer (all columns except future D06/D09 transitions) | Insert-only in V1 — no updates. Dedupe on `(statement_id, dedupe_key)` ON CONFLICT DO NOTHING. |
| `bank_statements.status` | shared with D02 | D03 owns transitions `phase1_complete → parsed` and `phase1_complete → failed`. Cannot transition out of `parsed`. |
| `bank_statements.error_message` | shared with D02 | D03 sets on D03-caused `failed` only. |
| `statement_parse_log` (D03 columns only) | sole writer of: `normalisation_mode`, `normalised_row_count`, `normalised_sum_minor`, `error_message` (on D03-caused failure) | Wrapped in `safeWriteParseLog` — log-write failure must never mask the real D03 error. |
| `bank_statements.phase1_markdown`, `period_start`, `period_end`, `currency` | reader only | Owned by D02. |
| `client_profiles` | reader only | Owned by O03. Required at job start. |
| `client_knowledge` | reader only | Owned by O03. Optional; missing degrades to Tier-1-only context. |
| `bank_parser_scripts` | **never touches** | Owned by D02. |
| `transaction_category_corrections` | **never touches** | Owned by D09. D03 writes the data D09 later compares against. |
| `journal_entries` | **never touches** | Owned by D07 only. |

---

## 5. API Contracts

D03 exposes no HTTP routes. It is a worker module.

The HTTP routes that *expose* D03's outputs are owned by other modules:

- `GET /api/v1/clients/:id/statements/:sid/transactions` — lists `bank_transactions` for a parsed statement with category, reasoning, confidence, and method. Owned by D01 (statement read surface).
- `PATCH /api/v1/clients/:id/statements/:sid/transactions/:tid` — CA override of category / needs_invoice. Writes a `transaction_category_corrections` row. Owned by D09, **not** D03; the override never mutates the D03-written `bank_transactions` row, preserving the audit trail.

---

## 6. Queue Jobs

### Consumes

**`statement.interpret.queue` — `statement.interpret`**

```ts
{ statementId: string }
```

- jobId: `interpret-{statementId}` (idempotency key)
- attempts: 3
- backoff: exponential, 5s base
- concurrency: 2

**Idempotency:** D03 is safe to retry. The `bank_transactions` insert uses `ON CONFLICT DO NOTHING` on `(statement_id, dedupe_key)`. Status transitions are guarded by reading current status — a retry of a `parsed` statement returns immediately.

### Publishes

**`match.queue` — `match.scan`** (on D03 success only; not on failure or fallback-only outcomes — fallback rows are flagged for CA, matching is paused)

```ts
{ clientOrgId: string, statementId: string, trigger: 'd03_complete' }
```

- jobId: `match-scan-{statementId}`
- attempts: 3, backoff exponential 5s

D06 (`transaction-invoice-matching`) consumes this and attempts to match the newly-parsed transactions against any already-OCR'd-but-unmatched invoices for the `client_org_id`. This closes the upload-order race (BO uploads invoices before statement) — without it, those invoices would never match the new transactions until a later upload event.

The exact `match.scan` payload shape is owned by D06; treat the above as a placeholder until D06 is specced. **Open coordination point.**

D03 does **not** enqueue `ocr.queue`, `export.queue`, `reminder.queue`, or `journal.*`.

---

## 7. Business Logic Rules

### 7.1 Pipeline

For each statement:

1. Parse `phase1_markdown` into structured form: frontmatter + array of transactions (each with `transaction_index`, `date`, `description`, `debit_minor`, `credit_minor`, `balance_minor`).
2. Read `client_profiles` (required) and `client_knowledge` (optional) for `client_org_id`.
3. Run the rule pre-filter (§7.2) over every transaction. Each row is either matched by a rule (terminal classification) or unmatched (goes to LLM).
4. If any rows are unmatched: build the LLM system prompt from client context, build the user message from the unmatched rows' Markdown KV blocks, call GPT-4o mini (§8). On success, merge LLM results back. On failure after 2 attempts, apply per-row fallback (§7.4).
5. Compute `interpretation_confidence` per row: `rule = 1.00 × extraction_confidence`; `llm = model_stated × extraction_confidence`; `llm_fallback = 0.30 × extraction_confidence`. Clamp to `[0.00, 1.00]`. Round to 2 dp.
6. Run integrity checks (§7.5). Hard fail on mismatch.
7. Inside one Drizzle transaction: insert `bank_transactions`; update `bank_statements.status='parsed'`; write `statement_parse_log`. Commit.
8. Enqueue `match.scan` job per §6.

### 7.2 Rule pre-filter (in order; first match wins)

| Order | Rule | Input fields | Match condition | Output |
|---|---|---|---|---|
| 1 | inter-account transfer | `client_profiles.bank_accounts[]` | description contains any `account_number_last4` from a `bank_accounts` entry **other than the statement's own account** | `category=inter_account_transfer`, `needs_invoice=false`, `method=rule_inter_account`, `reasoning="Inter-account transfer to/from {account_label}"`, conf=1.0 |
| 2 | known vendor | `client_knowledge.known_vendors[]` | description contains any `description_patterns[i]` (case-insensitive substring) | `category=vendor_payment`, `needs_invoice=vendor.needs_invoice`, `method=rule_known_vendor`, `matched_known_vendor_name=vendor.name`, `reasoning="Matched known vendor: {vendor.name}"`, conf=1.0 |
| 3 | known customer | `client_knowledge.known_customers[]` | description contains any `description_patterns[i]` (case-insensitive substring) | `category=customer_receipt`, `needs_invoice=false`, `method=rule_known_customer`, `reasoning="Matched known customer: {customer.name}"`, conf=1.0 |
| 4 | active loan | `client_knowledge.active_loans[]` | description contains `description_pattern` (case-insensitive substring) | `category=loan_emi`, `needs_invoice=false`, `method=rule_active_loan`, `matched_active_loan_lender=loan.lender`, `reasoning="Matched active loan: {loan.lender} ({loan.loan_type})"`, conf=1.0 |
| 5 | owner drawing | `client_knowledge.owner_drawings_pattern` | `debit_minor > 0` AND description contains `owner_drawings_pattern.typical_description_pattern` (case-insensitive substring) | `category=owner_drawing`, `needs_invoice=false`, `method=rule_owner_drawing`, `reasoning="Matched owner drawings pattern"`, conf=1.0 |

Rules are short-circuit ordered: if rule 2 matches, rules 3–5 are not evaluated. The order reflects specificity — inter-account is rarest and most certain when it matches; owner drawings is the most permissive and runs last.

`owner_drawings_pattern` is a single object on `client_knowledge` (not an array), so only one pattern is matched per client. Multi-pattern support is open question §12.4.

### 7.3 LLM call (only for residue)

Run once per statement over the unmatched rows. See §8 for prompt details. The model returns a JSON array; D03 looks up each entry by `transaction_index` and merges into the row's classification.

If the LLM returns fewer entries than there are unmatched rows, or returns a `transaction_index` that didn't go into the call, that's an LLM error and triggers retry (§7.4).

### 7.4 LLM fallback (both attempts failed)

For every unmatched row, apply per-row defaults:

```
needs_invoice = (debit_minor > 0)
category      = 'unknown'
reasoning     = 'LLM unavailable — fallback rule applied'
method        = 'llm_fallback'
confidence    = 0.30 × extraction_confidence  (clamped)
match_status  = 'flagged'
```

`match_status='flagged'` ensures the CA sees these rows for review. The statement still transitions to `parsed` — partial-quality data with a clear flag is better than no data. **D03 does not hard-fail on LLM unavailability.** This is policy.

`statement_parse_log.normalisation_mode = 'fallback'` records the degraded run for observability.

### 7.5 Integrity checks (hard fail on mismatch — non-negotiable)

Before any `bank_transactions` insert:

1. **Row count match.** `len(rows_to_insert) === frontmatter.transaction_count`. Mismatch → `NormalisationIntegrityError`. Catches silent LLM row drops or merges.
2. **Sum integrity.** `Σ |amount_minor|` of D03 rows == `Σ (debit_minor + credit_minor)` from D02's KV, within 1 paise tolerance. Mismatch → `NormalisationIntegrityError`.

On either failure: nothing is inserted, statement marked `failed` with the specific check that broke in `error_message`. The whole statement re-runs cleanly on retry.

### 7.6 Other correctness rules

- **Tenant isolation.** Every read of `client_profiles`, `client_knowledge`, and every write to `bank_transactions` includes `client_org_id`. Cross-org leakage would mean another firm's vendor list informing this client's classifications.
- **Money is BIGINT.** `amount_minor` is `bigint`. Sign convention: positive = credit (money in), negative = debit (money out). Computed deterministically from D02's KV (`amount_minor = credit_minor - debit_minor`); never re-derived from descriptions.
- **Description verbatim.** D03 copies the description from D02's KV. Never strips, summarises, or normalises — that data must be preserved for D09's pattern matching against future corrections.
- **`dedupeKey`** = SHA-256(`statement_id|date|amount_minor|description`). Computed at insert time. The unique index `bank_transactions_statement_dedupe_key` makes the insert idempotent.
- **`match_status`** initial value: `unmatched` for normal rows; `flagged` for fallback-mode rows; `out_of_scope` for `category=inter_account_transfer` and `category=salary` and `category=bank_charge` (these never need invoice matching). The full mapping is owned by D06.
- **Confidence storage.** `interpretation_confidence` is written as `numeric(3,2)`. Never as JS `number` directly — convert via the Drizzle `numeric` mode and round to 2 dp.

---

## 8. LLM Usage

D03 makes one LLM call per statement, only over the unmatched residue from §7.2. If every row matches a rule (mature stage with rich client knowledge), no LLM call is made.

- **Provider / model:** OpenAI `gpt-4o-mini`.
- **When invoked:** Once per statement, only if at least one row is unmatched after the rule pre-filter.
- **Frequency:** Once per statement on average (assuming ≥1 unmatched row at any maturity stage).
- **Inputs:** ~1,500 token base system prompt + ~300–1,000 tokens of client-context block + ~250 tokens per unmatched transaction (Markdown KV block).
- **Outputs:** ~80 tokens per unmatched transaction.
- **Temperature, timeout:** `temperature: 0`, `timeout: 120_000` ms.
- **Retries / fallback:** Two attempts. On second failure or schema mismatch: apply per-row fallback (§7.4), do not throw. The statement still parses.
- **Data compliance:** Client context contains business descriptions and known counterparty names. OpenAI zero-data-retention required (PRD §0.2). Disclose in privacy policy.

### 8.1 System prompt template

```
You are a CA reviewing bank transactions for a client whose business you know
well. The client's business context is provided below. Use it to reason about
each transaction with the same judgement you would apply to a long-standing
client whose patterns you have learned.

CLIENT CONTEXT
Business: {industry} | {business_type} | {legal_structure}
GST registration: {gst_registration_type}
Description: {description}
Transaction mode: {primary_transaction_mode}
Has inter-company transactions: {has_inter_company_transactions}
Known bank accounts: {bank_accounts_serialised}

KNOWN VENDORS (already pre-filtered out of this batch — included for context only,
so you understand the client's vendor landscape):
{known_vendors_serialised_or "(none)"}

KNOWN CUSTOMERS (already pre-filtered out — included for context):
{known_customers_serialised_or "(none)"}

KNOWN RECURRING DEBITS (already pre-filtered out — included for context):
{active_loans_serialised_or "(none)"}

OWNER DRAWINGS PATTERN (already pre-filtered when matched):
{owner_drawings_pattern_serialised_or "(none)"}

SEASONALITY:
{seasonality_serialised_or "(none)"}

CASH DEPOSIT PATTERN (only relevant if transaction_mode is cash_heavy):
{cash_deposit_pattern_serialised_or "(none)"}

INSTRUCTIONS
You will receive a list of transactions in Markdown KV format. These are the
transactions that did NOT match any rule and need your judgement.

For each transaction, return a JSON object:
{
  "transaction_index": int,         // exactly the integer N from the "## Transaction N" header
  "needs_invoice": boolean,
  "category": one of [
    "vendor_payment", "customer_receipt", "salary", "bank_charge",
    "inter_account_transfer", "loan_emi", "owner_drawing",
    "tax_payment", "unknown"
  ],
  "reasoning": string,              // one sentence, plain language, no jargon
  "confidence": number               // 0.0 to 1.0
}

Return a JSON array only. No prose, no markdown fences. Order does not matter
but every input transaction_index must appear exactly once in the output.

Rules:
- needs_invoice=true: vendor payments, supplier purchases, professional services,
  utilities, rent, subscriptions, retail purchases, anything where a third-party
  invoice is reasonably expected to exist.
- needs_invoice=false: salary/payroll runs, bank charges and fees, inter-account
  transfers, loan EMIs, tax payments, returned credits, opening balance entries,
  customer receipts, owner drawings.
- When uncertain on needs_invoice, default to true — it is better to request an
  invoice that is not needed than to miss one that is.
- For category="unknown", the reasoning must explain specifically why the
  transaction is ambiguous (e.g., "Description is opaque IMPS reference with no
  identifiable counterparty").
- The client's industry, GST registration, and transaction mode should anchor
  your reasoning. A cash-heavy retail business has different cash flow norms
  than a digital-first consultancy. A composition-scheme dealer cannot claim
  ITC, so the urgency around capturing GST invoices is different.
- If the client has inter-company transactions flagged, treat large NEFT/RTGS
  transfers to unidentified parties as "possible related-party transfer — verify"
  rather than a definite vendor payment.
```

### 8.2 User message template

```
Classify these {N} transactions:

{markdown_kv_blocks_for_unmatched_transactions}
```

Each `## Transaction N` block is copied verbatim from D02's `phase1_markdown`. The `transaction_index` is the same `N`.

### 8.3 Output schema (Zod-validated)

```ts
z.array(z.object({
  transaction_index: z.number().int().positive(),
  needs_invoice: z.boolean(),
  category: z.enum([
    'vendor_payment', 'customer_receipt', 'salary', 'bank_charge',
    'inter_account_transfer', 'loan_emi', 'owner_drawing',
    'tax_payment', 'unknown',
  ]),
  reasoning: z.string().min(1),
  confidence: z.number().min(0).max(1),
}));
```

After parse: assert that the set of `transaction_index` values exactly matches the set of unmatched indices sent in. Mismatch → schema-mismatch retry; on second failure → fallback per §7.4.

### 8.4 What D03 does not use an LLM for

- The rule pre-filter (deterministic substring match with `client_knowledge`).
- The pre-rendering of the client context block (Tier 1 + Tier 2 serialised).
- The integrity checks (deterministic).
- `interpretation_confidence` for rule-matched rows (always 1.0 × extraction_confidence).
- Computing `amount_minor` (deterministic from D02's KV).

---

## 9. Economics

Reference: PRD v6 §21 (D03 corresponds to "Phase 5 normalisation").

| Component | Per unit | Frequency | Notes |
|---|---|---|---|
| GPT-4o mini call (one per statement) | ~$0.001 baseline; rises with unmatched count | per statement | ~2,500 in @ $0.15/M + ~1,200 out @ $0.60/M assumed in PRD; D03 prompt is heavier (+~500–1,000 tokens of client context) but only the residue is in the user message, so net cost depends on rule hit rate |
| Postgres writes | negligible | per row | one bulk insert + one row update + one log row |

**Expected cost trajectory:**

- **Cold start (no client_knowledge seeded):** every row goes to LLM. Cost ≈ $0.0015 per statement of 50 rows.
- **Mature (client_knowledge seeded with 5–10 vendors, 1–3 loans, drawings pattern):** ~60–80% rule hit rate. LLM call shrinks to ~10–20 rows, cost ≈ $0.0005 per statement.
- **Very mature (after 6+ months of D09 promotions):** ~90%+ rule hit rate. LLM may not be called at all on some statements.

**Watch metrics:**

- `rule_hit_rate` per client_org and global. Rising rate is the goal — flat or falling means client_knowledge is stale and needs CA attention (or D09 promotion is broken).
- `llm_fallback_rate` (statements where both LLM attempts failed). >1% sustained → investigate model/prompt regression (PRD §6.9 in archive).
- `integrity_error_rate` (`NormalisationIntegrityError` per 1000 statements). Should be ≈ 0. Any non-zero rate is a hard signal of LLM-induced row drops or a bug in the integrity guard.
- `categorisation_correction_rate` from D09 — fraction of rows the CA overrides. Per category, per `interpretation_method`. Used to calibrate per-method confidence and to identify weak rule patterns.

---

## 10. Failure Modes

| Failure | Trigger | Impact | Severity | Recovery |
|---|---|---|---|---|
| `MissingClientProfileError` | `client_profiles` row absent for `client_org_id` | Statement marked `failed`, no retry; CA support seeds the profile and re-runs | high | Manual — CA support inserts profile, re-enqueues. Loud-fail-by-design (option (ii) in spec discussion). |
| `InvalidPhase1MarkdownError` | `phase1_markdown` is null or fails to parse against the D02 contract | Statement marked `failed` | high | Indicates D02 produced bad output — investigate D02. Should be impossible if D02 integrity guards held. |
| `StatementNotInPhase1Complete` | Pre-flight: status is anything other than `phase1_complete` | No-op return, idempotent | low | Self-resolving (job re-enqueued for an already-parsed statement). |
| `LlmCallError` (first attempt) | OpenAI API timeout, error, or empty response | Retry one more time | medium | Self-resolving on retry. |
| `LlmSchemaError` (first attempt) | Output failed Zod parse or `transaction_index` set mismatch | Retry one more time | medium | Self-resolving. |
| `LlmFallbackApplied` | Both LLM attempts failed | **Not a failure** — degrades to per-row fallback (§7.4); statement still parses; rows flagged for CA | medium | CA reviews flagged rows. `statement_parse_log.normalisation_mode='fallback'` records the run. |
| `NormalisationIntegrityError` (row count) | Rows-to-insert count ≠ frontmatter `transaction_count` | Statement marked `failed`, nothing inserted | high | Hard block by design — guarantees no silent data loss. Investigate the LLM output that caused it; may indicate model regression. |
| `NormalisationIntegrityError` (sum) | Σ amount_minor of D03 rows ≠ Σ (debit + credit) from D02 KV | Statement marked `failed`, nothing inserted | high | Same as above. |
| `DbWriteError` (transient) | Postgres connection blip, deadlock, etc. | BullMQ retries the whole job | medium | Self-resolving. The whole D03 run re-executes; idempotent thanks to dedupeKey + status guards. |
| `DbWriteError` (persistent) | Schema constraint violation, FK error | Statement marked `failed` | high | Indicates a D03 / schema bug. Sentry alerts. |
| `RuleEvaluationError` | Malformed JSONB in `client_knowledge` (e.g., `description_patterns` not array) | Treat as no-rule-match, log warning, continue to LLM path | low | O03 owns data integrity; D03 logs and proceeds. |
| `TenantIsolationError` (theoretical) | `client_profiles` or `bank_transactions` write touches the wrong `client_org_id` | **Critical** — cross-tenant leakage | critical | Hardcoded `client_org_id` filter in every read/write; unit-test asserts isolation; if it ever fires, halt the worker. |

D03 has **no terminal failures from LLM unavailability.** That is policy, not an oversight (§7.4).

---

## 11. Dependencies

**Depends on (modules):**

- **D02 — statement-format-extraction** for the `phase1_markdown` document and the `phase1_complete` status.
- **O03 — client-knowledge-capture** for `client_profiles` (required) and `client_knowledge` (optional). D03 spec is independent of O03's spec but D03's *operational utility* depends on Tier 1 being seeded for every active client.
- **F02 — tenant-isolation** for `client_org_id` scoping.

**Depended on by (modules):**

- **D06 — transaction-invoice-matching** consumes the `match.scan` job D03 enqueues, plus reads `bank_transactions` rows.
- **D07 — double-entry-engine** reads matched `bank_transactions` (post-D06) to produce journal entries.
- **D09 — transaction-corrections-feedback** reads `bank_transactions.{category, reasoning, interpretation_method, interpretation_confidence}` to compare against CA overrides.
- **X01 — day-book-export** reads `bank_transactions` filtered by `category` and join-resolved match status.
- **X05 — submission-status-bo** reads counts of `flagged` rows to display "transactions needing your attention" to BOs.

**External services:**

- OpenAI API — `gpt-4o-mini` for the residue classification.
- PostgreSQL — Drizzle ORM client.
- Redis — BullMQ.

**Files D03 owns (post-refactor target):**

- `workers/interpret.worker.ts` — **new**; D03 worker. Extracted from current `workers/statement.worker.ts`.
- `lib/statement-interpretation/` — **new module dir**; mirrors `lib/statement-parser/` for D02.
  - `lib/statement-interpretation/parse-markdown-kv.ts` — parses D02's KV string back into structured form.
  - `lib/statement-interpretation/rule-prefilter.ts` — the five rules in §7.2.
  - `lib/statement-interpretation/build-context.ts` — assembles the client-context block.
  - `lib/statement-interpretation/classify-llm.ts` — the GPT-4o mini call (replaces `lib/statement-parser/normalise.ts`).
  - `lib/statement-interpretation/integrity-checks.ts` — the count + sum guards from §7.5.
  - `lib/statement-interpretation/insert-transactions.ts` — the transactional DB write.
- The current `lib/statement-parser/normalise.ts` is **retired** — its functionality is replaced by `classify-llm.ts` with a richer prompt and the rule pre-filter wrapper.
- A Drizzle migration adding the six columns from §4.1 to `bank_transactions`.

---

## 12. Open Questions

1. **`category` enum jurisdiction extension.** The current enum is India-shaped. Ireland/Canada V1 are scaffold-only per CLAUDE.md V1 scope guards, but at some point `vat_payment` (Ireland) and `gst_hst_payment` (Canada) become real categories. Decide whether to widen the enum now (cheap, no rules) or migrate later when activated.
2. **Confidence calibration after alpha.** The 0.30 fallback constant and the 1.0 rule constant are intuitions, not data. Once 30+ statements are processed and CA correction rates are observable per `interpretation_method`, recalibrate.
3. **D09 → rule patterns auto-promotion.** When CAs repeatedly override the same NEFT/RAMESH-style description, D09 may promote it to `client_knowledge.known_vendors`. The mechanics live in D09, but D03's `reasoning` and `matched_known_vendor_name` columns are the substrate. Confirm the data flow when D09 is specced.
4. **Multi-pattern owner drawings.** Today `client_knowledge.owner_drawings_pattern` is a single object with one `typical_description_pattern`. Some businesses have multiple drawing patterns (cash + UPI + salary self-payment). Decide whether to evolve the O03 schema to an array — affects D03's rule 5 scope.
5. **Match-queue payload contract.** §6 specifies a placeholder shape for `match.scan`; D06 will pin the actual contract. Coordinate when D06 is specced.
6. **LLM model choice.** `gpt-4o-mini` is the cost-optimal default. If alpha shows >5% LLM fallback rate or >10% CA-correction rate on `method=llm`, evaluate `gpt-4o` or `gpt-4.1-mini` — the prompt is small enough that the price gap may be tolerable.
7. **Description-matching robustness.** Current rule pre-filter uses case-insensitive substring matching. Indian bank descriptions contain noise (account numbers, transaction reference IDs, partial names). Consider adding a normalisation step (uppercase, strip digits, collapse whitespace) before substring match — but be careful not to over-normalise and create false positives.
8. **Rule-hit reasoning depth.** Rules currently produce a templated `reasoning` string. When D09 promotes a CA correction back into `client_knowledge`, the original `reasoning` doesn't capture *why* the engine got it wrong (e.g., the description pattern was too narrow). Consider richer reasoning that includes the matched substring — but adds storage cost.
9. **Per-row LLM confidence reliability.** Models tend to over-state confidence. Consider clamping LLM-stated confidence to `[0.5, 0.9]` until calibrated against alpha correction data.

---

## 13. Change Log

| Date | Change | By |
|---|---|---|
| 2026-05-03 | Initial spec; status `SPECCED`. Adds six columns to `bank_transactions` via Drizzle migration. Pins the rule pre-filter (5 rules), the LLM prompt template, the integrity checks (row count + sum), the fallback policy (graceful degrade, never hard-fail on LLM unavailability), the missing-profile policy (loud hard-fail in alpha), and the `match.scan` enqueue. Lifts content from `docs/archive/client-knowledge-schema.md` (which sketched the prompt template) and rescopes to D03-only. | Bani / Claude |
