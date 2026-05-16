# Muneem Ji on Indie Kit — Developer Guide for Claude Code

## Module-Based Development — Read First Every Session

This project is organised by **module**, not by phase. A module is a self-contained functional unit with defined inputs, outputs, owned schema tables, API contracts, and queue job ownership. Module docs live in `docs/modules/`.

**Mandatory at session start, before touching any code:**

1. List `docs/modules/` and read `docs/modules/INDEX.md` to see what exists and at what status.
2. Identify which module(s) the requested task touches. Read the relevant module doc(s) in full.
3. Check the module's `status:` field. **You may only write code for a module whose status is `SPECCED`, `IMPLEMENTED`, or `STABLE`.** Status `DRAFT`, `PLANNED`, or `DEPRECATED` means stop and tell Bani the doc must be specced first.
4. If a task requires a capability with no module doc, that capability is `PLANNED` — stop and ask Bani to spec it.

**Always propose a plan and wait for explicit approval before writing any code.** Approval is per-task; prior approval does not extend.

After the module check, invoke the relevant skill for the area you're touching:

- `src/db/schema/` → `db-handler` skill (Indie Kit) or `schema` skill (Muneem Ji domain).
- `src/app/api/**` → `api` skill.
- `src/lib/inngest/functions/**` → `inngest-handler` skill (was: `worker` skill).
- `src/lib/accounting/**` → `engine` skill.
- `src/app/(accountant)/**`, `src/app/(owner)/**`, `src/components/**` → `frontend` skill.
- `src/emails/**` → `email-handler` skill.

### Active spec documents

- `docs/master-prd.md` — Master PRD (v6).
- `docs/master-tech-spec.md` — Master Technical Specification (v2).
- `docs/modules/*.md` — module specs (the operating contracts).
- `docs/frontend-conventions.md` — design system, components, form validation.

Older docs live in `docs/archive/`. If a rule here conflicts with a module doc, the module doc wins for its scope, then the master docs, then this file.

---

## What This Product Does

Muneem Ji is a CA practice operating system. It solves two problems for CAs simultaneously:

1. **Digital presence** — every CA gets an AI-generated professional website under their own brand.
2. **Document collection** — CAs collect bank statements and invoices from clients; the system matches them and produces a day book.

Muneem Ji is not bookkeeping software. The day book is a byproduct of a solved coordination problem.

## Product Layers

- **muneemji.com** — main domain. CA acquisition, directory, subscription management (Indie Kit infrastructure handles billing/auth here).
- **caname.muneemji.com** — CA subdomain. Public CA website + gated client portal (CA login / BO login).

## User Types

- **CA users** — the paying entity. `ca_admin` or `ca_staff` role in `app_user.role`, linked to an `accountant_firms` row via `app_user.firmId`. Session carries `role` + `firmId`.
- **Client users** (linked BO) — invited by a CA. Credentials in `client_users` table. Authenticated via a separate Credentials provider in NextAuth. Session carries `role: 'business_owner'`.
- **Independent BO users** — no CA link, pay ₹199/month. Session via standard Indie Kit auth.
- **Guest** — unauthenticated upload via token link.

## Repository Structure (Indie Kit paths)

```
/
├── src/
│   ├── app/
│   │   ├── (accountant)/      ← CA-facing pages
│   │   ├── (owner)/           ← Linked BO pages
│   │   ├── (auth)/            ← Login, register (gated by ALPHA_MODE)
│   │   ├── (in-app)/          ← Indie Kit billing/profile/credits (keep untouched)
│   │   ├── (website-layout)/  ← Public marketing pages
│   │   └── api/v1/            ← Muneem Ji API routes
│   ├── db/
│   │   └── schema/
│   │       ├── user.ts        ← Extended with role + firmId
│   │       ├── muneem.ts      ← All Muneem Ji domain tables
│   │       └── ...            ← Indie Kit tables (keep untouched)
│   ├── lib/
│   │   ├── accounting/        ← Double Entry Engine (sole journal_entries writer)
│   │   ├── statement-parser/  ← D02: pdfplumber + GPT-4o mini
│   │   ├── statement-interpretation/ ← D03: rules + LLM classification
│   │   ├── ai/                ← Anthropic + OpenAI clients
│   │   ├── auth/              ← Tenant isolation helpers
│   │   ├── storage/           ← S3 upload helpers
│   │   ├── validation/        ← GSTIN + Zod schemas
│   │   ├── format/            ← INR formatting
│   │   └── inngest/functions/ ← Inngest jobs (replaces BullMQ workers)
│   └── emails/                ← React Email templates (invite, reminder, etc.)
├── docker/
│   └── python-sandbox/        ← Sandboxed pdfplumber execution
└── docs/
    ├── master-prd.md
    ├── master-tech-spec.md
    ├── frontend-conventions.md
    └── modules/               ← One .md per module — the operating contracts
```

Route groups are not interchangeable. CA pages → `(accountant)/`, BO pages → `(owner)/`, auth flows → `(auth)/`. Indie Kit's `(in-app)/` is for billing/credits — do not add Muneem Ji domain pages there.

---

## Non-Negotiable Financial Rules ⚠️

**1. MONEY IS BIGINT.**
Store all monetary values as `BIGINT` in smallest currency unit (paise for INR, cents for CAD/EUR).
Never `DECIMAL`, `FLOAT`, or JS `number` for money. Ever.

**2. DOUBLE ENTRY ENGINE IS THE SOLE JOURNAL WRITER.**
Only `src/lib/accounting/double-entry-engine.ts` writes to `journal_entries`.
API routes, Inngest functions, and components do not write journal entries. No exceptions.

**3. EVERY ENTRY MUST BALANCE.**
The engine throws `UNBALANCED_ENTRY` if debits ≠ credits. Never catch and suppress this error.

**4. VIRUS SCANNING IS DEFERRED.**
Files are processed after lightweight validation only (MIME / magic bytes + 25 MB size cap in D01). The `scan_status` column is set to `'clean'` on upload confirmation and no downstream code gates on it. Real scanning (target: AWS GuardDuty Malware Protection for S3) is planned but not implemented — see `docs/modules/F03-file-upload-virus-scan.md`.

**5. TAX MUST BE SPLIT.**
For India GST: CGST, SGST, and IGST must each be recorded as separate journal entry lines and separate DB columns.

**6. EXPORT IS WARN-ONLY.**
`had_unresolved_items` never blocks export generation.

## Security Rules 🔒

**7. VALIDATE SESSION FIRST.**
Every protected API route: validate session → resolve `ca_firm_id` / `client_org_id` → verify ownership → proceed.

**8. TENANT ISOLATION.**
Every DB query on client data must include a `firmId` or `clientOrgId` scope. Use helpers in `src/lib/auth/tenant.ts`.

**9. PRE-SIGNED URLS FOR UPLOADS.**
Files upload directly from browser to S3 via pre-signed URL (15-min expiry). Files never pass through Next.js server.

**10. STORAGE CAP IS SERVER-ENFORCED.**
Check cap before generating pre-signed URL. Return 402 if exceeded.

---

## Job Queue Architecture (Inngest — replaces BullMQ)

Inngest functions own async processing. API routes only send Inngest events — they never do the work inline.

| Event                        | Inngest Function file                      | Was (BullMQ)                  | Status    |
| ---------------------------- | ------------------------------------------ | ----------------------------- | --------- |
| `muneem/statement.uploaded`  | `inngest/functions/statement-extract.ts`   | `workers/statement.worker.ts` | ✓ Migrate |
| `muneem/statement.extracted` | `inngest/functions/statement-interpret.ts` | `workers/interpret.worker.ts` | ✓ Migrate |
| `muneem/document.uploaded`   | `inngest/functions/ocr.ts`                 | `workers/ocr.worker.ts`       | PLANNED   |
| `muneem/ocr.complete`        | `inngest/functions/match.ts`               | `workers/match.worker.ts`     | PLANNED   |
| `muneem/export.requested`    | `inngest/functions/export.ts`              | `workers/export.worker.ts`    | PLANNED   |

Rules for Inngest functions (same as prior worker rules):

- Read/write DB via Drizzle. Do not return HTTP responses.
- Call the Double Entry Engine when a confirmed match requires journal entries.
- Never import from `src/app/api/`. Never call API routes.
- API routes send Inngest events only — never do worker-level work inline.

## Agent Skill Boundaries

| Skill                   | Owns                                                                              | Must not touch                                     |
| ----------------------- | --------------------------------------------------------------------------------- | -------------------------------------------------- |
| `db-handler` / `schema` | `src/db/schema/`, `drizzle/`                                                      | Business logic, API routes, Inngest functions      |
| `api`                   | `src/app/api/**`                                                                  | `journal_entries` directly, Inngest function logic |
| `inngest-handler`       | `src/lib/inngest/functions/**`                                                    | HTTP responses, `src/app/api/` imports             |
| `engine`                | `src/lib/accounting/**`                                                           | HTTP, Inngest, DB outside its own functions        |
| `frontend`              | `src/app/(accountant)/`, `src/app/(owner)/`, `src/app/(auth)/`, `src/components/` | Direct DB access, event sending                    |
| `email-handler`         | `src/emails/**`                                                                   | Financial logic, journal writes                    |

---

## V1 Scope Guards

Do **NOT** implement in V1:

- GST filing or return generation (GSTR-1, 3B, 2B)
- Ireland VAT or Canada GST/HST logic — scaffold fields only
- Multi-currency transactions (single-currency per client org in V1)
- Tally / Xero / QuickBooks integration
- Mobile app
- Business owner financial dashboard, P&L, cash flow views
- Any accounting terminology in BO-facing UI (no "journal", "debit", "credit", "ledger")

---

## Environment Variables

All variables must be in `.env`. Never hardcode values. Use exactly these names.

```bash
# Muneem Ji feature flags
ALPHA_MODE=true                        # Disables public signup routes in Track 1

# AI (Muneem Ji domain)
ANTHROPIC_API_KEY=                     # Sonnet (websites), Vision (OCR), Opus (parser script gen)
OPENAI_API_KEY=                        # GPT-4o mini (statement normalisation + CSV parsing)

# Python sandbox (pdfplumber)
PYTHON_SANDBOX_URL=http://localhost:8000
```

---

## Indian Localisation Standards

- Currency: INR in Indian number format (₹1,00,000 not ₹100,000)
- Tax labels: CGST, SGST, IGST — never "Tax 1 / Tax 2"
- GSTIN: 15-char format `[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}`
- Date format: DD/MM/YYYY in all displayed dates and exports
- Financial year: April–March

```ts
export const formatINR = (paise: bigint) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(
    Number(paise) / 100,
  );
```

---

## Common Mistakes to Avoid

| Mistake                                                     | Correct approach                                                          |
| ----------------------------------------------------------- | ------------------------------------------------------------------------- |
| Using `number` type for monetary amounts                    | Use `bigint` (paise for INR)                                              |
| Writing journal entries in an API route or Inngest function | Call Double Entry Engine from Inngest only                                |
| Querying client data without `firmId` scope                 | Always scope to `firmId` or `clientOrgId`                                 |
| Collapsing CGST + SGST into one line                        | They must be separate journal entry lines                                 |
| Using `new Date()` for financial dates                      | Use the explicit DATE from the transaction                                |
| Sending email inline from an API route                      | Send Inngest event; function sends the email                              |
| Blocking export on unresolved items                         | `had_unresolved_items` is warn-only                                       |
| Running LLM-generated Python in-process                     | All generated scripts execute in `docker/python-sandbox` only             |
| Looking up parser scripts by `bank_identifier` alone        | `bank_parser_scripts` is scoped by `firmId` always                        |
| Adding Muneem Ji pages to `(in-app)/` route group           | Use `(accountant)/` or `(owner)/` — `(in-app)/` is Indie Kit billing only |
