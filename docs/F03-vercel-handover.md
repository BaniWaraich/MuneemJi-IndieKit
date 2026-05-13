# F03 — Vercel Deployment Handover

> **Audience:** the next agent picking this up. Local dev works end-to-end (upload → F03 orchestrator → D02 → D03 in the Inngest dev server). This doc covers what's left to make it work on Vercel preview and production.
>
> **Status as of handover (2026-05-13):**
>
> - F03 application code is committed and working locally with `SKIP_VIRUS_SCAN=true` and `DATABASE_URL` → Neon.
> - Inngest cloud is **not yet configured** for this project (or at least the prod-side keys aren't in Vercel).
> - The AWS Lambda + ClamAV pipeline does **not yet exist**.
> - S3 bucket lifecycle rules do **not yet exist**.
>
> Read `docs/modules/F03-file-upload-virus-scan.md` first — that's the spec; this doc is operational.

---

## 1. What "working on Vercel" means

Two distinct environments, both on Vercel:

| Env        | `VERCEL_ENV` | `SKIP_VIRUS_SCAN`                                | AV pipeline | DB                                  |
| ---------- | ------------ | ------------------------------------------------ | ----------- | ----------------------------------- |
| Preview    | `preview`    | `true` (allowed)                                 | bypassed    | Neon preview branch (or shared dev) |
| Production | `production` | **must be unset/`false`** (boot fails otherwise) | required    | Neon prod                           |

The app already enforces the prod guard: `src/lib/inngest/functions/scan-orchestrator.ts` throws at module load if `VERCEL_ENV === 'production'` and `SKIP_VIRUS_SCAN === 'true'`. The presign route at `src/app/api/v1/clients/[id]/statements/route.ts` has the same guard. **Do not weaken these guards.**

A "minimum viable Vercel deployment" is: **preview works with SKIP_VIRUS_SCAN=true** end-to-end. That validates the schema migration, the Inngest cloud wiring, and the scan-callback route shape without needing the AV Lambda. Production-readiness is a separate milestone (§5).

---

## 2. Phase A — Get preview working (no AV pipeline)

This is the first goal. After this, an upload on a preview deployment runs the full pipeline because F03 short-circuits to `clean` in `SKIP_VIRUS_SCAN` mode.

### A1. Apply the schema migration to every DB the app talks to

The local Neon DB has the F03 columns now (we applied SQL manually after `drizzle-kit migrate` silently no-op'd). **Every other branch/DB also needs the columns.** Required state on each DB:

```sql
-- bank_statements
scan_attempts   integer NOT NULL DEFAULT 0
quarantined_at  timestamptz
CHECK constraint "scan_status_enum" on scan_status IN
  ('pending','scanning','clean','infected','error')

-- new table
scan_log (id uuid PK, s3_key text, attempt int, result text,
          reason text, provider_ref text, created_at timestamptz)
```

The migration file is `drizzle/0003_f03_scan_lifecycle.sql`. The SQL is also reproduced as a manual idempotent script in the conversation log; if `drizzle-kit migrate` again reports success but the columns aren't there, run the SQL directly in the Neon SQL console (it happened once locally).

**Action items:**

- Identify every Neon branch / Postgres DB used by Vercel (preview + prod).
- Apply migration on each. Verify with:
  ```sql
  SELECT column_name FROM information_schema.columns
  WHERE table_name='bank_statements'
    AND column_name IN ('scan_attempts','quarantined_at');
  ```
- Confirm `scan_log` table exists.

### A2. Set Vercel environment variables

Set these for **preview** (and any staging) environments via Vercel dashboard → Project → Settings → Environment Variables. Do **not** copy the local placeholder secret into prod.

| Var                        | Preview value                                            | Prod value                               | Notes                                                                            |
| -------------------------- | -------------------------------------------------------- | ---------------------------------------- | -------------------------------------------------------------------------------- |
| `SKIP_VIRUS_SCAN`          | `true`                                                   | **unset** (or `false`)                   | Production boot-fails if `true`.                                                 |
| `SCAN_CALLBACK_SECRET`     | any random ≥16-char string (e.g. `openssl rand -hex 32`) | new, distinct random ≥32-char hex string | Shared with the Lambda; must match exactly. Each env should have its own secret. |
| `DATABASE_URL`             | preview Neon branch URL                                  | prod Neon URL                            | Already set most likely.                                                         |
| `INNGEST_EVENT_KEY`        | from Inngest cloud (preview env)                         | from Inngest cloud (prod env)            | See A3.                                                                          |
| `INNGEST_SIGNING_KEY`      | from Inngest cloud (preview env)                         | from Inngest cloud (prod env)            | See A3.                                                                          |
| `AWS_*`, `AWS_BUCKET_NAME` | as currently set                                         | as currently set                         | Should already be set — `src/lib/muneem-storage/s3.ts` reads these.              |

The CLAUDE.md memory has a standing rule: **do not change Vercel env without explicit approval from Bani.** Confirm before adding/changing anything.

### A3. Wire up Inngest cloud

Locally we use the Inngest dev server (`./bin/inngest dev -p 8288`). On Vercel, you need Inngest cloud.

- Project: https://app.inngest.com → connect (or reuse) the repo.
- Inngest cloud auto-discovers functions by hitting `https://<deployment>.vercel.app/api/inngest` (route already exists at `src/app/api/inngest/route.ts`).
- Copy the **Event Key** and **Signing Key** for each Inngest env (preview vs prod are separate) into Vercel env vars: `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY`.
- After a Vercel deploy, hit the Inngest dashboard → confirm 6 functions are registered:
  - `muneem-scan-orchestrator` (trigger `muneem/statement.received`)
  - `muneem-scan-retry` (trigger `muneem/scan.retry`)
  - `muneem-statement-extract` (trigger `muneem/statement.cleared`)
  - `muneem-statement-interpret`
  - `muneem-hello-world`, `muneem-expire-credits`

If functions don't appear, Inngest's "Sync" button on the app page forces re-discovery.

### A4. Smoke test on preview

On a Vercel preview deployment:

1. Upload a CSV via the UI.
2. Network tab: `POST /statements` 200, S3 PUT 200, `POST /statements/confirm` 200 with `{ queued: true, skipScan: true }`.
3. Inngest dashboard: events `muneem/statement.received` → `muneem/statement.cleared` → `muneem/statement.extracted` (no `muneem/scan.infected`, no `muneem/scan.failed`).
4. DB check: row in `bank_statements` ends with `status='phase1_complete'` (or `'parsed'` once D03 runs), `scan_status='clean'`, `scan_attempts=1`, `quarantined_at IS NULL`.
5. `scan_log` should have a row with `reason='SKIP_VIRUS_SCAN'`, `result='clean'`.

If any of these fail, the bug is almost certainly in env config (A2/A3) or migration state (A1) — not the app code.

---

## 3. Phase B — Production AV pipeline (the actual ClamAV side)

This is infra work, **not** something an app-code agent can finish unilaterally. Coordinate with whoever owns AWS.

### B1. The contract F03 expects

F03 already accepts callbacks at `POST /api/v1/internal/scan-callback`. The Lambda must:

1. Be triggered by S3 `ObjectCreated:Put` on the uploads bucket, **prefix `statements/`** (and later `invoices/`, `bo-docs/`).
2. Stream the object through ClamAV. Produce one of three verdicts: `clean`, `infected`, `error`.
3. POST to `https://<prod-host>/api/v1/internal/scan-callback` with body:
   ```json
   {
     "s3Key": "statements/<clientOrgId>/<timestamp>-<rand>-<filename>",
     "status": "clean" | "infected" | "error",
     "reason": "optional human-readable note",
     "scanProviderRef": "<lambda-invocation-id>"
   }
   ```
4. Headers (**both required**; HMAC verified pre-DB):
   - `X-Muneem-Scan-Timestamp`: ISO 8601 UTC, e.g. `2026-05-13T12:34:56Z`. Must be within ±5 min of server clock.
   - `X-Muneem-Scan-Sig`: hex-encoded HMAC-SHA256 of `${timestamp}.${rawBody}` using `SCAN_CALLBACK_SECRET` as the key.

The HMAC payload format is intentionally bound to the timestamp so a captured request can't be replayed outside the 5-min window. See `src/lib/storage/scan-hmac.ts` for the exact verification code — match it on the Lambda side.

### B2. Lambda reference signing code (Node)

```js
const crypto = require("crypto");
const timestamp = new Date().toISOString();
const body = JSON.stringify({ s3Key, status, reason, scanProviderRef });
const sig = crypto
  .createHmac("sha256", process.env.SCAN_CALLBACK_SECRET)
  .update(`${timestamp}.${body}`)
  .digest("hex");

await fetch(
  `${process.env.MUNEEM_CALLBACK_URL}/api/v1/internal/scan-callback`,
  {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Muneem-Scan-Timestamp": timestamp,
      "X-Muneem-Scan-Sig": sig,
    },
    body,
  },
);
```

The Lambda env must hold `SCAN_CALLBACK_SECRET` = **the same value** as the Vercel env var for that environment.

### B3. S3 bucket lifecycle rules (also infra)

F03 spec §7 calls for three S3 lifecycle rules. **None exist yet.** All need configuring on the uploads bucket:

1. **Quarantine cleanup** — prefix `quarantine/`, expire (delete) after 90 days.
2. **Long-term retention scaffolding** — prefix `statements/` (and future doc prefixes), transition Standard → Glacier IR after 365 days. **Do NOT add an expiration rule** — legal hasn't confirmed whether 7y is a floor or ceiling (F03 OQ1).
3. **Orphan cleanup backstop** — prefix `uploads/` (or whatever the main upload prefix is), delete incomplete multipart uploads after 1 day, and optionally delete unconfirmed objects (no DB row pointing at them) after 24h. The 24h cleanup is hard to express purely in S3 lifecycle terms; an EventBridge + Lambda janitor may be needed. Defer if not urgent — F03 spec marks this OOS.

### B4. Production smoke test (after Lambda is live)

1. `SKIP_VIRUS_SCAN` unset on prod.
2. Upload an EICAR test file (https://www.eicar.org/download-anti-malware-testfile/) — it's the standard fake virus signature that all AV engines flag.
3. Expected flow:
   - Row inserted with `scan_status='pending'`.
   - Orchestrator transitions to `scanning`.
   - Lambda scans, returns `infected`.
   - Callback route: quarantines the S3 object (moves to `quarantine/` prefix), sets `scan_status='infected'`, sets `quarantined_at`, emits `muneem/scan.infected`.
   - D02 never runs (correct — gated by `scan_status='clean'`).
4. Repeat with a clean file → ends `status='parsed'`, `scan_status='clean'`.

### B5. Retry mechanism — TODO left in code

`src/lib/inngest/functions/scan-retry.ts` is a stub. It sleeps for the backoff window and logs a row to `scan_log` but **does not actually re-trigger the Lambda**. There's an explicit `TODO: infra wiring` comment.

When the AV pipeline is built, decide how to re-invoke the scan for a given `s3Key`:

- Option 1: SQS message that the Lambda also subscribes to.
- Option 2: Toggle an S3 object tag that triggers a separate Lambda copy.
- Option 3: Direct Lambda invocation via AWS SDK from `scan-retry.ts`.

Update the stub to do whichever the team picks.

---

## 4. Known sharp edges

- **`drizzle-kit migrate` silently no-ops** sometimes — it happened locally and required hand-applying the SQL via Neon console. If a deploy claims migrations ran but `information_schema.columns` says otherwise, run the SQL manually. We didn't root-cause this; could be related to `__drizzle_migrations` table state diverging from journal.

- **D02 / D03 module spec docs are stale.** They describe BullMQ. The actual code is Inngest. F03 fits the Inngest reality. Don't re-introduce BullMQ. Specs need refresh as separate work (`docs/modules/D02-...`, `docs/modules/D03-...`) — out of F03 scope.

- **Event naming is post-rename.** `muneem/statement.uploaded` is **gone**. The chain is `received` (D01→F03) → `cleared` (F03→D02) → `extracted` (D02→D03). If you see `muneem/statement.uploaded` anywhere outside historical commit messages, it's a stray.

- **Presign route inserts `scan_status='pending'` always**, even in dev. F03 orchestrator does the `→ clean` transition in `SKIP_VIRUS_SCAN` mode. Earlier the presign route set `clean` directly; that caused the orchestrator's idempotency guard to no-op and the pipeline stalled. Don't revert.

- **The dev `SCAN_CALLBACK_SECRET` placeholder is in `.env`**, real value in `.env.local`. **Never** ship the placeholder to Vercel prod. Bani has a memory rule about not changing deploy env without approval — confirm before touching Vercel env vars.

- **Confirm route does an S3 HEAD** to enforce the 25 MB per-file cap. Requires the object to exist by the time confirm is called (it always should — client PUTs before calling confirm). If S3 HEAD ever fails for a non-missing-object reason (e.g. permissions), the route returns 404 `UPLOAD_NOT_FOUND` — that's intentional fail-closed behavior.

---

## 5. Definition of done

**Phase A (preview):** ✅ Upload works end-to-end on a Vercel preview with `SKIP_VIRUS_SCAN=true`. Inngest dashboard shows the full event chain. DB rows progress through `pending → scanning → clean` and `processing → phase1_complete → parsed`. No 500s.

**Phase B (production):** ✅ Upload works end-to-end on prod with **no** `SKIP_VIRUS_SCAN`. EICAR test file is quarantined and downstream is blocked. Clean files reach `parsed`. Scan callback HMAC verification rejects unsigned requests with 401. `scan_log` accumulates one row per attempt.

Don't claim "F03 done on Vercel" until both phases pass smoke tests.

---

## 6. Files to read first

In this order:

1. `docs/modules/F03-file-upload-virus-scan.md` — the spec.
2. `src/lib/inngest/functions/scan-orchestrator.ts` — entry point of the F03 state machine.
3. `src/app/api/v1/internal/scan-callback/route.ts` — the Lambda-facing HTTP surface.
4. `src/lib/storage/scan-hmac.ts` — the contract the Lambda must satisfy.
5. `src/lib/storage/quarantine.ts` — what happens to infected files.
6. `src/lib/inngest/functions/scan-retry.ts` — the stub you'll need to finish.

That's enough context to do Phase A immediately. Phase B requires AWS access and coordination — flag the request to whoever owns infra.
