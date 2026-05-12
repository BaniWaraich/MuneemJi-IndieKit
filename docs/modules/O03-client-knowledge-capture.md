---
id: O03
name: client-knowledge-capture
status: SPECCED
owners: ["api", "frontend", "db-handler"]
last_updated: 2026-05-12
---

# O03 — Client Knowledge Capture

> O03 lets a CA record structured context about a client's business: legal structure, GST registration, known vendors/customers, active loans, and transaction patterns. This context is the primary input to D03 (statement-interpretation) — without it, D03 hard-fails. O03 owns the `client_profiles` (required) and `client_knowledge` (optional enrichment) tables. The CA fills the form; BOs never see it.

---

## Status

`SPECCED`

---

## 1. Purpose

D03 needs to understand a client's business to classify transactions correctly and identify which ones require an invoice. O03 captures that knowledge in two tiers: a required profile (business type, GST status, bank accounts) and optional enrichment (known vendors, customers, active loans, drawings patterns). The form is surfaced immediately after a CA creates a new client and is accessible any time via the client detail page.

---

## 2. Inputs and Outputs

**Inputs**

- CA session with `firmId`
- `clientOrgId` (URL path) — must belong to the CA's firm
- Profile fields: legal structure, business type, industry, description, GST registration type, primary transaction mode, invoice software, inter-company flag, bank accounts array (min 1)
- Knowledge fields (all optional): known vendors, known customers, active loans, owner drawings pattern, cash deposit pattern, seasonality

**Outputs**

- `client_profiles` row (upserted) — consumed by D03 as required context
- `client_knowledge` row (upserted, optional) — consumed by D03 as enrichment context

This module does NOT classify transactions, write journal entries, or send emails.

---

## 3. Trigger Mechanism

- `PUT /api/v1/clients/:id/profile` — CA saves Step 1 of the onboarding form
- `PUT /api/v1/clients/:id/knowledge` — CA saves Step 2 (optional)
- Both routes are also reachable from the client detail page for updates

---

## 4. Schema Tables Owned

| Table              | Ownership   | Notes                                            |
| ------------------ | ----------- | ------------------------------------------------ |
| `client_profiles`  | sole writer | O03 owns all columns                             |
| `client_knowledge` | sole writer | O03 owns all columns                             |
| `client_orgs`      | reader only | owned by O01/O02 — used for firm ownership check |

---

## 5. API Contracts

### `PUT /api/v1/clients/:id/profile`

- **Auth:** CA session (`ca_admin` or `ca_staff`); firm must own the client org
- **Request body:**
  ```ts
  {
    legalStructure: "sole_proprietorship" |
      "partnership" |
      "llp" |
      "private_limited" |
      "public_limited" |
      "trust" |
      "other";
    businessType: "manufacturer" | "trader" | "service_provider" | "mixed";
    industry: string; // 1–100 chars
    description: string; // 1–500 chars
    gstRegistrationType: "regular" | "composition" | "exempt" | "unregistered";
    primaryTransactionMode: "mostly_digital" | "mixed" | "cash_heavy";
    invoiceSoftware: "tally" |
      "busy" |
      "zoho_books" |
      "quickbooks" |
      "manual" |
      "other";
    hasInterCompanyTransactions: boolean;
    bankAccounts: Array<{
      account_label: string;
      bank_name: string;
      account_number_last4: string; // exactly 4 digits
      is_primary_operating: boolean;
      notes?: string;
    }>; // min 1 item; exactly one must have is_primary_operating=true
  }
  ```
- **Response 200:** `{ ok: true }`
- **Errors:** `400` validation, `401` unauthenticated, `403` not CA's client

### `PUT /api/v1/clients/:id/knowledge`

- **Auth:** CA session; firm ownership check
- **Request body:**
  ```ts
  {
    knownVendors: Array<{ name, description_patterns, typical_amount_min_minor, typical_amount_max_minor, category, needs_invoice, notes? }>;
    knownCustomers: Array<{ name, description_patterns, typical_amount_min_minor, typical_amount_max_minor, notes? }>;
    activeLoans: Array<{ lender, description_pattern, approximate_amount_minor, debit_day_of_month, loan_type, notes? }>;
    seasonality?: { peak_months, lean_months, notes? };
    ownerDrawingsPattern?: { method, approximate_monthly_minor, typical_description_pattern?, notes? };
    cashDepositPattern?: { frequency, typical_amount_min_minor, typical_amount_max_minor, notes? };
  }
  ```
- **Response 200:** `{ ok: true }`

---

## 6. Queue Jobs

None. O03 is synchronous write — no async processing.

---

## 7. Business Logic Rules

- `clientProfiles` must have at least one `bankAccounts` entry with `is_primary_operating = true`.
- D03 hard-fails if no `client_profiles` row exists; the CA must complete Step 1 before uploading any statements.
- `clientKnowledge` is optional. D03 uses `(none)` placeholders when absent — results are lower quality but the pipeline does not fail.
- Both APIs use upsert (insert-or-update on `clientOrgId`) — re-submitting the form is always safe.
- Amounts in `clientKnowledge` (vendor amounts, loan amounts, drawings) are stored in paise (smallest INR unit). The UI accepts INR and converts × 100 before calling the API.

---

## 8. LLM Usage

None. O03 is pure data capture.

---

## 9. Economics

No LLM calls. Negligible DB write cost.

---

## 10. Failure Modes

| Failure                     | Trigger                                       | Impact                                                   | Severity | Recovery                                                               |
| --------------------------- | --------------------------------------------- | -------------------------------------------------------- | -------- | ---------------------------------------------------------------------- |
| Profile missing at D03 time | CA uploads statement before completing Step 1 | D03 Inngest function throws; statement stuck in `failed` | high     | CA completes profile; statement must be re-uploaded or Inngest retried |
| Validation error on profile | Missing required field                        | 400 returned; form shows field errors                    | low      | CA fixes form                                                          |

---

## 11. Dependencies

- **Depends on (modules):** F02 (tenant isolation), O01 (client org must exist before profile can be created)
- **Depended on by (modules):** D03 (reads both tables via `build-context.ts`)
- **External services:** None

---

## 12. Open Questions

None for V1.

---

## 13. Change Log

| Date       | Change       | By          |
| ---------- | ------------ | ----------- |
| 2026-05-12 | Initial spec | Claude Code |
