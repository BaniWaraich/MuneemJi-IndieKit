---
id: D02
name: statement-format-extraction
status: IMPLEMENTED
owners: [worker, schema]
last_updated: 2026-05-03
---

# D02 — Statement Format Extraction

> Converts any uploaded bank statement (PDF or CSV) into a normalised **Markdown key-value document** stored on the `bank_statements` row. The output is a deterministic, lossless rendering of every transaction in the statement — no business classification, no client-context reasoning, no transaction inserts. D03 (`statement-interpretation`) consumes the Markdown KV plus client knowledge to produce the structured `bank_transactions` rows. D02 is the seam between "what the file contains" and "what those contents mean for this client."

---

## Status

`IMPLEMENTED` (2026-05-03) — `workers/statement.worker.ts` is now D02-only. PDF and CSV paths both end at `bank_statements.phase1_markdown` + `status='phase1_complete'|'empty'|'failed'` + parse-log row + (on success and non-empty) `statement.interpret` enqueue. No `bank_transactions` writes from D02. The deterministic Markdown KV renderer lives at `lib/statement-parser/render-markdown-kv.ts`. `lib/statement-parser/csv-llm-parser.ts` was reduced to the D02 boundary — `amount_minor` and `needs_invoice` removed from prompt + Zod schema. `lib/statement-parser/normalise.ts` retired (deleted; logic moved to D03's `classify-llm.ts`). No schema changes for D02 itself.

---

## 1. Purpose

Bank statements arrive in dozens of formats — every Indian, Canadian, and Irish bank uses a different PDF layout, and CSVs vary wildly in preamble length and column ordering. Without a uniform intermediate representation, every downstream consumer (D03, the day-book export, future reporting) would have to handle that variability. D02 absorbs all the format-specific complexity — pdfplumber column detection, multi-page handling, Claude-generated parsers, CSV preamble skipping — and emits a single canonical shape: Markdown frontmatter for statement metadata + one Markdown block per transaction. After D02, no module ever sees the raw PDF or CSV again.

---

## 2. Inputs and Outputs

**Inputs**

- A `bank_statements` row with:
  - `id`, `client_org_id`, `s3_key`, `filename`, `currency`
  - `scan_status === 'clean'` (gate enforced before D02 is reachable; F03 owns the transition)
  - `status === 'processing'`
- The raw file bytes at `s3_key` (downloaded by the worker at job start; the file never passes through Next.js).
- The `client_orgs.firm_id` resolved from the statement's `client_org_id` (used to scope `bank_parser_scripts` lookups).

**Outputs**

- `bank_statements.phase1_markdown` — a single text column populated with the Markdown KV document (format below).
- `bank_statements.status` transitions to one of `phase1_complete`, `empty`, or `failed`.
- `bank_statements.period_start`, `period_end`, `currency` — derived from extracted data and persisted on the row.
- `bank_statements.error_message` — populated only on `failed`.
- One row inserted into `statement_parse_log` for the extraction attempt (D02's columns only — see §4).
- On success and non-empty: a `statement.interpret` job is enqueued onto `statement.interpret.queue` with `{ statementId }`.
- New rows in `bank_parser_scripts` when a fresh script was generated and validated (atomic `INSERT ... ON CONFLICT DO NOTHING` keyed on `(firm_id, bank_identifier)` where `is_active = true`).

D02 explicitly does **not** produce: `bank_transactions` rows, `needs_invoice` flags, transaction categories, vendor identifications, journal entries, day book lines, or reminders. Those are downstream concerns.

### 2.1 Markdown KV format (the contract D03 consumes)

The output of D02 is one document per statement, stored as a string in `bank_statements.phase1_markdown`. The format is fixed; D03 parses against it; future consumers (replay, manual debug) read it directly.

```markdown
---
account_holder: SHARMA TEXTILES PVT LTD
account_number_last4: "4821"
bank_name: HDFC Bank
bank_identifier: hdfc
country: IN
period_start: 2026-04-01
period_end: 2026-04-30
opening_balance_minor: 12345600
closing_balance_minor: 8765400
currency: INR
transaction_count: 47
extraction_method: pdfplumber_cached
extraction_confidence: 0.95
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
- `description` is the bank-supplied narration verbatim — D02 does not strip prefixes, summarise, translate, or normalise vendor names. Only whitespace collapse (multi-line continuations are joined with a single space, see §3 of the Opus prompt).
- `date` is ISO 8601 (`YYYY-MM-DD`).
- `account_number_last4` is quoted to preserve leading zeros.
- `bank_identifier` is `null` when bank-identification regex didn't match — the `extraction_confidence` then carries a -0.10 penalty.
- Frontmatter `transaction_count` must equal the count of `## Transaction N` blocks. The renderer fails closed if it doesn't (see `KvIntegrityError`).
- Transactions are emitted in statement order (earliest first).

### 2.2 `extraction_confidence` heuristic

A scalar in `[0.0, 1.0]` summarising D02's trust in the extraction. D03 uses it to weight ambiguous-row reasoning. **Starting heuristics — open to tuning once we have alpha data:**

| Path | Base | Notes |
|---|---|---|
| PDF, cached script, balance validation passed | 0.95 | best case |
| PDF, fresh Opus script, balance validation passed first try | 0.80 | new format, validated |
| PDF, cached script failed balance, regenerated, balance validation passed | 0.65 | format drifted; new script untested |
| CSV via GPT-4o mini, balance validation passed | 0.75 | LLM-extracted preamble can drift |
| any path, balance validation skipped (statement has reconciling adjustments — see §12) | base − 0.20 | flagged for CA |
| any path, bank not identified by regex (`bank_identifier IS NULL`) | base − 0.10 | script not cacheable |

Confidence values are clamped to `[0.0, 1.0]` after penalties. If `extraction_method = 'pdfplumber_new'` and the regen cycle ran (`balance_check_pass` flipped from false to true), the regen path applies; otherwise the cached or fresh-first-try value applies.

---

## 3. Trigger Mechanism

D02 runs as a BullMQ worker consuming jobs from `statement.queue`. There is no API route that invokes D02 directly.

- **Producer:** D01 (`bank-statement-upload`) enqueues a `statement.queue` job with `jobId: "statement-{id}"`, `attempts: 3`, exponential backoff starting at 5s, after the upload API confirms S3 receipt and writes the `bank_statements` row.
- **Consumer:** `workers/statement.worker.ts` (post-refactor; today's worker also does D03 work — that part moves out).
- **Worker concurrency:** 2 (matches existing config).
- **Pre-flight gates checked at job start:**
  1. `bank_statements.scan_status === 'clean'`. If `pending` or `error`, throw `ScanNotCleanError` and let BullMQ retry. If `infected`, throw a terminal error and mark `failed`.
  2. Resolve `firm_id` via `client_orgs` join. Required for `bank_parser_scripts` scoping (tenant isolation).

D02 never receives an HTTP request, never returns an HTTP response, and never imports from `app/api/`.

---

## 4. Schema Tables Owned

| Table | Ownership | Notes |
|---|---|---|
| `bank_parser_scripts` | sole writer | Per-firm, per-bank pdfplumber script cache. Atomic insert-or-noop keyed on `(firm_id, bank_identifier)` where `is_active = true`. Scripts are deactivated (not deleted) on regeneration. |
| `bank_statements.phase1_markdown` | sole writer | The Markdown KV document. Empty before D02, populated on success. |
| `bank_statements.period_start` | sole writer | Derived from min(transaction date). |
| `bank_statements.period_end` | sole writer | Derived from max(transaction date). |
| `bank_statements.currency` | sole writer | Set on D02 success from extracted currency (validated against the row's existing currency from upload — mismatch is a hard fail). |
| `bank_statements.status` | shared | D02 owns transitions `processing → phase1_complete | empty | failed`. D03 owns `phase1_complete → parsed | failed`. F03 owns `processing` initial state. |
| `bank_statements.error_message` | shared | D02 sets on D02-caused `failed`. D03 sets on D03-caused `failed`. |
| `statement_parse_log` (D02 columns only) | sole writer of: `parse_method`, `balance_check_pass`, `transactions_found`, `opening_balance`, `closing_balance`, `computed_closing`, `extraction_row_count`, `extraction_sum_minor`, `parser_script_id`, `error_message`, `firm_id`, `statement_id` | One row per D02 attempt (success or failure). Wrapped in `safeWriteParseLog` so a log-write failure never masks a real extraction error. |
| `bank_statements` (other columns) | reader only | `id`, `client_org_id`, `s3_key`, `filename`, `scan_status`. |
| `client_orgs` | reader only | To resolve `firm_id`. |
| `bank_transactions` | **never touches** | Owned exclusively by D03. |
| `statement_parse_log.normalisation_mode`, `normalised_row_count`, `normalised_sum_minor` | **never touches** | Owned by D03. |

---

## 5. API Contracts

D02 exposes no HTTP routes. It is a worker module.

The two HTTP routes that *interact* with D02's outputs are owned by other modules:

- `GET /api/v1/clients/:id/statements/:sid` — returns `bank_statements` including `status`, `phase1_markdown` (when CA-side debug surface needs it), `error_message`. Owned by D01 (read-side).
- `POST /api/v1/clients/:id/statements/confirm` — confirms a guest/BO upload and enqueues `statement.queue`. Owned by D01.

If a future feature needs D02's Markdown KV exposed via HTTP, the route will live in D01 (statement read surface), not D02.

---

## 6. Queue Jobs

### Consumes

**`statement.queue` — `statement.extract`**

```ts
{ statementId: string }
```

- jobId: `statement-{statementId}` (idempotency key — duplicate enqueues are deduped by BullMQ)
- attempts: 3
- backoff: exponential, 5s base
- concurrency: 2

**Idempotency:** D02 is safe to retry. On retry, the worker re-runs from scratch — the only persistent side effects of a partial run are `statement_parse_log` rows (append-only, expected) and `bank_parser_scripts` writes (atomic ON CONFLICT DO NOTHING). The status column is the source of truth: a retry of a `phase1_complete` statement is a no-op.

### Publishes

**`statement.interpret.queue` — `statement.interpret`**

```ts
{ statementId: string }
```

- jobId: `interpret-{statementId}`
- attempts: 3
- backoff: exponential, 5s base
- Enqueued only when D02 transitions to `phase1_complete` (i.e., `transactions_found > 0`).
- **Not enqueued** when D02 transitions to `empty` or `failed`. `empty` is terminal — see §10 and PRD §15.

---

## 7. Correctness Rules

D02 has no business-classification logic. The rules below govern data integrity, tenancy, and the extraction-to-KV transformation.

1. **Tenant isolation.** Every `bank_parser_scripts` lookup, insert, and deactivation must include `firm_id` as the first filter. A script generated for `firmA` must never be returned for `firmB`. This is the regression guard for §5.12 of the original design doc.
2. **Sandbox isolation.** All LLM-generated Python scripts execute inside `docker/python-sandbox` only. Never `child_process.spawn` Python in the worker. Never `eval`. The sandbox runs with `env={}`, non-root UID 1500, read-only rootfs, tmpfs `/work`, no outbound network. The sandbox is the security boundary.
3. **Balance must reconcile.** Two checks run in sequence and must both pass:
   - **Endpoint check:** `opening_balance + Σcredits − Σdebits = closing_balance` within 1 paise tolerance.
   - **Running-balance check:** for each row `i`, `balance[i] = balance[i−1] ± amount[i]` within 1 paise.
   On first failure with a cached script: deactivate the script, regenerate via Opus, rerun in sandbox, re-validate. On second failure: terminal, mark `failed`.
4. **Money is BIGINT.** All amount fields in the Markdown KV are integer paise/cents. The conversion from extracted major units (LLM/script returns "4500.00") to minor units (`4500_00`) is `Math.round(major * 100)`, applied at rendering time. Never truncate.
5. **One side per row.** Exactly one of `debit_minor` / `credit_minor` is non-zero per transaction. If extraction returns both non-null, D02 throws `KvIntegrityError`.
6. **Description is verbatim.** Multi-line continuations (rows with no date and no amount) are joined to the prior transaction's description with a single space. Otherwise the bank's narration text is preserved character-for-character.
7. **Currency consistency.** Extracted currency must match the `bank_statements.currency` set at upload. Mismatch is a hard fail (`CurrencyMismatchError`).
8. **Frontmatter integrity.** `transaction_count` in the frontmatter must equal the count of `## Transaction N` blocks. If they don't match at render time, `KvIntegrityError`.
9. **Sandbox script cannot be re-used cross-firm.** `lookupScript(firmId, bankIdentifier)` is the only entry point. Scripts are stored per `(firm_id, bank_identifier)` even though the script content may be identical across firms — this is by design (§5.12 of the design doc) and may be revisited if a global cache is introduced (see §12).
10. **No side-effect writes outside the sole-writer table list.** D02 must not write to `bank_transactions`, must not enqueue `match.queue` or `ocr.queue`, must not call F05 (email-delivery) or F06 (notifications-inbox) directly. The only outbound effect on success is the `statement.interpret` enqueue.

---

## 8. LLM Usage

D02 makes two distinct LLM calls in two distinct paths. Both are followed by deterministic post-processing inside D02 (sandbox execution + Markdown KV rendering) — the LLMs never produce the final output directly.

### 8.1 Claude Opus 4.6 — pdfplumber script generation (PDF path, cache miss only)

- **Provider / model:** Anthropic Claude Opus 4.6 (`claude-opus-4-6`).
- **When invoked:** PDF path, after bank identification, when `lookupScript(firmId, bankIdentifier)` returns null OR a cached script's output failed balance validation.
- **Frequency:** Rare after initial ramp. Per PRD §21: ~50–100 calls one-time across Indian banks, ~30–50 across Canadian, ~20–30 across Irish — total platform cost ~$20–$40 over the lifetime of the script cache.
- **Inputs:** ~4,000 tokens (raw text from first 2 pages of the PDF, extracted by the trusted, baked-in `extract-text.py` script in the sandbox via `/extract-header` — no LLM-generated code is accepted on this endpoint).
- **Output:** ~2,000 tokens — a single Python pdfplumber script. Code-fenced markdown is stripped via `extractCodeBlock`.
- **Temperature, max_tokens, timeout:** SDK default temperature, `max_tokens: 16384`, `timeout: 120_000` ms.
- **Rate limit (D02-owned):** Two atomic Redis counters, both keyed by UTC date and reset at midnight UTC:
  - per-firm daily cap (default 3/day, env `SCRIPT_GEN_FIRM_DAILY_CAP`)
  - global daily cap (default 20/day, env `SCRIPT_GEN_GLOBAL_DAILY_CAP`)
  Both are incremented before the API call. Either cap exceeded → `RateLimitExceededError`. Counters expire after 24 hours.
- **Retries / fallback:** No retries on the API call itself. On failure (timeout, API error, malformed response, sandbox rejection of the generated script): one BullMQ-level retry by re-throwing.
- **Data compliance:** PDF header text contains account holder name and account number. Anthropic zero-data-retention should be enabled on the API plan (PRD §0.2). Disclose third-party AI processing in the privacy policy (F03 / legal scope).

**System prompt (verbatim, current):**

```
You are an expert Python developer specialising in PDF data extraction.
I am providing the raw text content of a bank statement PDF.
Your task is to write a complete, standalone Python script using pdfplumber
that extracts every transaction from this bank's statement format.

The script must:
1. Accept a single argument: the path to the PDF file
2. Print a JSON object to stdout with keys: "transactions", "opening_balance", "closing_balance", "currency"
3. Each transaction object in the "transactions" array:
   {
     "date": "YYYY-MM-DD",
     "description": string,   // raw text exactly as it appears — do not modify
     "debit": number | null,  // money out — positive number, null if not a debit row
     "credit": number | null, // money in — positive number, null if not a credit row
     "balance": number        // running balance after this transaction
   }
4. Handle multi-line transaction descriptions correctly:
   - A row with no date and no debit/credit value is a continuation of the previous row
   - Append its description text to the previous transaction's description
5. Skip header rows and footer rows (totals, page numbers, bank branding)
6. Handle page breaks correctly — the column header repeats on each page; skip it each time
7. Use column x-coordinate ranges to assign values to columns — do NOT rely on fixed y-coordinates
8. Sample at least 3 pages of the PDF before committing to column boundaries
9. Print ONLY the JSON object to stdout — no logging, no progress messages, no markdown

The script must be fully deterministic. It must not:
- Access the network (no sockets, no urllib/requests/http, no DNS)
- Read the system clock or environment variables (no os.environ, no datetime.now, no time.time)
- Read or write any file outside the PDF path provided as argv[1]
- Import subprocess, ctypes, socket, urllib, http, requests, os (except os.path), sys (except sys.argv / sys.stdout / sys.stderr), or any package that wraps these
- Execute shell commands

Also extract from the statement header:
   "opening_balance": number,
   "closing_balance": number,
   "currency": string  // ISO 4217

Return the complete Python script only. No explanation. No markdown fences.
```

**User-message template:**

```
Here is the raw text from the first 2 pages of the bank statement PDF:

<<<
{rawHeaderText}
>>>

Write the complete Python pdfplumber extraction script.
```

### 8.2 GPT-4o mini — CSV transaction-table extraction (CSV path, every statement)

- **Provider / model:** OpenAI `gpt-4o-mini`.
- **When invoked:** CSV path, every statement. CSVs skip the sandbox entirely because there is no untrusted code to execute and the format variability lives in the preamble shape, not the row shape.
- **Frequency:** Once per CSV statement uploaded.
- **Inputs:** ~2,000–10,000 tokens (entire raw CSV text). A warning is logged at >200,000 chars; over the model context, the call will fail and BullMQ retries.
- **Output:** A single JSON object with statement metadata + transaction rows. Code-fenced output is stripped via `extractCodeBlock`. Schema-validated via Zod.
- **Temperature, timeout:** `temperature: 0`, `timeout: 120_000` ms.
- **Retries / fallback:** Two attempts. On second failure (malformed JSON or schema mismatch): `CsvLlmParseError` → BullMQ retries the whole job. There is no rule-based fallback — the regex parser was retired because it broke on any statement with more than a few lines of preamble.
- **Data compliance:** CSV may contain account holder PII and full transaction descriptions. Same OpenAI zero-data-retention requirement.

**Output schema (Zod-validated; D02 boundary — no `needs_invoice`, no `amount_minor`):**

```ts
{
  currency: string;          // ISO 4217, length 3
  opening_balance: number;   // major units
  closing_balance: number;   // major units
  transactions: [
    {
      date: string;          // YYYY-MM-DD
      description: string;   // narration verbatim
      debit:  number | null; // major units; null if credit row
      credit: number | null; // major units; null if debit row
      balance: number;       // major units, running closing balance for this row
    }
  ];
}
```

> **Refactor note.** The current prompt in `lib/statement-parser/csv-llm-parser.ts` includes `amount_minor` and `needs_invoice` fields in the output schema. Both are removed during the D02 implementation refactor: `amount_minor` becomes a deterministic post-processing step inside D02 (`Math.round(major * 100)` with sign derived from which of debit/credit is non-null), and `needs_invoice` moves entirely into D03's prompt over the Markdown KV.

**System prompt (target — post-refactor):**

```
You are a bookkeeping assistant. The user will paste the entire raw text of a
bank statement CSV. Bank CSVs often start with many lines of preamble (account
holder, address, branch, statement period, separator rows of asterisks, etc.)
before the actual transaction table. Your job is to find the transaction table,
extract every transaction row, and return a single JSON object — no prose, no
markdown fences.

Output shape (return exactly this object):
{
  "currency": "INR",                  // ISO 4217 inferred from the statement
  "opening_balance": number,          // major units (e.g. rupees, NOT paise)
  "closing_balance": number,          // major units
  "transactions": [
    {
      "date": "YYYY-MM-DD",           // ISO 8601, normalised
      "description": string,          // the narration column, preserved exactly
      "debit": number | null,         // major units; null if this row is a credit
      "credit": number | null,        // major units; null if this row is a debit
      "balance": number               // running closing balance for this row, major units
    }
  ]
}

Rules:
- Skip header preamble rows of any length until you find the transaction table.
- One output object per transaction row. Do not merge rows or insert opening/closing balance rows as transactions.
- Exactly one of debit / credit is non-null per row. The other must be null. Never put 0 — use null.
- Preserve the original narration / description text exactly. Do not summarise, translate, or strip prefixes like UPI-, NEFT-, IMPS-.
- opening_balance: the balance before any transaction. If the statement prints it explicitly ("Opening Balance", "B/F", "Brought Forward"), use that. Otherwise derive it from the first transaction's balance minus its movement.
- closing_balance: the balance after the last transaction (the last row's balance value).
```

### 8.3 What D02 does not use an LLM for

- Bank identification (regex scoring in `lib/statement-parser/identify-bank.ts`).
- Markdown KV rendering (deterministic).
- Balance validation (deterministic).
- `extraction_confidence` (deterministic heuristic table — see §2.2).

---

## 9. Economics

Reference: PRD v6 §21.

| Component | Per unit | Frequency | Notes |
|---|---|---|---|
| Opus 4.6 script generation (cache miss) | ~$0.21 | per new (firm, bank) pair | 4,000 in @ $15/M + 2,000 out @ $75/M; one-time cost per bank format per firm |
| pdfplumber sandbox execution (cache hit) | ~$0.001 | per PDF statement | ECS Fargate compute, ~10s |
| GPT-4o mini CSV extraction | ~$0.001 | per CSV statement | ~2,500 in @ $0.15/M + ~1,200 out @ $0.60/M |
| S3 read of cached script | negligible | per cache hit | |
| Markdown KV write (Postgres) | negligible | per statement | one TEXT column update |

**Mature-stage cost per statement (cache hit):** ~$0.001 of D02's $0.005 total per-statement (the rest — GPT-4o mini normalisation $0.001 + S3 storage $0.003 — belongs to D03 / F03).

**Watch metrics:**

- `cache_miss_rate` — rolling 7-day. PRD baseline: ≤30% during ramp, ≤2% mature. Above 5% in mature stage → investigate (new banks not pattern-matched, scripts being deactivated too aggressively).
- `script_gen_quota_exhaustion_rate` — non-zero in production means caps need raising (Track 1 caps were 3/firm/day, 20/global/day).
- `regen_cycle_rate` — fraction of cache-hit jobs that triggered regeneration. Rising rate signals format drift at a bank.

Bounds on the firm-daily cap and global-daily cap are env-configurable so production can tune without a deploy.

---

## 10. Failure Modes

| Failure | Trigger | Impact | Severity | Recovery |
|---|---|---|---|---|
| `ScanNotCleanError` | `scan_status` is `pending` or `error` when D02 starts | Job re-enters BullMQ retry queue with backoff | low | Self-resolves once F03 sets `clean`; if `error`, F03 owns the next step |
| `ScanInfectedError` | `scan_status === 'infected'` | Statement marked `failed`, file quarantined | high | Terminal — F03 / CA support investigates |
| `S3DownloadError` (NoSuchKey) | Object missing or deleted before D02 download | Statement marked `failed` immediately, no retry | high | Manual re-upload required |
| `S3DownloadError` (network) | Transient S3 error | BullMQ retries with backoff | medium | Self-resolves on retry |
| `NotAPdfNorCsvError` | Magic-byte check fails (not `%PDF-`, no CSV signature) | Statement marked `failed` | medium | User re-uploads correct file |
| `BankIdentificationFailure` | No regex pattern matches the header text | **Soft** — proceeds without `bank_identifier`; script generated but not cached; `extraction_confidence` -0.10 penalty | low | Adds the header-text hash to `statement_parse_log` for offline pattern review |
| `SandboxUnavailableError` | `PYTHON_SANDBOX_URL` unreachable | All PDF statements fail until sandbox returns | critical | Sandbox `/healthz` should be probed at worker startup; container restart policy + alerting (F08) |
| `SandboxTimeoutError` | LLM-generated script ran >30s | One statement fails; sandbox kills subprocess | medium | If cached script was at fault, regen cycle replaces it; else BullMQ retry |
| `SandboxScriptError` | Generated script throws or returns non-JSON | Statement fails this attempt | medium | If cached, triggers regen cycle; else terminal after BullMQ retries |
| `ScriptGenerationFailure` | Anthropic API timeout, error, or empty response | Statement fails this attempt | high | BullMQ retries; rate-limit counter was already incremented (sunk cost) — see §12 |
| `RateLimitExceededError` | Per-firm 3/day or global 20/day cap hit on a cache miss | New-bank statements blocked until UTC midnight | medium | Tune `SCRIPT_GEN_FIRM_DAILY_CAP` / `SCRIPT_GEN_GLOBAL_DAILY_CAP` |
| `BalanceValidationError` (first) | Endpoint or running-balance check fails on cache hit | Triggers regeneration cycle (deactivate + regen + rerun) | high | Self-recovers on regen, else escalates |
| `BalanceValidationError` (second) | Regen path also fails balance | Terminal — statement marked `failed` | high | Engineering reviews logged header text; manual override (`skip_balance_check`) is **not** in scope for D02 alpha — see §12 |
| `CsvLlmParseError` | GPT-4o mini returns malformed JSON or schema mismatch on both attempts | Statement fails this attempt | medium | BullMQ retries the whole job |
| `CurrencyMismatchError` | Extracted currency ≠ `bank_statements.currency` from upload | Statement marked `failed` | medium | Indicates upload-time metadata bug or wrong-statement upload; CA notified |
| `KvIntegrityError` | Internal: `transaction_count` ≠ count of blocks, or both debit and credit non-zero on a row, or a row missing required fields at render time | Statement marked `failed` | high | Indicates a D02 code bug — Sentry alerts on this; should never occur in production |
| `ScriptCacheScopeViolation` | Theoretical: `lookupScript` returns a script for the wrong `firm_id` | **Critical** — cross-tenant data flow | critical | Hardcoded `firm_id` filter in every query; unit-test asserts isolation; if it ever fires, halt the worker |

**Statement marked `empty`** is not a failure. It is a terminal success state: D02 extracted zero transactions (genuinely blank statement, or a structure D02 couldn't find rows in). The CA is notified to investigate the file. D03 is **not** enqueued for empty statements.

---

## 11. Dependencies

**Depends on (modules):**

- **F03 — file-upload-virus-scan** for `scan_status === 'clean'` gate, S3 object presence, and `bank_statements` row creation. D02 will not run until F03 marks the file clean.
- **F02 — tenant-isolation** for `firm_id` resolution from `client_org_id`.
- **D01 — bank-statement-upload** as the producer that enqueues `statement.queue`. D01 owns the upload UX and the API route that confirms the upload.

**Depended on by (modules):**

- **D03 — statement-interpretation** — consumes the Markdown KV from `bank_statements.phase1_markdown` and the `statement.interpret` queue job.

**External services:**

- AWS S3 / MinIO — object storage for raw uploads.
- Redis — BullMQ queue + rate-limit counters.
- Python sandbox (Docker) — `PYTHON_SANDBOX_URL`; endpoints `GET /healthz`, `POST /extract-header`, `POST /extract`. Owned at infra layer; D02 is the only consumer.
- Anthropic API — Claude Opus 4.6 for script generation.
- OpenAI API — GPT-4o mini for CSV extraction.
- PostgreSQL — Drizzle ORM client.

**Files D02 owns (post-refactor target):**

- `workers/statement.worker.ts` — D02 worker (today this file is hybrid; the implementation task strips D03 work out)
- `lib/statement-parser/identify-bank.ts`
- `lib/statement-parser/script-cache.ts`
- `lib/statement-parser/sandbox-client.ts`
- `lib/statement-parser/run-pdfplumber.ts`
- `lib/statement-parser/csv-llm-parser.ts` (refactored to drop `amount_minor` / `needs_invoice` from schema)
- `lib/statement-parser/validate-balance.ts`
- `lib/statement-parser/rate-limit.ts`
- `lib/statement-parser/extract-code-block.ts`
- `lib/statement-parser/types.ts` (shared types — to be re-scoped to D02-only fields)
- `lib/statement-parser/render-markdown-kv.ts` — **new** file; deterministic renderer
- `docker/python-sandbox/**` — sandbox image (cross-cutting; D02 is the sole consumer in V1)

**Files D02 hands off to D03 in the implementation refactor:**

- `lib/statement-parser/normalise.ts` — moves to D03's lib path, prompt rewritten to consume Markdown KV + client knowledge
- The transaction-insert section of `workers/statement.worker.ts` — moves to a new `workers/interpret.worker.ts` (D03)

---

## 12. Open Questions

1. **`extraction_confidence` calibration.** The values in §2.2 are starting heuristics. Once we have ≥30 alpha statements, replay them through D02 and compute the empirical correlation between confidence and downstream D03 disagreement-with-CA rate. Adjust the table.
2. **Manual override for legitimate balance mismatches.** Some statements have legitimate reconciling items (adjustments, charges not shown as rows) that will never satisfy `opening + credits − debits = closing`. The PRD-archived design doc proposed a `skip_balance_check` flag exposed only in the CA admin UI. **Out of scope for D02 alpha** — alpha will mark such statements `failed` and CA support will manually re-upload with adjustments. Re-evaluate before Track 2.
3. **Global script cache.** Scripts are per-firm today (security default). A read-only global script cache would cut Opus calls dramatically once 10+ firms are onboarded but introduces a cross-firm data-flow surface. Decide before Track 2 launch.
4. **Per-file size cap.** S3 pre-sign enforces a total storage cap (F03) but not a per-file cap beyond the sandbox's 12 MB rejection. A pre-upload 15 MB cap would prevent the confusing "got through S3, sandbox 400" failure mode. Probably belongs in F03, but flag for coordination.
5. **Rate-limit cap accounting on Anthropic outage.** If the API call fails, we still incremented the counter. Ideally the failed call decrements on terminal error. Low-impact in alpha; revisit.
6. **Sandbox health-check at worker startup.** `GET /healthz` should fail-fast the worker process if sandbox is unreachable, rather than burning 35s timeouts on every job. Owner: this module on the worker side; sandbox image owner on the infra side.
7. **CSV magic-byte detection.** Currently distinguished from PDF by absence of `%PDF-`. Adding a positive CSV check (UTF-8 / common delimiter detection) would catch garbage uploads earlier. Low priority.
8. **Markdown KV size.** A 200-row statement renders to ~25 KB of Markdown. PostgreSQL TEXT handles this trivially; D03's LLM prompt will fit. If statements exceed ~1,000 rows, may need to chunk for D03's context window. Defer until observed.

---

## 13. Change Log

| Date | Change | By |
|---|---|---|
| 2026-05-02 | Initial spec; status `SPECCED`. Lifts and rescopes content from `docs/archive/bank-statement-parser-design.md` (which mixed D02 + D03 concerns). Codifies the Markdown KV format, the `extraction_confidence` heuristic, the queue split (`statement.queue` consumed; `statement.interpret.queue` published), and the schema ownership boundary. | Bani / Claude |
