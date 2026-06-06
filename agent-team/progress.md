# Agent Team — Progress Tracker

> Agents: update this file whenever you complete a sub-task, change status, or start
> a new work block. Write entries in reverse-chronological order (newest at top).
> Be precise: say exactly what files were changed and what was left incomplete.

---

## Current State

|                    |                                                             |
| ------------------ | ----------------------------------------------------------- |
| **Session**        | A1 (Agent A) + B (Agent B, parallel)                        |
| **Active task**    | Task 1 (1.1–1.6 done by Agent A); Task 2 + 1.7 with Agent B |
| **Last agent**     | Agent A (Backend)                                           |
| **Last updated**   | 2026-06-05                                                  |
| **Handoff needed** | No                                                          |

---

## Task 1 — Locked PDF Support

### Status: `BACKEND DONE (1.1–1.6)` — 1.7 (frontend) with Agent B

#### Sub-tasks

| #   | Sub-task                                                                                               | Status  | Owner   | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| --- | ------------------------------------------------------------------------------------------------------ | ------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.1 | Schema: add `password_required` + `unlocking` to `bank_statements.status` enum                         | ✅ Done | Agent A | No SQL migration: `status` is a bare `text` col, no DB CHECK. TS-enum-only edit. `drizzle-kit generate` emits nothing.                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 1.2 | Sandbox: `extract-pages.py` — detect encryption, exit codes 2/3, optional password arg                 | ✅ Done | Agent A | Verified all 4 cases live against pdfplumber 0.11.4. Import: `pdfminer.pdfdocument.PDFPasswordIncorrect`.                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 1.3 | Sandbox: `server.py` — accept `password` in body, return 422 on codes 2/3, redact from logs            | ✅ Done | Agent A | Password never logged (only jobId/status/timing/exitCode).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 1.4 | `sandbox-client.ts` — add `password?` param, throw `EncryptedPdfError` / `WrongPdfPasswordError`       | ✅ Done | Agent A | Both errors exported; neither carries the password.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 1.5 | `statement-extract.ts` — catch typed errors, transition to `password_required`, pass password in event | ✅ Done | Agent A | No retry/no `failed` on these; idempotency guard now allows `unlocking`; onFailure guard excludes both new statuses.                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 1.6 | API: `POST /api/v1/clients/:id/statements/:sid/unlock`                                                 | ✅ Done | Agent A | New route. Body `{password}` (1–128). 200 `{queued:true}`, 400/404/409.                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 1.7 | Frontend: password prompt in statements panel (CA + BO views)                                          | ✅ Done | Agent B | All 3 surfaces covered. (1) CA detail page (`statement-unlock-prompt.tsx`). (2) CA list panel (`statements-panel.tsx`) renders the prompt inline on `password_required` rows. (3) BO view = same `StatementsPanel` reused by `(owner)/owner/statements/page.tsx`, so it inherits the prompt; unlock URL `:id` = `clientOrgId` (correct for owner ctx). Added optional `onSubmitted` prop to the prompt so the client-managed list re-fetches; detail/BO server pages fall back to `router.refresh()`. Poll loop now also covers `unlocking`. |

---

## Task 2 — Statement Detail Page

### Status: `DONE`

#### Sub-tasks

| #   | Sub-task                                                                                | Status  | Owner   | Notes                                                                                                                                           |
| --- | --------------------------------------------------------------------------------------- | ------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| 2.1 | Rewrite `statements/[sid]/page.tsx` with tabbed layout + searchParams for active tab    | ✅ Done | Agent B | Server component; `?tab=parsed\|invoices` via Link tabs (border-bottom underline).                                                              |
| 2.2 | Parsed Output tab — 8-column table, badges, summary bar                                 | ✅ Done | Agent B | All 8 cols. Summary bar: total, rule/llm/fallback, needs-invoice, avg confidence.                                                               |
| 2.3 | Invoices Needed tab — filtered table, status labels                                     | ✅ Done | Agent B | Filter `needsInvoice && matchStatus!=='out_of_scope'`. unmatched→"Awaiting invoice", flagged→"Needs review". Empty state copy.                  |
| 2.4 | Statement header status messages (processing / failed / empty / password_required stub) | ✅ Done | Agent B | password_required→unlock prompt (wired to 1.6); processing/phase1_complete/unlocking→"Parsing in progress" + Refresh; failed→error; empty→copy. |

---

## Work Log

_(Newest entry at top)_

### [2026-06-05] — Agent B (Frontend) — COMPLETE (1.7 remaining surfaces: CA list + BO view)

**Completed (tsc clean repo-wide, eslint clean on all changed files):**

- [1.7] Surfaced the password prompt on the two remaining surfaces so ANY `password_required` statement shows it (Task 1 acceptance criterion).
  - `src/app/(accountant)/clients/[id]/statements-panel.tsx` (CA list):
    - Widened `Statement['status']` union + `StatusBadge` to include `password_required` ("Password needed", amber) and `unlocking` ("Unlocking", blue).
    - Renders `<StatementUnlockPrompt clientOrgId statementId onSubmitted={refresh} />` inline beneath any `password_required` row (restructured the `<li>` to stack header + prompt).
    - Poll loop (`useEffect`) now refreshes while any row is `processing` **or** `unlocking`.
  - **BO view** — `src/app/(owner)/owner/statements/page.tsx` needed **no change**: it already reuses the same `StatementsPanel` with `clientOrgId={session.clientOrgId}`, so it inherits the prompt automatically. Unlock URL `:id` segment = `clientOrgId`, which the unlock route (`requireFirmOrOwnerForClient` + `bankStatements.clientOrgId === :id`) accepts for the BO session. Confirmed against the route source.
- **Refactor to `StatementUnlockPrompt`** (`statements/[sid]/statement-unlock-prompt.tsx`): added an optional `onSubmitted?: () => void` prop. On success it calls `onSubmitted()` when provided (client-managed list re-fetch via the panel's `refresh`), else falls back to `router.refresh()` (detail page + BO server page). No other prop changes — `clientOrgId` / `statementId` / `errorMessage` already fit all three surfaces. Detail-page usage unchanged (omits `onSubmitted`, keeps `router.refresh()`).

**Notes:**

- The list API GET and the owner server query do not select `errorMessage`, so the list/BO prompts don't pre-fill the "incorrect password" message (the detail page does). Acceptable — no backend touched per scope; a wrong-password retry still works via the form, and the row stays `password_required` for re-entry.
- Schema enum (Agent A 1.1) already includes both new statuses, so the widened union assigns cleanly with no type errors.

**Verification:** `tsc --noEmit` → 0 errors repo-wide; `eslint` on the 3 changed files → clean. No new deps, no backend/schema/route changes.

### [2026-06-05] — Agent B (Frontend) — COMPLETE (Task 2 + 1.7 detail-page prompt)

**Completed (tsc clean across repo, eslint clean on all 4 files):**

- [2.1/2.2/2.3/2.4] Full rewrite of the CA statement detail page into a two-tab layout.
  File: `src/app/(accountant)/clients/[id]/statements/[sid]/page.tsx`
  - Server component (no `use client` on the page). `?tab=parsed|invoices` read from `searchParams`, default `parsed`; tabs are `<Link>`s with border-bottom underline (not shadcn Tabs).
  - Parsed Output: 8-col table (Date `formatDateIN`, Description, Amount `formatINR` red/green, Category badge colour-coded, Invoice-needed Yes(amber)/No(grey), Method chip rule\_\*=blue/llm=violet/llm_fallback=red, Confidence % ≥80 green/50–79 amber/<50 red, Reasoning truncated+click-to-expand). Summary bar: total / rule·llm·fallback / needs-invoice / avg confidence.
  - Invoices Needed: filtered `needsInvoice && matchStatus!=='out_of_scope'`; cols Date/Desc/Amount(red)/Category/Status(unmatched→"Awaiting invoice", flagged→"Needs review")/Reasoning; empty state "No invoices required for this statement."
  - Header status messages: password_required→unlock prompt; processing/phase1_complete/unlocking→"Parsing in progress" + Refresh button; failed→error box (kept); empty→copy. `status` cast to string to handle Task-1 statuses defensively (Agent A's 1.1 enum edit is already in, so this is belt-and-suspenders).
- [1.7 — detail page] Password prompt, fully wired to Agent A's 1.6 route (now confirmed present + matching shape).
  File: `src/app/(accountant)/clients/[id]/statements/[sid]/statement-unlock-prompt.tsx` (client)
  - POST `/api/v1/clients/:id/statements/:sid/unlock` body `{password}`; on 200 `router.refresh()`; maps 404/409/400 to friendly copy. Shows server "incorrect" errorMessage. Clears the password field on submit (never held beyond the request).
- New client sub-components: `refresh-button.tsx` (router.refresh), `reasoning-cell.tsx` (truncate/expand). Same folder.

**Not done (out of Task 2 scope — see 1.7 row):**

- 1.7 password prompt in `statements-panel.tsx` (CA list) and `(owner)/owner/statements` page. Task 2 only covers the CA detail page; these two surfaces remain for a follow-up. The reusable `statement-unlock-prompt.tsx` can be lifted into them (it takes `clientOrgId`, `statementId`, `errorMessage`).

**Verification:** `tsc --noEmit` → 0 errors repo-wide. `eslint` on all 4 files → clean. No new deps, no API routes, no schema/migrations added by me.

**Next agent should:** if full 1.7 coverage is wanted, reuse `statement-unlock-prompt.tsx` in the CA list panel and the owner statements page (mind the owner route uses its own client-org context).

### [2026-06-05] — Agent A (Backend) — COMPLETE (1.1–1.6)

**Completed (all of my scope; tsc clean across repo, Python syntax OK, sandbox verified live):**

- [1.1] Added `password_required` + `unlocking` to `bankStatements.status` enum.
  Files: `src/db/schema/muneem.ts`.
  **No migration file** — the column is bare `text` with no DB CHECK (only `scan_status` has one), so the enum is TS-only and `drizzle-kit generate` emits no DDL. I did NOT run/push any migration.
- [1.2] `extract-pages.py` — optional `[password]` argv; catches `pdfminer.pdfdocument.PDFPasswordIncorrect`; exit 2 `{"encrypted":true}` (no pw), exit 3 `{"encrypted":true,"wrong_password":true}` (wrong pw), exit 0 on success. Password only read from argv[2], never echoed.
  Files: `docker/python-sandbox/extract-pages.py`.
- [1.3] `server.py` — reads optional `password` from body, forwards as argv[2], maps exit 2→422 `{error:"encrypted",requiresPassword:true}` and exit 3→422 `{error:"wrong_password",requiresPassword:true}`. Password never logged.
  Files: `docker/python-sandbox/server.py`.
- [1.4] `sandbox-client.ts` — `extractPdfPages(buffer, password?)`; exports `EncryptedPdfError` + `WrongPdfPasswordError`; parses 422+`requiresPassword` into those typed errors. Neither error carries the password.
  Files: `src/lib/statement-parser/sandbox-client.ts`.
- [1.5] `statement-extract.ts` — threads `event.data.password` → `handlePdf` → `extractPdfPages`; catches the two typed errors and sets `status='password_required'` (wrong-pw sets the friendly message) then `return`s (no throw → no Inngest retry, no `failed`); idempotency guard now also accepts `unlocking`; `onFailure` guard excludes `password_required`/`unlocking`.
  Files: `src/lib/inngest/functions/statement-extract.ts`.
- [1.6] NEW unlock route. Auth `requireFirmOrOwnerForClient`; Zod `{password: 1..128}`; 404 if missing/wrong client, 409 if status≠`password_required`, 400 on bad body; sets `status='unlocking'` (clears errorMessage) then fires `muneem/statement.uploaded` `{statementId, password}`; 200 `{queued:true}`. Password never persisted/logged.
  Files: `src/app/api/v1/clients/[id]/statements/[sid]/unlock/route.ts`.

**Verification:**

- `npx tsc --noEmit` → 0 errors repo-wide.
- `python3 -m py_compile` on both sandbox files → OK.
- Live test against `pdfplumber==0.11.4`: plain→exit 0; encrypted-no-pw→exit 2 `{"encrypted":true}`; encrypted-wrong-pw→exit 3 `{"encrypted":true,"wrong_password":true}`; encrypted-correct-pw→exit 0 with pages. All as specced.

**For Agent B (1.7):** Endpoint is `POST /api/v1/clients/:id/statements/:sid/unlock`. Request body `{ "password": string }` (1–128 chars). Success 200 `{ "queued": true }`. Errors: 400 invalid body, 401 unauth, 403 forbidden, 404 not found / wrong client, 409 not in `password_required`. On success, optimistically show "Processing…"; the row moves to `unlocking` then back to `phase1_complete`/`parsed` (or `password_required` again with errorMessage "The password you entered is incorrect. Please try again." on a wrong password).

**Blocked:** None. **Not committed/pushed** (per instructions).

### [2026-06-05] — Agent A (Backend) — PLAN

**Scope:** Task 1 sub-tasks 1.1–1.6 (NOT 1.7 — that is Agent B's).

**Key verified findings (no longer guesses):**

- The handoff/task hint that the exception is `pdfminer.pdftypes.PDFPasswordIncorrect` is **WRONG**. Verified against pdfplumber==0.11.4 (the Dockerfile pin) → pdfminer.six 20231228: the correct import is `from pdfminer.pdfdocument import PDFPasswordIncorrect`.
- pdfplumber raises the **same** `PDFPasswordIncorrect` for both no-password and wrong-password. The sandbox distinguishes them solely by whether a password CLI arg was supplied (exit 2 = none supplied, exit 3 = supplied-but-wrong). Matches task.md Step 1 exactly.
- `bank_statements.status` is a Drizzle `text` enum column with **NO DB-level CHECK constraint** (only `scan_status` has one). Adding `password_required`/`unlocking` to the TS enum produces **no SQL DDL** — `drizzle-kit generate` will report "No schema changes". So 1.1 is a TS-only edit; I will still run generate to confirm nothing is emitted (and will NOT run/push migrations).
- Inngest client is untyped (no `EventSchemas`), so extending event data with `password?` is purely a payload concern — no schema type to update.

**Plan:**

1. **1.1** `src/db/schema/muneem.ts` — add `'password_required'`, `'unlocking'` to `bankStatements.status` enum array. Run `pnpm drizzle-kit generate` to confirm no DDL needed (no migration file expected).
2. **1.2** `docker/python-sandbox/extract-pages.py` — accept optional `[password]` arg; wrap `pdfplumber.open` in try/except `PDFPasswordIncorrect`; exit 2 `{"encrypted":true}` if no pw, exit 3 `{"encrypted":true,"wrong_password":true}` if pw given.
3. **1.3** `docker/python-sandbox/server.py` — read optional `password` from body, pass as 2nd CLI arg, never log it; map exit 2→422 `{error:"encrypted",requiresPassword:true}`, exit 3→422 `{error:"wrong_password",requiresPassword:true}`.
4. **1.4** `sandbox-client.ts` — `extractPdfPages(buffer, password?)`; export `EncryptedPdfError`/`WrongPdfPasswordError`; parse 422 body to throw the typed errors; never include password in any thrown message.
5. **1.5** `statement-extract.ts` — thread `password` from `event.data` through `handlePdf`→`extractPdfPages`; catch the two typed errors, set status `password_required` (wrong-pw sets the friendly errorMessage), `return` without throw so Inngest does NOT retry and `onFailure` does not mark failed; add `password_required`/`unlocking` to onFailure's notInArray guard.
6. **1.6** NEW `src/app/api/v1/clients/[id]/statements/[sid]/unlock/route.ts` — auth via `requireFirmOrOwnerForClient`; body `{password}` (1–128, non-empty); statement must exist+belong+status==='password_required' (409 else, 404 missing); set status `unlocking`; fire `muneem/statement.uploaded` `{statementId, password}`; 200 `{queued:true}`. Password never persisted, never logged.

Proceeding now (task.md is approved; plan does not deviate).

### [2026-06-05] — Agent B (Frontend) — PLAN

**Scope:** Task 2 (statement detail page rewrite) + Task 1 sub-task 1.7 (password prompt UI).

**Plan (per task.md, already approved):**

1. **2.1 / 2.4 — page.tsx rewrite (server component).**
   - Keep server component; read `searchParams` for `?tab=parsed|invoices` (default `parsed`).
   - Same auth + tenant query pattern as current file (session role check → clientOrgs scoped by `firmId` → bankStatements scoped by `clientOrgId` → bankTransactions by `statementId`). No new API routes / columns.
   - Statement header: filename, period (formatDateIN), currency, status badge. Status-conditional notices:
     - `password_required` → render `<StatementUnlockPrompt>` client sub-component (1.7).
     - `processing` / `phase1_complete` / `unlocking` → "Parsing in progress" notice + Refresh button (small client sub-component `RefreshButton`, or a plain link to same URL).
     - `failed` → existing red error box.
     - `empty` → "No transactions were extracted from this statement."
     - `parsed` → just tabs.
   - Note: schema status enum does not yet include `password_required`/`unlocking` (Agent A task 1.1). UI handles them defensively via string compare; no schema edits from me.

2. **2.2 — Parsed Output tab.** 8-column table (Date, Description, Amount, Category badge, Invoice needed badge, Method chip, Confidence %, Reasoning truncated+expand). Summary bar: total tx, rule/llm/fallback counts, needs_invoice count, weighted-avg confidence. Reasoning expand = tiny client sub-component (`ReasoningCell`) using `<details>` or toggle.

3. **2.3 — Invoices Needed tab.** Filter `needsInvoice === true && matchStatus !== 'out_of_scope'`. Columns: Date, Description, Amount (red), Category badge, Status (unmatched→"Awaiting invoice" amber, flagged→"Needs review" red), Reasoning. Empty state copy.

4. **1.7 — `StatementUnlockPrompt` client component.** Password input + "Unlock & Process" button, inline error if `errorMessage` contains "incorrect". POST to `/api/v1/clients/:id/statements/:sid/unlock` body `{ password }`, expect 200 `{ queued: true }`, map 404/409/400 errors. Clears field on submit. If Agent A's route not confirmed, leave `// TODO(task1)` at the fetch and stub the shape per task.md Step 4.

**Helpers:** `formatINR`, `formatDateIN` from `@/lib/format/inr`. CA-facing page so accounting terms allowed. New small client sub-components colocated under the `[sid]/` folder.

Proceeding now.

---

## How to Write a Log Entry

```
### [YYYY-MM-DD HH:MM UTC] — <Agent name or session ID>

**Completed:**
- [1.2] `extract-pages.py` — added encryption detection, exit codes 2 and 3, optional password arg.
  Files changed: `docker/python-sandbox/extract-pages.py`

**In progress / left incomplete:**
- [1.3] Started `server.py` changes; `/extract-pages` route updated to accept `password` field
  but 422 response shape not yet done.
  Files partially changed: `docker/python-sandbox/server.py`

**Blocked:** See report.md — question about pdfminer exception class name.

**Next agent should:** Finish 1.3, then move to 1.4.
```
