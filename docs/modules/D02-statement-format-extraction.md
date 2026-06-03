---
id: D02
name: statement-format-extraction
status: IMPLEMENTED
owners: [inngest, schema]
last_updated: 2026-06-02
---

# D02 — Statement Format Extraction

> Converts any uploaded bank statement (PDF or CSV) into a normalised **Markdown key-value document** stored on the `bank_statements` row. The output is a deterministic, lossless rendering of every transaction in the statement — no business classification, no client-context reasoning, no transaction inserts. D03 (`statement-interpretation`) consumes the Markdown KV plus client knowledge to produce the structured `bank_transactions` rows. D02 is the seam between "what the file contains" and "what those contents mean for this client."

---

## Status

`IMPLEMENTED` (2026-06-02) — Inngest function `inngest/functions/statement-extract.ts` is the D02 worker, triggered by `muneem/statement.uploaded`. Both PDF and CSV paths end at `bank_statements.phase1_markdown` + `status='phase1_complete'|'empty'|'failed'` + one `statement_parse_log` row + (on success and non-empty) `muneem/statement.extracted` event to trigger D03.

**Architecture pivot from original spec:** The original design generated pdfplumber Python scripts via Claude Opus and cached them per `(firm_id, bank_identifier)`. This was removed as too fragile. The current approach uses pdfplumber (via a baked-in `extract-pages.py` sandbox script) to extract raw whitespace-layout text per page, then sends each page's text to GPT-4o mini for transaction extraction. This is more robust across format variations. `bank_parser_scripts`, `identify-bank.ts`, `script-cache.ts`, `run-pdfplumber.ts`, and `rate-limit.ts` were all removed as part of this pivot.

---

## 1. Purpose

Bank statements arrive in dozens of formats — every Indian, Canadian, and Irish bank uses a different PDF layout, and CSVs vary wildly in preamble length and column ordering. Without a uniform intermediate representation, every downstream consumer (D03, the day-book export, future reporting) would have to handle that variability. D02 absorbs all the format-specific complexity — pdfplumber page-text extraction, multi-page chunking, LLM page interpretation, CSV preamble skipping — and emits a single canonical shape: Markdown frontmatter for statement metadata + one Markdown block per transaction. After D02, no module ever sees the raw PDF or CSV again.

---

## 2. Inputs and Outputs

**Inputs**

- A `bank_statements` row with:
  - `id`, `client_org_id`, `s3_key`, `filename`, `currency`
  - `status === 'processing'`
- The raw file bytes at `s3_key` (downloaded by the Inngest function at job start; the file never passes through Next.js).
- The `client_orgs.firm_id` resolved from the statement's `client_org_id` (used for tenant-scoped logging).

**Outputs**

- `bank_statements.phase1_markdown` — a single text column populated with the Markdown KV document (format below).
- `bank_statements.status` transitions to one of `phase1_complete`, `empty`, or `failed`.
- `bank_statements.period_start`, `period_end`, `currency` — derived from extracted data and persisted on the row.
- `bank_statements.error_message` — populated only on `failed`.
- One row inserted into `statement_parse_log` for the extraction attempt (D02's columns only — see §4).
- On success and non-empty: `muneem/statement.extracted` event sent with `{ statementId }` to trigger D03.

D02 explicitly does **not** produce: `bank_transactions` rows, `needs_invoice` flags, transaction categories, vendor identifications, journal entries, day book lines, or reminders. Those are downstream concerns.

### 2.1 Markdown KV format (the contract D03 consumes)

The output of D02 is one document per statement, stored as a string in `bank_statements.phase1_markdown`. The format is fixed; D03 parses against it; future consumers (replay, manual debug) read it directly.

```markdown
---
account_holder: SHARMA TEXTILES PVT LTD
account_number_last4: "4821"
bank_name: HDFC Bank
bank_identifier: null
country: IN
period_start: 2026-04-01
period_end: 2026-04-30
opening_balance_minor: 12345600
closing_balance_minor: 8765400
currency: INR
transaction_count: 47
extraction_method: pdf_llm
extraction_confidence: 0.75
---

## Transaction 1

- date: 2026-04-02
- description: NEFT/RAMESH TEXTILES/INV-4521
- debit_minor: 4500000
- credit_minor: 0
- balance_minor: 7845600

## Transaction 2

- date: 2026-04-03
- description: UPI-9876543210@axis-PAYMENT FROM BHARAT POWER
- debit_minor: 0
- credit_minor: 25000000
- balance_minor: 32845600

## Transaction 3

...
```

**Rules:**

- All amounts are integer minor units (paise / cents) per the project-wide `BIGINT` rule. Never major units. Never floats.
- Exactly one of `debit_minor` / `credit_minor` is non-zero per transaction. The other is `0`. Never `null`. Never both non-zero.
- `balance_minor` is the running balance after this transaction.
- `description` is the bank-supplied narration verbatim — D02 does not strip prefixes, summarise, translate, or normalise vendor names. Only whitespace collapse (multi-line continuations are joined with a single space).
- `date` is ISO 8601 (`YYYY-MM-DD`).
- `account_number_last4` is quoted to preserve leading zeros.
- `bank_identifier` is always `null` in the current implementation — bank identification is deferred (see §12). The `extraction_confidence` penalty for unknown bank (`−0.10`) always applies.
- Frontmatter `transaction_count` must equal the count of `## Transaction N` blocks. The renderer fails closed if it doesn't (see `KvIntegrityError`).
- Transactions are emitted in statement order (earliest first).

### 2.2 `extraction_confidence` heuristic

A scalar in `[0.0, 1.0]` summarising D02's trust in the extraction. D03 uses it to weight ambiguous-row reasoning. **Current heuristics:**

| Path                                                           | Base  | Notes                                                          |
| -------------------------------------------------------------- | ----- | -------------------------------------------------------------- |
| PDF, GPT-4o mini per-page, balance validation passed           | 0.75  | LLM per-page extraction — good but can miss continuation rows  |
| CSV, GPT-4o mini, balance validation passed                    | 0.75  | LLM-extracted preamble can drift; same confidence as PDF path  |
| any path, balance validation skipped (reconciling adjustments) | −0.20 | applied as penalty to base                                     |
| any path, bank not identified (`bank_identifier IS NULL`)      | −0.10 | always applies in current implementation (bank ID is deferred) |

Confidence values are clamped to `[0.0, 1.0]` after penalties.

---

## 3. Trigger Mechanism

D02 runs as an Inngest function consuming `muneem/statement.uploaded` events. There is no API route that invokes D02 directly.

- **Producer:** D01 (`bank-statement-upload`) sends `muneem/statement.uploaded` with `{ data: { statementId } }` after the confirm route verifies the S3 PUT and transitions the `bank_statements` row to `processing`.
- **Consumer:** `inngest/functions/statement-extract.ts` — function id `muneem-statement-extract`.
- **Retries:** Inngest default retry policy (up to 4 retries with exponential backoff).
- **Pre-flight gates checked at step start:**
  1. Resolve `firm_id` via `client_orgs` join. Required for tenant-scoped logging.
  2. Fetch `bank_statements` row; verify `status === 'processing'`. Any other status → no-op (idempotency guard).

D02 never receives an HTTP request, never returns an HTTP response, and never imports from `app/api/`.

---

## 4. Schema Tables Owned

| Table                                    | Ownership                                                                                                                                                                                                                                            | Notes                                                                                                                                                                                       |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bank_statements.phase1_markdown`        | sole writer                                                                                                                                                                                                                                          | The Markdown KV document. Empty before D02, populated on success.                                                                                                                           |
| `bank_statements.period_start`           | sole writer                                                                                                                                                                                                                                          | Derived from min(transaction date).                                                                                                                                                         |
| `bank_statements.period_end`             | sole writer                                                                                                                                                                                                                                          | Derived from max(transaction date).                                                                                                                                                         |
| `bank_statements.currency`               | sole writer                                                                                                                                                                                                                                          | Set on D02 success from extracted currency (validated against the row's existing currency from upload).                                                                                     |
| `bank_statements.status`                 | shared                                                                                                                                                                                                                                               | D02 owns transitions `processing → phase1_complete \| empty \| failed`. D03 owns `phase1_complete → parsed \| failed`. D01 sets `processing` on row insert.                                 |
| `bank_statements.error_message`          | shared                                                                                                                                                                                                                                               | D02 sets on D02-caused `failed`. D03 sets on D03-caused `failed`.                                                                                                                           |
| `statement_parse_log` (D02 columns only) | sole writer of: `parse_method`, `balance_check_pass`, `transactions_found`, `opening_balance`, `closing_balance`, `computed_closing`, `extraction_row_count`, `extraction_sum_minor`, `parser_script_id`, `error_message`, `firm_id`, `statement_id` | One row per D02 attempt. Wrapped in `safeWriteParseLog` so a log-write failure never masks a real extraction error.                                                                         |
| `bank_statements` (other columns)        | reader only                                                                                                                                                                                                                                          | `id`, `client_org_id`, `s3_key`, `filename`.                                                                                                                                                |
| `client_orgs`                            | reader only                                                                                                                                                                                                                                          | To resolve `firm_id`.                                                                                                                                                                       |
| `bank_parser_scripts`                    | **not used**                                                                                                                                                                                                                                         | Table retained in schema but never written to. Will be dropped in a future migration once the script-caching design is formally retired or redesigned. `parser_script_id` is always `null`. |
| `bank_transactions`                      | **never touches**                                                                                                                                                                                                                                    | Owned exclusively by D03.                                                                                                                                                                   |

---

## 5. API Contracts

D02 exposes no HTTP routes. It is an Inngest worker module.

The two HTTP routes that _interact_ with D02's outputs are owned by other modules:

- `GET /api/v1/clients/:id/statements/:sid` — returns `bank_statements` including `status`, `phase1_markdown`, `error_message`. Owned by D01 (read-side).
- `POST /api/v1/clients/:id/statements/confirm` — confirms a guest/BO upload and sends `muneem/statement.uploaded`. Owned by D01.

---

## 6. Events

### Consumes

**`muneem/statement.uploaded`**

```ts
{
  statementId: string;
}
```

- Sent by D01 confirm route after S3 PUT verified.
- Inngest deduplication is by event id; D02 additionally guards via status check.

### Publishes

**`muneem/statement.extracted`**

```ts
{
  statementId: string;
}
```

- Sent only when D02 transitions to `phase1_complete` (i.e., `transactions_found > 0`).
- **Not sent** when D02 transitions to `empty` or `failed`.

---

## 7. Correctness Rules

1. **Tenant isolation.** Every DB read and write includes `client_org_id` or `firm_id`. No cross-tenant data flow.
2. **Sandbox isolation.** The only Python script executed by the sandbox (`extract-pages.py`) is baked into the sandbox image. No LLM-generated code is executed — the arbitrary-code `/extract` endpoint was removed. The sandbox runs non-root, drops the PDF immediately after each parse (stateless), caps bodies at 10 MB, kills the subprocess after 30s, and requires a `Bearer <PARSER_SECRET>` header on every request except `/healthz`.
3. **Balance must reconcile.** `opening_balance + Σcredits − Σdebits = closing_balance` within 1 paise tolerance. On failure: statement is marked `failed`. There is no regen cycle (old script-caching concept) — balance failure is terminal.
4. **Money is BIGINT.** All amount fields in the Markdown KV are integer paise/cents. Conversion from major units (LLM returns "4500.00") to minor units (`450000`) is `Math.round(major * 100)`, applied at rendering time.
5. **One side per row.** Exactly one of `debit_minor` / `credit_minor` is non-zero per transaction. If extraction returns both non-null, D02 throws `KvIntegrityError`.
6. **Description is verbatim.** The bank's narration text is preserved character-for-character. Multi-line continuations are joined with a single space.
7. **Currency consistency.** Extracted currency must match `bank_statements.currency` set at upload. Mismatch is a hard fail (`CurrencyMismatchError`).
8. **Frontmatter integrity.** `transaction_count` in the frontmatter must equal the count of `## Transaction N` blocks at render time. Mismatch → `KvIntegrityError`.
9. **No side-effect writes outside the owned table list.** D02 must not write to `bank_transactions`, must not send `match.*` or `ocr.*` events, must not call email/notification modules directly.

---

## 8. LLM Usage

D02 makes LLM calls in two distinct paths. Both are followed by deterministic post-processing inside D02 (Markdown KV rendering, balance validation) — the LLMs never produce the final output directly.

### 8.1 GPT-4o mini — PDF per-page transaction extraction (PDF path)

- **Provider / model:** OpenAI `gpt-4o-mini`.
- **When invoked:** PDF path, once per page of the PDF. Pages are processed with controlled concurrency (up to 4 in parallel).
- **Frequency:** Once per page per PDF statement. A 5-page statement = 5 LLM calls.
- **Inputs:** ~1,000–3,000 tokens per page (raw whitespace-layout text extracted by the baked-in `extract-pages.py` sandbox script via `/extract-pages`).
- **Output:** JSON object per page: `{ currency, transactions: [...] }`. Code-fenced markdown is stripped via `extractCodeBlock`. Schema-validated via Zod.
- **Temperature, timeout:** `temperature: 0`, `timeout: 180,000` ms (across all pages).
- **Retries / fallback:** Two attempts per statement (Inngest retries). On second failure → `PdfLlmParseError` → statement marked `failed`.

**System prompt (current — `lib/statement-parser/pdf-llm-parser.ts`):**

The prompt instructs the model to treat whitespace-separated columns as the field separator (not commas), skip preamble and footer rows, emit one object per transaction row, merge continuation lines into the previous row's description, and return `null` for the absent side of debit/credit rather than `0`.

**Per-page output schema (Zod-validated):**

```ts
{
  currency: string | null;       // ISO 4217 if inferable; null if preamble-only page
  transactions: [
    {
      date: string;              // YYYY-MM-DD
      description: string;       // narration verbatim
      debit: number | null;      // major units; null if credit row
      credit: number | null;     // major units; null if debit row
      balance: number | null;    // running closing balance, major units; null if blank
    }
  ]
}
```

Pages are merged in order; duplicate rows at page boundaries are deduplicated by D02 before rendering.

### 8.2 GPT-4o mini — CSV transaction-table extraction (CSV path, every statement)

- **Provider / model:** OpenAI `gpt-4o-mini`.
- **When invoked:** CSV path, once per statement.
- **Frequency:** Once per CSV statement uploaded.
- **Inputs:** ~2,000–10,000 tokens (entire raw CSV text). A warning is logged at >200,000 chars.
- **Output:** A single JSON object with statement metadata + transaction rows. Schema-validated via Zod.
- **Temperature, timeout:** `temperature: 0`, `timeout: 120,000` ms.
- **Retries / fallback:** Two attempts. On second failure → `CsvLlmParseError` → Inngest retries the whole job.

**System prompt target (post-refactor — D02 boundary: no `amount_minor`, no `needs_invoice`):**

```
You are a bookkeeping assistant. The user will paste the entire raw text of a
bank statement CSV. Bank CSVs often start with many lines of preamble (account
holder, address, branch, statement period, separator rows of asterisks, etc.)
before the actual transaction table. Your job is to find the transaction table,
extract every transaction row, and return a single JSON object — no prose, no
markdown fences.

Output shape:
{
  "currency": "INR",
  "opening_balance": number,
  "closing_balance": number,
  "transactions": [
    {
      "date": "YYYY-MM-DD",
      "description": string,
      "debit": number | null,
      "credit": number | null,
      "balance": number
    }
  ]
}

Rules:
- Skip header preamble rows of any length until you find the transaction table.
- One output object per transaction row. Do not merge rows.
- Exactly one of debit / credit is non-null per row. The other must be null. Never put 0 — use null.
- Preserve the original narration / description text exactly.
- opening_balance: the balance before any transaction.
- closing_balance: the balance after the last transaction.
```

### 8.3 What D02 does not use an LLM for

- Bank identification — `bank_identifier` is always `null` (deferred; see §12).
- Markdown KV rendering (deterministic).
- Balance validation (deterministic).
- `extraction_confidence` (deterministic heuristic table — see §2.2).
- Major-to-minor unit conversion (`Math.round(major * 100)`) — deterministic.

---

## 9. Economics

| Component                    | Per unit   | Frequency         | Notes                                                                 |
| ---------------------------- | ---------- | ----------------- | --------------------------------------------------------------------- |
| GPT-4o mini PDF extraction   | ~$0.002    | per PDF statement | ~3,000–8,000 in @ $0.15/M + ~500–2,000 out @ $0.60/M across all pages |
| GPT-4o mini CSV extraction   | ~$0.001    | per CSV statement | ~2,500 in @ $0.15/M + ~1,200 out @ $0.60/M                            |
| pdfplumber sandbox execution | ~$0.001    | per PDF statement | ECS Fargate compute, ~5–15s                                           |
| S3 download                  | negligible | per statement     |                                                                       |
| Markdown KV write (Postgres) | negligible | per statement     | one TEXT column update                                                |

**Watch metrics:**

- `balance_check_fail_rate` — non-zero in production means extraction quality issues (likely page-boundary merging or LLM returning `null` balances). Rising rate → investigate prompt or per-page merging logic.
- `empty_statement_rate` — statements that extracted 0 transactions. Normal for some edge cases; >5% sustained → investigate preamble detection.

---

## 10. Failure Modes

| Failure                       | Trigger                                                                           | Impact                                          | Severity | Recovery                                                     |
| ----------------------------- | --------------------------------------------------------------------------------- | ----------------------------------------------- | -------- | ------------------------------------------------------------ |
| `S3DownloadError` (NoSuchKey) | Object missing or deleted before D02 download                                     | Statement marked `failed` immediately, no retry | high     | Manual re-upload required                                    |
| `S3DownloadError` (network)   | Transient S3 error                                                                | Inngest retries with backoff                    | medium   | Self-resolves on retry                                       |
| `NotAPdfNorCsvError`          | Magic-byte check fails (not `%PDF-`, no CSV signature)                            | Statement marked `failed`                       | medium   | User re-uploads correct file                                 |
| `SandboxUnavailableError`     | `PYTHON_SANDBOX_URL` unreachable                                                  | All PDF statements fail until sandbox returns   | critical | Container restart policy + alerting (F08)                    |
| `SandboxTimeoutError`         | `extract-pages.py` ran >30s (sandbox kill) or >60s (client abort)                 | One statement fails; sandbox kills subprocess   | medium   | Inngest retry                                                |
| `PdfLlmParseError`            | GPT-4o mini returns malformed JSON or schema mismatch on both attempts            | Statement fails this attempt                    | medium   | Inngest retries the whole job                                |
| `CsvLlmParseError`            | GPT-4o mini returns malformed JSON or schema mismatch on both attempts            | Statement fails this attempt                    | medium   | Inngest retries the whole job                                |
| `BalanceValidationError`      | Endpoint check fails after extraction                                             | Terminal — statement marked `failed`            | high     | CA re-uploads; engineering reviews parse log for pattern     |
| `CurrencyMismatchError`       | Extracted currency ≠ `bank_statements.currency` from upload                       | Statement marked `failed`                       | medium   | Indicates upload-time metadata bug or wrong-statement upload |
| `KvIntegrityError`            | `transaction_count` ≠ count of blocks, or both debit and credit non-zero on a row | Statement marked `failed`                       | high     | Indicates a D02 code bug — Sentry alerts on this             |

**Statement marked `empty`** is not a failure. It is a terminal success state: D02 extracted zero transactions. The CA is notified to investigate the file. D03 is **not** triggered for empty statements.

---

## 11. Dependencies

**Depends on (modules):**

- **F02 — tenant-isolation** for `firm_id` resolution from `client_org_id`.
- **D01 — bank-statement-upload** as the producer that sends `muneem/statement.uploaded` after the confirm route accepts the upload.

**Depended on by (modules):**

- **D03 — statement-interpretation** — consumes the Markdown KV from `bank_statements.phase1_markdown` and the `muneem/statement.extracted` event.

**External services:**

- AWS S3 / MinIO — object storage for raw uploads.
- Python sandbox (Docker) — `PYTHON_SANDBOX_URL`; endpoints `GET /healthz` and `POST /extract-pages` only. Hosted on **Google Cloud Run** (scale-to-zero); local dev runs it via `docker-compose`. Every request except `/healthz` requires `Authorization: Bearer <PARSER_SECRET>` (shared secret in both the sandbox env and Vercel/Next.js env). Owned at infra layer; D02 is the only consumer.
- OpenAI API — GPT-4o mini for both PDF per-page extraction and CSV extraction.
- PostgreSQL — Drizzle ORM client.
- Inngest — event bus and job retry infrastructure.

**Files D02 owns:**

- `src/lib/inngest/functions/statement-extract.ts` — D02 Inngest function
- `src/lib/statement-parser/sandbox-client.ts`
- `src/lib/statement-parser/pdf-llm-parser.ts`
- `src/lib/statement-parser/csv-llm-parser.ts`
- `src/lib/statement-parser/validate-balance.ts`
- `src/lib/statement-parser/extract-code-block.ts`
- `src/lib/statement-parser/render-markdown-kv.ts` — deterministic Markdown KV renderer
- `src/lib/statement-parser/types.ts` — shared extraction types
- `docker/python-sandbox/**` — sandbox image; `extract-pages.py` is the sole baked-in extraction script for PDFs. Hosted on Cloud Run; Bearer-secret gated. (`extract-text.py` and the `/extract` arbitrary-code endpoint were removed.)

**Files removed in the architecture pivot (no longer exist):**

- `src/lib/statement-parser/identify-bank.ts` — bank identification (deferred; see §12)
- `src/lib/statement-parser/script-cache.ts` — pdfplumber script cache
- `src/lib/statement-parser/run-pdfplumber.ts` — dynamic script execution
- `src/lib/statement-parser/rate-limit.ts` — Redis-based script-generation rate limiting

---

## 12. Open Questions

1. **Bank identification (deferred).** `bank_identifier` is always `null` in the current implementation. A lightweight reimplementation — regex pass over the first page's extracted text, no LLM — would re-enable: (a) per-bank prompt hints injected into the PDF-LLM prompt for known formats, (b) observability dashboards segmented by bank, (c) D03 context injection ("this is an HDFC statement"), and (d) a future lightweight prompt-template cache keyed on `(firm_id, bank_identifier)`. Low priority for alpha; re-evaluate when extraction accuracy data is available.
2. **`bank_parser_scripts` table.** Retained in DB schema but never written to. Should be dropped in a future migration once bank identification / caching strategy is decided. The `parser_script_id` column on `statement_parse_log` is always `null`.
3. **`extraction_confidence` calibration.** The values in §2.2 are starting heuristics. Once we have ≥30 alpha statements, replay them through D02 and compute the empirical correlation between confidence and downstream D03 disagreement-with-CA rate. Adjust the table.
4. **Page-boundary deduplication.** Some banks repeat the last row of a page as the first row of the next page (running total row). Current deduplication logic uses date+amount+description hash; needs alpha data to confirm it handles all edge cases.
5. **Manual override for legitimate balance mismatches.** Some statements have reconciling items (adjustments, charges not shown as rows) that will never satisfy `opening + credits − debits = closing`. A `skip_balance_check` flag exposed only in the CA admin UI is out of scope for alpha — such statements are marked `failed` and CA support handles manually. Re-evaluate before Track 2.
6. **Markdown KV size.** A 200-row statement renders to ~25 KB of Markdown. PostgreSQL TEXT handles this trivially; D03's LLM prompt will fit. If statements exceed ~1,000 rows, may need to chunk for D03's context window. Defer until observed.
7. **`runInSandbox` dead code — RESOLVED (2026-06-02).** `runInSandbox` (the old LLM-generated `/extract` path) and `extractHeaderText` (`/extract-header`) were removed from `sandbox-client.ts`, along with the corresponding server endpoints and `extract-text.py`. `sandbox-client.ts` now exports only `extractPdfPages`.

---

## 13. Change Log

| Date       | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | By            |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| 2026-05-02 | Initial spec; status `SPECCED`. Lifts and rescopes content from `docs/archive/bank-statement-parser-design.md`. Codified pdfplumber script-generation architecture (Opus 4.6 + per-firm script cache + bank identification).                                                                                                                                                                                                                                           | Bani / Claude |
| 2026-06-02 | Rewrote to match actual implementation. Removed pdfplumber script-generation architecture (Opus, `bank_parser_scripts`, `identify-bank.ts`, `script-cache.ts`, `run-pdfplumber.ts`, `rate-limit.ts`). Updated to per-page GPT-4o mini PDF extraction + Inngest event bus. `bank_identifier` noted as deferred. Status → `IMPLEMENTED`.                                                                                                                                 | Bani / Claude |
| 2026-06-02 | Deployed the Python sandbox to **Google Cloud Run** (was Vercel-only → PDF parsing failed in prod). Hardened the service: removed the `/extract` (arbitrary-code) and `/extract-header` endpoints + `extract-text.py`; `sandbox-client.ts` exports only `extractPdfPages`. Added `Bearer <PARSER_SECRET>` auth, 10 MB body cap, 30s subprocess timeout, `$PORT`, stateless logging. Fixed local `docker-compose` port (8080) and removed dead `SCRIPT_GEN_*` env vars. | Bani / Claude |
