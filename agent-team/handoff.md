# Agent Team — Session Handoff

> This file is written by an agent that is approaching its context limit (~60%).
> The next agent must read this file first, then `progress.md`, then `task.md`.
> Entries are prepended (newest at top). Keep old entries below — they are the history.

---

## Active Handoff

*(No handoff yet — first session has not started)*

---

## Handoff Entry Format

When writing a handoff, prepend a new entry in this exact structure:

```markdown
### Handoff — [YYYY-MM-DD HH:MM UTC] — Session <ID>

#### Why stopping
Context budget reached ~60%. Stopping to preserve output quality.

#### What is done (committed / saved)
- [1.2] `extract-pages.py` — encryption detection complete. File saved.
- [1.3] `server.py` — password accepted in body, 422 responses done. File saved.

#### What is in progress (files partially changed)
- [1.4] `sandbox-client.ts` — `password?` param added to `extractPdfPages` signature,
  but the 422 response handling (throw `EncryptedPdfError`) is NOT yet written.
  **The file is in a broken state — do not run tests until this is finished.**
  Last edited line: ~line 47.

#### What is NOT started yet
- [1.5] `statement-extract.ts` — catching typed errors, transitioning status
- [1.6] API unlock route
- [1.7] Frontend password prompt
- All of Task 2

#### Open blockages
- BLK-1 (see report.md) — question about pdfminer exception class. Waiting on Bani.

#### Critical context for next agent
- pdfplumber raises `pdfminer.high_level.PDFPasswordIncorrect` on Python 3.11; import path is
  `from pdfminer.pdftypes import PDFPasswordIncorrect`. Verified in the Dockerfile base image.
- The `bank_statements.status` Drizzle enum is defined in `src/db/schema/muneem.ts` around line 80.
  The migration file must be generated with `pnpm drizzle-kit generate`.
- Do NOT use `process.env.DATABASE_URL` directly — use the Drizzle client from `@/db`.

#### Exact next action for next agent
Start at `sandbox-client.ts` line 47: add the `EncryptedPdfError` and `WrongPdfPasswordError`
throw blocks inside the `extractPdfPages` function after the fetch response check.
Then proceed to sub-task 1.5.
```

---

## Previous Handoffs

*(None yet)*
