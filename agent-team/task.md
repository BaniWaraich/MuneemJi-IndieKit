# Agent Team — Task Definitions

> This file is the authoritative source of truth for what the team is building.
> It is **read-only** for agents during execution. Only Bani updates this file.
> Before writing any code, an agent must confirm the relevant module has status
> `SPECCED`, `IMPLEMENTED`, or `STABLE` in `docs/modules/INDEX.md`.

---

## Operating Rules

1. **Read `agent-team/progress.md` at the start of every session** to pick up where the last agent left off.
2. **Update `agent-team/progress.md`** every time you complete a sub-task or change state.
3. **Block on uncertainty — never guess.** If anything is ambiguous, add it to `agent-team/report.md` under the Blockages section and stop that sub-task until an answer appears.
4. **Context budget:** When you estimate you have consumed ~60% of your context window, immediately stop coding, write a complete handoff entry in `agent-team/handoff.md`, and end the session. Do not try to squeeze in more work.
5. **Module boundaries are non-negotiable.** Follow the skill boundaries in `CLAUDE.md` exactly — the api skill owns API routes, inngest-handler owns Inngest functions, frontend owns pages/components, db-handler owns schema.
6. **Propose, then wait.** Write your implementation plan in `progress.md` before writing code. If you are unsure whether Bani approves, add a question to `report.md`.

---

## Task 1 — Locked PDF Support

### Problem

HDFC and many other Indian banks issue password-protected PDFs. The current upload flow fails silently or with an opaque error when a locked PDF reaches the Python sandbox — `pdfplumber.open()` throws `pdfminer.pdftypes.PDFPasswordIncorrect` without a password and the sandbox returns a non-zero exit code. The user has no idea why parsing failed and must manually unlock the PDF before re-uploading.

### Goal

A user should be able to upload a password-protected PDF without any pre-processing. The system detects encryption, asks for the password, and then processes it normally. From the user's perspective it feels like one seamless upload flow.

### Scope

- **In scope:** Detection of encrypted PDFs in the sandbox, a new API endpoint or parameter to pass the password, UI prompt for password entry, passing the password through the extraction chain to pdfplumber.
- **Out of scope:** Storing passwords, changes to how transactions are stored or displayed after successful parsing, any changes to D03 (statement-interpretation), any changes to the CSV path.

### Affected Files & Modules

| Layer | File | Module |
|-------|------|--------|
| Python sandbox | `docker/python-sandbox/extract-pages.py` | D02 |
| Python sandbox | `docker/python-sandbox/server.py` | D02 |
| Inngest function | `src/lib/inngest/functions/statement-extract.ts` | D02 |
| Sandbox client | `src/lib/statement-parser/sandbox-client.ts` | D02 |
| PDF LLM parser | `src/lib/statement-parser/pdf-llm-parser.ts` | D02 |
| API route | `src/app/api/v1/clients/[id]/statements/[sid]/unlock/route.ts` *(new)* | D01 / D02 |
| Frontend | `src/app/(accountant)/clients/[id]/statements-panel.tsx` | frontend |
| Frontend | `src/app/(owner)/owner/statements/page.tsx` | frontend |

### Detailed Implementation Steps

#### Step 1 — Sandbox: detect and unlock (db-handler / inngest-handler skill)

**`docker/python-sandbox/extract-pages.py`**

- After `pdfplumber.open(pdf_path)`, catch `pdfminer.pdftypes.PDFPasswordIncorrect` (or the equivalent pdfplumber exception).
- If no password was provided in the call: return exit code `2` and emit `{ "encrypted": true }` to stdout so the server can surface a machine-readable signal.
- If a password was provided but is wrong: return exit code `3` and emit `{ "encrypted": true, "wrong_password": true }`.
- If a password was provided and correct: proceed normally.
- Accept the password as an optional second CLI argument: `python extract-pages.py <pdf_path> [password]`.

**`docker/python-sandbox/server.py`**

- Accept an optional `"password"` field in the JSON body of `POST /extract-pages`.
- Pass it as the second CLI argument when calling `extract-pages.py`.
- On exit code `2`: return HTTP 422 with body `{ "error": "encrypted", "requiresPassword": true }`.
- On exit code `3`: return HTTP 422 with body `{ "error": "wrong_password", "requiresPassword": true }`.
- The password must never appear in structured logs — redact before logging.

#### Step 2 — Sandbox client & Inngest function (inngest-handler skill)

**`src/lib/statement-parser/sandbox-client.ts`**

- `extractPdfPages(buffer, jobId, password?: string)` — add the optional `password` parameter and include it in the POST body to `/extract-pages`.
- Handle the new 422 responses: throw typed errors `EncryptedPdfError` (no password) and `WrongPdfPasswordError` (wrong password). These must be exported for the Inngest function to catch.

**`src/lib/inngest/functions/statement-extract.ts`**

- When `EncryptedPdfError` is thrown:
  - Update `bank_statements.status = 'password_required'` (new status value — see Step 3).
  - Do **not** retry (this is not a transient error).
  - Do not mark as `failed`.
- When `WrongPdfPasswordError` is thrown:
  - Update `bank_statements.status = 'password_required'` with `error_message = 'The password you entered is incorrect. Please try again.'`
  - Do not retry.
- Expose `password?: string` as part of the Inngest event data so that when the unlock endpoint re-fires the event it can pass the password through.

#### Step 3 — Schema (db-handler skill)

**`src/db/schema/muneem.ts`** — `bank_statements.status` enum

Add two new status values:
- `'password_required'` — sandbox detected encryption, waiting for user to supply password
- `'unlocking'` — password received, re-processing in progress

Add a Drizzle migration for the enum extension.

> **Do not store the password** in any column. Passwords are in-flight only — passed via the API call and the Inngest event payload, never persisted.

#### Step 4 — API unlock route (api skill)

New route: **`POST /api/v1/clients/:id/statements/:sid/unlock`**

- Auth: CA session OR linked-BO session; same `requireFirmOrOwnerForClient` ownership check as D01.
- Request body: `{ "password": string }` — max 128 chars, non-empty.
- Validation: statement must exist, belong to this client, and have `status = 'password_required'`. Return 409 otherwise.
- Action:
  1. Transition `bank_statements.status → 'unlocking'`.
  2. Fire `muneem/statement.uploaded` Inngest event with `{ statementId, password }` — reuses D01's event so D02's Inngest function triggers again.
- Response 200: `{ "queued": true }`.
- Errors: 404 (not found / wrong client), 409 (wrong status), 400 (validation fail).

> The password travels in the Inngest event payload (in-memory / encrypted Inngest transport). It is never written to the database.

#### Step 5 — Frontend (frontend skill)

**Statement detail page / statements panel** (both CA and BO views):

- When `statement.status === 'password_required'`, show an inline prompt with:
  - Text: "This PDF is password-protected. Enter the PDF password to continue processing."
  - A password input field (type=password).
  - A "Unlock & Process" submit button.
  - If `statement.errorMessage` contains "incorrect", show it as an error under the field.
- On submit, call `POST /api/v1/clients/:id/statements/:sid/unlock` with the password.
- On success, optimistically update the displayed status to "Processing…" and poll/refresh.
- This prompt appears **in-place** on the statements panel — not a modal, not a separate page.

**No password is stored in component state longer than the form interaction.** Clear the field on submit.

### Acceptance Criteria

- [ ] Uploading a locked HDFC PDF transitions the statement to `password_required` (not `failed`).
- [ ] The UI shows a password prompt for any statement in `password_required` status.
- [ ] Entering the correct password triggers re-processing and the statement eventually reaches `parsed`.
- [ ] Entering the wrong password keeps the statement in `password_required` with a clear error.
- [ ] The password never appears in any log line, database column, or error message.
- [ ] Unlocked PDFs produce the same `phase1_markdown` output as manually pre-unlocked PDFs.

---

## Task 2 — Statement Detail Page

### Problem

The parsing pipeline (D02 + D03) is implemented and running, but the statement detail page at `/clients/:id/statements/:sid` is a bare-bones read — it shows a plain transaction table with date, description, and amount only. There is no way to inspect parsing quality: classification, confidence, `needs_invoice` flags, interpretation method, or reasoning are all invisible. During alpha, this makes quality monitoring impossible.

### Goal

Expand the statement detail page into two tabs:

1. **Parsed Output** — developer/QA view. Shows every transaction with its full classification metadata from D03.
2. **Invoices Needed** — product view. Shows only transactions where `needs_invoice = true`.

Both tabs display data already in the database — no new backend processing.

### Scope

- **In scope:** The CA-facing statement detail page at `src/app/(accountant)/clients/[id]/statements/[sid]/page.tsx`. Display-only changes.
- **Out of scope:** The BO-facing statement page (`(owner)/owner/statements/[sid]/page.tsx`) — leave it untouched for now. No new API routes — the page is a Next.js server component querying the DB directly. No new columns or migrations — all data already exists.

### Affected Files

| File | Change |
|------|--------|
| `src/app/(accountant)/clients/[id]/statements/[sid]/page.tsx` | Full rewrite into tabbed layout |

### Detailed Implementation

#### Tab 1 — Parsed Output

Columns to show (table, sortable by date):

| Column | Source | Notes |
|--------|--------|-------|
| Date | `bank_transactions.transactionDate` | DD/MM/YYYY format via `formatDateIN` |
| Description | `bank_transactions.description` | Full text, wrap |
| Amount | `bank_transactions.amountMinor` | `formatINR`, red for debit (<0), green for credit (>0) |
| Category | `bank_transactions.category` | Render as a styled badge/pill (colour-coded by category) |
| Invoice needed | `bank_transactions.needsInvoice` | Boolean badge: "Yes" (amber) / "No" (grey) |
| Method | `bank_transactions.interpretationMethod` | Small chip: `rule_*` in blue, `llm` in purple, `llm_fallback` in red |
| Confidence | `bank_transactions.interpretationConfidence` | Percentage (e.g. "72%"), colour: ≥80% green, 50–79% amber, <50% red |
| Reasoning | `bank_transactions.reasoning` | Truncated to 1 line, expand on hover/click |

Show a summary bar above the table:
- Total transactions
- Rule-matched count vs LLM count vs fallback count
- `needs_invoice` count
- Overall average confidence (weighted by count)

#### Tab 2 — Invoices Needed

Filter: `WHERE needs_invoice = true AND match_status != 'out_of_scope'`

Columns:

| Column | Source | Notes |
|--------|--------|-------|
| Date | `transactionDate` | DD/MM/YYYY |
| Description | `description` | Full text |
| Amount | `amountMinor` | `formatINR`, always debit so always red |
| Category | `category` | Badge |
| Status | `matchStatus` | `unmatched` → "Awaiting invoice" (amber), `flagged` → "Needs review" (red) |
| Reasoning | `reasoning` | 1 line, expand on hover |

If no `needs_invoice` transactions exist, show an empty state: "No invoices required for this statement."

#### Tab URL state

Use a `?tab=parsed` / `?tab=invoices` query param (read from `searchParams`) so the active tab is linkable and bookmark-able.

Default tab: `parsed`.

#### Statement header (keep and expand)

Keep the existing statement header (filename, period, currency, status, error). Add below it:

- If `status === 'password_required'`: show the password prompt (from Task 1).
- If `status === 'processing'` or `status === 'phase1_complete'` or `status === 'unlocking'`: show a "Parsing in progress — refresh to update" notice with a manual Refresh button.
- If `status === 'failed'`: show the error (already exists, keep).
- If `status === 'empty'`: show "No transactions were extracted from this statement."
- If `status === 'parsed'`: show nothing extra — just the tabs.

#### Design system

Follow `docs/frontend-conventions.md`. Use the existing Tailwind tokens and component patterns from other pages (e.g., `statements-panel.tsx`, `clients/[id]/page.tsx`). No new dependencies.

Tabs should look consistent with the rest of the app — a simple border-bottom underline style, not shadcn Tabs (unless already used elsewhere in the app).

### Acceptance Criteria

- [ ] The page renders two tabs: "Parsed Output" and "Invoices Needed".
- [ ] The active tab is reflected in the URL (`?tab=parsed` or `?tab=invoices`).
- [ ] Parsed Output shows all 8 columns with correct data, badges, and colour coding.
- [ ] The summary bar above Parsed Output shows correct counts.
- [ ] Invoices Needed shows only `needs_invoice=true` transactions with correct status labels.
- [ ] The password prompt (Task 1 UI) appears inline when `status==='password_required'`.
- [ ] Page is a Next.js server component — no `use client` on the page itself (sub-components for interactive bits like the password form may be client components).
- [ ] Design is consistent with existing pages.

---

## Task Dependencies

Task 2 is mostly independent of Task 1, **except** for the password prompt block in the statement header. An agent can implement Task 2 fully and leave a `TODO(task1): insert password prompt here` comment at the appropriate point if Task 1 is not yet done.

---

## Context Budget Protocol

When you estimate your context is at ~60% capacity:

1. Stop all new code work immediately.
2. Ensure all files edited so far are saved.
3. Write a complete handoff entry in `agent-team/handoff.md` (see that file for the required format).
4. Update `agent-team/progress.md` with current status.
5. End the session.

A fresh agent will pick up from `handoff.md` next session.
