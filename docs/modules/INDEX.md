# Module Index

The system is organised as a set of self-contained modules. Every module has a doc in this directory. **No code may be written for a module whose status is not `SPECCED`, `IMPLEMENTED`, or `STABLE`.**

Status legend: `DRAFT` (being written) · `SPECCED` (approved, ready to build) · `IMPLEMENTED` (code shipped) · `STABLE` (soaked) · `PLANNED` (known module, not yet specced — implementation forbidden) · `DEPRECATED`.

When this index lists a module without a corresponding `.md` file in `docs/modules/`, that module is `PLANNED` by definition.

---

## Foundation (cross-cutting; every module depends on these)

| ID | Module | Status | One-liner |
|---|---|---|---|
| F01 | auth-sessions | PLANNED | NextAuth.js v5 with three session types (CA, linked-BO, independent-BO) + guest tokens; gates every protected route. |
| F02 | tenant-isolation | PLANNED | `ca_firm_id` / `client_org_id` scoping helpers + ownership guards used by every API query. |
| F03 | file-upload-virus-scan | PLANNED | Pre-signed S3 URL issuance, ClamAV scan gate, `scan_status` lifecycle, BO storage-cap pre-check; everything downstream waits on `clean`. Owns sanctioned-country block and 7-year retention policy. |
| F05 | email-delivery | PLANNED | SES sender + transactional templates (invites, reminders, enquiries); `SEND_EMAILS=false` logs to console. |
| F06 | notifications-inbox | PLANNED | In-app notification fan-out + unread state for CAs and BOs. |
| F07 | audit-logging | PLANNED | Append-only audit trail for sensitive writes (verification, invites, journal entries, exports). Owns GDPR data-subject-access scaffolding. |
| F08 | observability-error-handling | PLANNED | Sentry/equivalent integration, `statement_parse_log` analytics surface, alerting policy. Track 2 prerequisite — placeholder so it isn't forgotten. |

## CA acquisition & practice surface

| ID | Module | Status | One-liner |
|---|---|---|---|
| C01 | ca-signup-onboarding | PLANNED | CA registration questionnaire (jurisdiction, services, branding inputs); produces the seed used by C03. |
| C02 | ca-verification | PLANNED | Manual review against ICAI / CPA-provincial / Irish-body directories; gates website live + directory listing. |
| C03 | ca-website-generation | PLANNED | Claude Sonnet pipeline: questionnaire → home/about/services/meta + schema markup; one-time on signup, on-demand refresh. |
| C04 | ca-website-management | PLANNED | CA-side editor for sections, services, logo, colour, contact, blog toggle; manual-edit preservation flag. |
| C05 | ca-website-serving | PLANNED | Subdomain routing (`{slug}.muneemji.com`), public/gated split, CloudFront-backed asset delivery. |
| C06 | custom-domain | PLANNED | CA-owned domain → Muneem Ji infra; ACM SSL provisioning + DNS validation. |
| C07 | directory | PLANNED | `muneemji.com/find-a-ca` public listing, filters (country/state/city/service/language), SEO. |
| C08 | public-enquiry-lead-inbox | PLANNED | "Talk to CA" CTA → `wa.me` redirect + lead recording + CA in-app/email notification + one-click convert-to-client. |
| C09 | subscription-tiers | PLANNED | Plan limits (client cap, branding, white-label, custom domain), enforced at API layer; billing offline in V1. Owns sanctioned-country registration block enforcement. |
| C11 | branding-white-label | PLANNED | Per-tier toggle for "Powered by Muneem Ji" footer vs full white-label on public site. |
| C12 | ca-lifecycle | PLANNED | Subscription suspension / grace period / data retention / full export on exit. Low priority — spec when work approaches. |

## Client onboarding

| ID | Module | Status | One-liner |
|---|---|---|---|
| O01 | client-invite-linked-bo | PLANNED | CA adds client → invite token email → BO accepts → linked-BO session. Owns `acquisition_source` column (`CA-brought` vs `platform-discovered`). |
| O02 | independent-bo-onboarding | PLANNED | ₹199/month self-signup path; gated by `ALPHA_MODE=true` in Track 1 (seeded by team only). |
| O03 | client-knowledge-capture | PLANNED | Owns `client_profiles` (Tier 1 required) + `client_knowledge` (Tier 2 enrichment); the per-client business context that feeds D03. |

## Document pipeline (the engine)

| ID | Module | Status | One-liner |
|---|---|---|---|
| D01 | bank-statement-upload | PLANNED | BO uploads statement → metadata row → enqueue → status surface; the user-facing on-ramp for D02. |
| [D02](./D02-statement-format-extraction.md) | statement-format-extraction | IMPLEMENTED | Any statement (PDF or CSV) → normalised Markdown KV. PDF: bank-id + per-firm pdfplumber script cache + Claude Opus on miss + sandbox exec + balance validation. CSV: GPT-4o mini straight-through. **No business logic.** |
| [D03](./D03-statement-interpretation.md) | statement-interpretation | IMPLEMENTED | Markdown KV + client knowledge (O03) → structured `bank_transactions` rows with `needs_invoice` / category / reasoning. Rule pre-filter (known vendors / customers / loans / inter-account / owner drawings) handles deterministic cases; GPT-4o mini handles residue with client context. **All business logic lives here.** |
| D04 | invoice-submission | PLANNED | BO uploads invoice (free or against a flagged transaction); pre-sign → scan → store. |
| D05 | invoice-ocr | PLANNED | Claude Vision: any invoice (text PDF / scanned / image) → structured fields (vendor, GSTIN, line items, CGST/SGST/IGST split, total). |
| D06 | transaction-invoice-matching | PLANNED | Heuristic + LLM-assisted linking of invoices to flagged transactions; `match_status` lifecycle. |
| D07 | double-entry-engine | PLANNED | Sole writer of `journal_entries`; throws `UNBALANCED_ENTRY`; tax must be split; called only from workers. |
| D08 | chart-of-accounts | PLANNED | Per-org account defaults + CA customisation; jurisdictional templates (India active; Ireland/Canada scaffold-only). |
| D09 | transaction-corrections-feedback | PLANNED | CA overrides → `transaction_category_corrections` → future promotion to `client_knowledge.known_vendors` / `active_loans`. The engine's learning loop. |

## Outputs & ongoing operations

| ID | Module | Status | One-liner |
|---|---|---|---|
| X01 | day-book-export | PLANNED | CA-only export with `had_unresolved_items` warn-only flag; never blocks generation. |
| X02 | bo-document-export | PLANNED | BO can download own uploads anytime, including during a CA's grace period. |
| X03 | ca-data-export | PLANNED | Full firm data export on request or suspension. |
| X04 | monthly-summary-bo | PLANNED | Plain-English BO-facing view of the month's activity (no accounting jargon). Track 2+. |
| X05 | submission-status-bo | PLANNED | "What you've sent / what's still needed" dashboard for BOs. |
| X06 | reminders | PLANNED | Cron 09:00 IST → reminder emails for missing invoices/statements; respects do-not-disturb windows. |

---

## Decisions baked into this map

- **F04 (storage-cap-enforcement)** folded into **F03**. The 500 MB / 50-doc cap is a pre-condition check inside the upload-and-scan flow, not a standalone system.
- **C10 (ca-firm-teams)** dropped. Multi-member firms are out of scope for Track 1 and early Track 2.
- **acquisition-source-tracking** absorbed into **O01** as a column on `clients`.
- **legal-compliance** is not a module. Sanctioned-country block lives in **C09** (registration), 7-year retention in **F03** (storage), GDPR audit trail in **F07**.
- **Frontend route groups** (`(accountant)/`, `(owner)/`, `(auth)/`, `(website)/`) are presentation layers consuming module APIs — they are not modules themselves.

## Reading order for new sessions

1. This file — to see what exists and at what status.
2. The module doc(s) for the module(s) you are touching.
3. `docs/master-prd.md` and `docs/master-tech-spec.md` only when a module doc cross-references them.
