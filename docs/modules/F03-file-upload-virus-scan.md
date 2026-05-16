---
id: F03
name: file-upload-virus-scan
status: DRAFT
owners: ["api", "db-handler", "inngest-handler"]
last_updated: 2026-05-16
---

# F03 — File Upload & Virus Scan

> **Status: DRAFT — deferred.** Virus scanning is not part of V1.
>
> **Decision (2026-05-16):** the prior ClamAV-on-Railway implementation was retired. A persistent clamd container with a freshclam-maintained signature DB is too heavy for the free tier, the signature DB volume is fragile across restarts, and the synchronous-callback design added a Vercel ↔ Railway HMAC contract that paid no security dividend against our actual threat model (authenticated CA + BO uploads of financial documents under a 25 MB cap, with MIME / magic-bytes validation already in D01).
>
> **Future direction:** when virus scanning is reintroduced, the target is **AWS GuardDuty Malware Protection for S3** — bucket-level, asynchronous, no infrastructure to operate, scan results delivered via EventBridge. No ClamAV, no Railway, no Vercel-side scanner orchestration. Until then, every uploadable row's `scan_status` column is set to `'clean'` at confirm time, and no downstream module gates on it. The column and its enum values are retained so the future scanner has a place to write.
>
> The architecture notes in §§1–7 below are preserved as a reference for that future work. The implementation sections (scanner service, callback route, HMAC handshake, retry loop, env vars) have been removed.

---

## 1. Purpose (architectural intent — for future work)

Make file safety a single, enforced, module-owned concern instead of a per-route afterthought. D01 (and later D04, D05, BO doc uploads) would delegate file safety to F03: F03 would own the scan-state machine and the operational policies around bad files (quarantine + alert). It does not parse, classify, or interpret any file content. Storage-cap and per-file-size enforcement live in the calling module (D01) — F03 references rather than restates them.

## 2. Inputs and Outputs (future)

**Inputs**

- Pre-signed upload requests from calling modules (D01 today; D04 / D05 / BO doc routes later).
- An Inngest event from D01 after S3 PUT confirmation + row insert. F03 would subscribe and drive the scan flow.
- Asynchronous scan verdicts from the scanner (target: GuardDuty Malware Protection events via EventBridge).

**Outputs**

- Mutations to the scan lifecycle columns (`scan_status`, `scan_attempts`, `quarantined_at`) on every uploadable table — F03 would be the sole writer.
- On `clean`: emit the upload-kind-specific Inngest event (`muneem/statement.cleared`, `muneem/invoice.cleared`, …) consumed by the downstream processor.
- On `infected`: quarantine the S3 object and emit `muneem/scan.infected` for notification / audit.
- On `error` (after N attempts): emit `muneem/<kind>.scan.failed` for uploader notification.

## 3. Schema columns retained for future use

The `bank_statements` table keeps the scan lifecycle columns regardless of whether scanning is wired:

| Column           | Type                                                                        | Purpose                                                |
| ---------------- | --------------------------------------------------------------------------- | ------------------------------------------------------ |
| `scan_status`    | enum `('pending','scanning','clean','infected','error')`, default `pending` | Lifecycle state. Today: set to `clean` at D01 confirm. |
| `scan_attempts`  | integer, default 0                                                          | Reserved for future retry counter.                     |
| `quarantined_at` | timestamptz, nullable                                                       | Reserved for future quarantine marker.                 |

The `scan_log` table is similarly retained as a placeholder. None of these columns or rows are read by any code path today.

## 4. State machine (for future implementation)

```
pending ──▶ scanning ──▶ clean       [terminal]
                  ──▶ infected   [terminal, after quarantine]
                  ──▶ error      [terminal, after retries exhausted]
```

Terminal states would be immutable; an idempotency guard on the callback / EventBridge handler would drop late re-deliveries.

## 5. Business logic rules (for future implementation)

- **Fail-closed:** `scan_status != 'clean'` would block every downstream processor (D02, D05, D06, D07). Today this guard is intentionally not enforced.
- **Quarantine on infected only:** S3 object copied to `quarantine/<originalKey>` and original deleted; row's `s3_key` rewritten; `quarantined_at` set. 90-day lifecycle rule auto-deletes from quarantine.
- **No quarantine on `error`:** error means no verdict, not a positive infection signal.
- **Sanctioned-country block** stays in **C09** (registration).
- **Retention (7-year scaffold)** is owned independently of scanning.

## 6. Out of scope

- LLM usage: none.
- Public HTTP routes: none. Any callback would be internal and signed.

---

## 7. Dependencies

- **Depends on (modules):** none today. Future implementation would depend on F02 (tenant isolation) and an AWS GuardDuty / EventBridge integration.
- **Depended on by (modules):** none today. D01, D02, D03 do not depend on F03. When scanning is reintroduced, D01 will emit the upstream event and D02/D05/D06 will gate on the `*.cleared` events.
- **External services (future):** AWS S3, AWS GuardDuty Malware Protection for S3, AWS EventBridge, Inngest.

## 8. Open questions

1. Whether GuardDuty Malware Protection for S3 covers all our uploadable buckets at acceptable cost.
2. Whether the future callback path should be EventBridge → Inngest directly, or EventBridge → a thin Vercel route → Inngest.
3. Whether `scan_status` lifecycle should remain on each owning table or migrate to a separate scan-state table once a second uploadable entity (invoices) lands.

---

## 9. Change log

| Date       | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | By            |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| 2026-05-13 | Initial draft from planning conversation.                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Claude Code   |
| 2026-05-14 | Promoted to SPECCED. AV target switched from AWS Lambda + S3 ObjectCreated to Railway-hosted clamd + Node wrapper with persistent volume.                                                                                                                                                                                                                                                                                                                                                                              | Claude Code   |
| 2026-05-16 | Demoted to DRAFT — deferred. Railway/ClamAV implementation removed: scanner service, scan-orchestrator and scan-retry Inngest functions, `/api/v1/internal/scan-callback` route, HMAC helper, quarantine helper, all `SCANNER_*` / `SCAN_CALLBACK_*` / `CLAMAV_*` / `SKIP_VIRUS_SCAN` env vars, and docker-compose ClamAV service deleted. `scan_status` column retained and set to `'clean'` at D01 confirm time. D01/D02/D03/O03 no longer depend on F03. Future direction: AWS GuardDuty Malware Protection for S3. | Bani / Claude |
