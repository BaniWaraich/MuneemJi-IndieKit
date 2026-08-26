---
id: O05
name: payee-memory
status: SPECCED
owners: ["db-handler", "api"]
last_updated: 2026-08-26
---

# O05 — Payee Memory

> O05 is the durable, per-org memory of who a payee is and whether invoices should be collected for them. Independent BOs never fill the O03 CA knowledge form; they teach the system by answering in-app quick questions and by marking checklist items “Not needed”. Those answers land here as `payee_memory` rows keyed by a normalised `payee_key`. O04 (invoice checklist) and F10 (Gmail pull) read this table to skip repeat questions, drop false positives, and gate Gmail search. D03 may optionally apply the same memory in its rule pre-filter so `needs_invoice` is set correctly at the source.

---

## Status

`SPECCED` (2026-08-26) — approved with the BO invoice-checklist plan. Implementation may begin.

---

## 1. Purpose

The same person or merchant reappears on every statement. Without memory, the BO answers “Who is RAJESH KUMAR?” every month and Spotify keeps showing up after they said it is not needed. O05 stores that learning once per `(client_org_id, payee_key)` so later statements ask fewer questions and Gmail is not searched for payees marked never. It does not classify bank lines, render UI, or fetch mail.

---

## 2. Inputs and Outputs

**Inputs**

- A normalised `payee_key` produced by `fingerprintPayee(description)` (this module owns the fingerprint function).
- Writes from O04 when a clarification is answered (except Skip) or a checklist item is marked Not needed.
- Optional future writes from vendor-confirm actions (`source = user_confirmed` / `agent_inferred`).

**Outputs**

- One `payee_memory` row per org + fingerprint, upserted on write.
- Read helpers used by O04’s checklist builder and F10’s Gmail gate (and optionally D03).

This module does NOT produce: checklist items, clarifications, `documents` rows, journal entries, Gmail API calls, or O03 `client_knowledge` updates.

---

## 3. Trigger Mechanism

- Direct function calls from O04 (`upsertPayeeMemory` on answer / Not needed).
- Direct reads from O04 builder, F10 job, optional D03 pre-filter.
- No HTTP routes. No Inngest functions.

---

## 4. Schema Tables Owned

| Table                     | Ownership     | Notes       |
| ------------------------- | ------------- | ----------- |
| `payee_memory`            | sole writer   | All columns |
| `bank_transactions`       | never touches | D03         |
| `client_knowledge`        | never touches | O03         |
| `invoice_checklist_items` | reader only   | O04         |

### `payee_memory`

| Column                      | Type                    | Notes                                                                                 |
| --------------------------- | ----------------------- | ------------------------------------------------------------------------------------- |
| `id`                        | uuid PK                 |                                                                                       |
| `client_org_id`             | uuid FK → `client_orgs` | tenant scope                                                                          |
| `payee_key`                 | text                    | normalised fingerprint; unique with org                                               |
| `display_name`              | text                    | friendly label (“Rajesh Kumar”, “Spotify”)                                            |
| `relationship`              | text                    | `vendor` \| `customer` \| `family` \| `employee` \| `self` \| `landlord` \| `unknown` |
| `invoice_policy`            | text                    | `always` \| `never` \| `ask`                                                          |
| `source`                    | text                    | `clarification` \| `list_edit` \| `agent_inferred`                                    |
| `confirmed_at`              | timestamptz             | set on every user-originated upsert                                                   |
| `created_at` / `updated_at` | timestamptz             |                                                                                       |

Unique: `(client_org_id, payee_key)`. Index: `client_org_id`.

---

## 5. API Contracts

None. O04 owns the HTTP surface that causes writes.

Library (normative):

```ts
fingerprintPayee(description: string): string
upsertPayeeMemory(input: {
  clientOrgId: string
  payeeKey: string
  displayName: string
  relationship: PayeeRelationship
  invoicePolicy: InvoicePolicy
  source: MemorySource
}): Promise<void>
getPayeeMemory(clientOrgId: string, payeeKey: string): Promise<PayeeMemory | null>
listPayeeMemory(clientOrgId: string): Promise<PayeeMemory[]>
```

---

## 6. Queue Jobs

None.

---

## 7. Business Logic Rules

- **Fingerprint stability.** Same counterparty description (noise aside) → same `payee_key`. Algorithm: uppercase; strip UPI / IMPS / NEFT / RTGS / NACH / ACH prefixes; drop trailing long digit runs and bank-ref tokens; drop payment-app noise (`PAYTM`, `PHONEPE`, `GPAY`, `BHIM`) when a remaining name exists; take the local part before `@` for UPI handles when that is all that remains; collapse whitespace. Empty after strip → hash of the original description so clustering still groups identical raw strings.
- **Tenant isolation.** Every read/write includes `client_org_id`. Cross-org leakage would leak family names and invoice policy.
- **Skip does not write.** Clarification answer `skip` must not insert or update `payee_memory`. The next statement may ask again.
- **Not needed → never.** Checklist “Not needed” upserts `invoice_policy = never`, `source = list_edit`. F10 must not search that payee.
- **Answer map (written by O04, enforced here as the stored shape):**
  - landlord → `relationship=landlord`, `invoice_policy=always`
  - supplier → `relationship=vendor`, `invoice_policy=always`
  - family → `relationship=family`, `invoice_policy=never`
  - self → `relationship=self`, `invoice_policy=never`
- **Read semantics for callers:**
  - `invoice_policy=never` or relationship in `{family, self}` → no clarification, no Gmail, omit or `not_needed` on checklist.
  - `invoice_policy=always` → show on checklist as `to_collect`, Gmail eligible (F10 still applies its own gates).
  - missing row → treat as unknown; O04 may ask or show immediately per its confidence rules.
- **Upsert, do not duplicate.** Second write for the same key overwrites relationship/policy/display_name and refreshes `confirmed_at`.
- **No money columns.** Amounts are not stored here.

---

## 8. LLM Usage

None.

---

## 9. Economics

| Component    | Per unit   | Frequency                  | Notes        |
| ------------ | ---------- | -------------------------- | ------------ |
| Postgres row | negligible | per distinct payee per org | Grows slowly |

Watch metric: clarification rate on 2nd+ statements for the same org (should fall as memory fills).

---

## 10. Failure Modes

| Failure               | Trigger                                  | Impact                          | Severity | Recovery                                         |
| --------------------- | ---------------------------------------- | ------------------------------- | -------- | ------------------------------------------------ |
| Fingerprint collision | Two distinct payees normalise to one key | Wrong memory applied            | med      | User Not needed / re-answer; tighten fingerprint |
| Fingerprint split     | Same payee, different bank strings       | Repeat questions                | low      | User answers again; alias list later             |
| Missing org scope     | Caller omits `clientOrgId`               | Must throw, never global lookup | high     | Code review / tests                              |

---

## 11. Dependencies

- **Depends on (modules):** F02 tenant isolation (`client_org_id`).
- **Depended on by (modules):** O04 (required), F10 (required for `never` gate), D03 (optional pre-filter read).
- **External services:** PostgreSQL.

---

## 12. Open Questions

None. Multi-Gmail and Outlook do not affect this table.

---

## 13. Change Log

| Date       | Change                                               | By           |
| ---------- | ---------------------------------------------------- | ------------ |
| 2026-08-26 | Initial SPECCED — payee fingerprint + `payee_memory` | Bani / agent |

---
