---
id: F09
name: gmail-connect
status: IMPLEMENTED
owners: ["api", "frontend", "db-handler"]
last_updated: 2026-08-22
---

# F09 — Gmail Connect Foundation

> F09 lets a linked business owner connect one Gmail account with read-only OAuth so later invoice-pull jobs can search and download mail. This slice owns encrypted token storage, connect / status / disconnect, and the BO-facing Connect UI. It does not search mail in the UI, run background jobs, or support Outlook / multiple accounts.

---

## Status

`IMPLEMENTED` (2026-08-22) — `gmail_connections` + `client_users.onboarding_progress`; encrypted tokens; `/api/gmail/{auth-url,callback,status,disconnect}`; owner onboarding Connect card + dashboard Data sources card; helpers in `src/lib/gmail/client.ts` for later jobs.

---

## 1. Purpose

Business owners need a durable Gmail connection so Muneem Ji can later find invoices in their inbox. This module stores Google OAuth tokens encrypted in Postgres, keeps a hybrid onboarding flag in sync, and exposes connect / status / disconnect to the owner UI. Search, download, and matching happen in later modules that call `src/lib/gmail/client.ts` — never by decrypting tokens themselves.

---

## 2. Inputs and Outputs

**Inputs**

- Linked-BO session (`role = business_owner`); `ownerId` is `client_users.id`
- Google OAuth authorization `code` on the callback
- Env: `GOOGLE_GMAIL_CLIENT_ID`, `GOOGLE_GMAIL_CLIENT_SECRET`, `TOKEN_ENCRYPTION_KEY` (32-byte hex), `NEXT_PUBLIC_APP_URL`

**Outputs**

- `gmail_connections` row (upserted on connect, deleted on disconnect)
- `client_users.onboarding_progress.gmail_connected` boolean (hybrid progress; table is source of truth)
- HTTP: consent URL, status payload, redirects after callback
- Internal helpers: valid access token, message search/get, attachment bytes

This module does NOT produce search UI, Inngest jobs, journal entries, Outlook connections, or multiple Gmail accounts per owner.

---

## 3. Trigger Mechanism

- `GET /api/gmail/auth-url` — BO starts connect / reconnect
- `GET /api/gmail/callback` — Google redirects here with `code` + `state`
- `GET /api/gmail/status` — BO UI and manual checks
- `POST /api/gmail/disconnect` — BO disconnects
- Direct calls from future Inngest functions into `src/lib/gmail/client.ts` (not in this slice)

---

## 4. Schema Tables Owned

| Table               | Ownership                          | Notes                                                       |
| ------------------- | ---------------------------------- | ----------------------------------------------------------- |
| `gmail_connections` | sole writer                        | Encrypted tokens; one row per `client_users.id`             |
| `client_users`      | shared writer (O01 owns the table) | This module owns only `onboarding_progress.gmail_connected` |

`gmail_connections` is source of truth for whether Gmail is connected. The JSONB flag is updated on connect/disconnect so onboarding UI can read hybrid progress without a join, but UI must prefer `gmail_connections.status === 'active'`.

### `gmail_connections`

| Column                      | Type                               | Notes                                   |
| --------------------------- | ---------------------------------- | --------------------------------------- |
| `id`                        | uuid PK                            |                                         |
| `user_id`                   | uuid unique FK → `client_users.id` | Linked BO; cascade on delete            |
| `gmail_address`             | text                               | From `users.getProfile`                 |
| `access_token`              | text                               | AES-256-GCM ciphertext                  |
| `refresh_token`             | text                               | AES-256-GCM ciphertext                  |
| `token_expiry`              | timestamptz                        | Access token expiry                     |
| `scopes`                    | text                               | Granted scopes string                   |
| `status`                    | text                               | `active` \| `needs_reauth` \| `revoked` |
| `connected_at`              | timestamptz                        | Set on first insert only                |
| `last_used_at`              | timestamptz                        | Updated on token use / probe            |
| `created_at` / `updated_at` | timestamptz                        |                                         |

### Environment variables

```bash
GOOGLE_GMAIL_CLIENT_ID=
GOOGLE_GMAIL_CLIENT_SECRET=
TOKEN_ENCRYPTION_KEY=   # 64-char hex (32 bytes). Distinct from NextAuth GOOGLE_CLIENT_*.
```

Redirect URI registered on the Gmail OAuth client:

`{NEXT_PUBLIC_APP_URL}/api/gmail/callback`

Example local: `http://localhost:3000/api/gmail/callback`

Scope: `https://www.googleapis.com/auth/gmail.readonly` only. `access_type=offline` and `prompt=consent` on every consent URL so Google returns a refresh token.

---

## 5. API Contracts

Auth for all routes: linked-BO session via `requireOwnerSession`. 401 `UNAUTHORIZED` otherwise. Do not use NextAuth's login Google provider.

### `GET /api/gmail/auth-url`

- **Response 200:** `{ url: string, state: string }`
- Sets httpOnly `SameSite=Lax` cookie `gmail_oauth_state` (10 min) to the same signed state. State is HMAC-bound to `ownerId`.

### `GET /api/gmail/callback`

- **Query:** `code`, `state`
- **Success:** redirect `/owner/onboarding?gmail=connected`
- **Failure:** redirect `/owner/onboarding?gmail=error`
- Validates cookie `state` against query `state` and HMAC `ownerId`. Exchanges code, encrypts tokens, upserts `gmail_connections` (`status=active`; `connected_at` only on insert), sets `onboarding_progress.gmail_connected = true`, clears the state cookie.

### `GET /api/gmail/status`

- **Response 200:**
  ```ts
  {
    status: "disconnected" | "active" | "needs_reauth" | "revoked";
    gmailAddress: string | null;
    connectedAt: string | null; // ISO
    lastUsedAt: string | null; // ISO
  }
  ```
- No row → `disconnected` and nulls.
- If DB status is `active`, probe Google (`users.getProfile` / refresh). `invalid_grant` or auth failure → persist `needs_reauth` and return that.

### `POST /api/gmail/disconnect`

- **Response 200:** `{ ok: true }`
- Deletes the `gmail_connections` row; sets `gmail_connected = false`.

---

## 6. Queue Jobs

None in this slice. Future invoice-pull jobs must import helpers from `src/lib/gmail/client.ts` and must not decrypt tokens or write `gmail_connections` except through those helpers.

```ts
import {
  getValidAccessToken,
  searchMessages,
  getMessage,
  downloadAttachment,
} from "@/lib/gmail/client";

const token = await getValidAccessToken(clientUserId);
const { messages } = await searchMessages(
  clientUserId,
  "has:attachment filename:pdf",
);
```

`clientUserId` is `client_users.id` (the BO's `session.user.id` / `requireOwnerSession().ownerId`).

---

## 7. Business Logic Rules

- One Gmail account per linked BO (`user_id` unique).
- Tokens at rest are AES-256-GCM; plaintext is never logged.
- `TOKEN_ENCRYPTION_KEY` is 32-byte hex; leading/trailing whitespace is trimmed.
- OAuth state is CSRF protection: cookie + query + HMAC-bound `ownerId`.
- Refresh happens automatically when access token is within 60s of expiry.
- Google `invalid_grant` (including user revoke in Google Account settings) sets `status = needs_reauth`. It does not delete the row.
- Disconnect deletes the row (does not set `revoked`).
- `onboarding_progress.gmail_connected` is a cache of connect/disconnect; `gmail_connections` wins if they diverge.
- Login Google OAuth (`GOOGLE_CLIENT_ID`) stays separate from Gmail OAuth (`GOOGLE_GMAIL_CLIENT_ID`).

---

## 8. LLM Usage

None.

---

## 9. Economics

| Component                | Per unit   | Frequency                         | Notes                                  |
| ------------------------ | ---------- | --------------------------------- | -------------------------------------- |
| Google OAuth / Gmail API | free quota | connect, status probe, later jobs | Watch 429s on Gmail API when jobs land |
| Encryption               | CPU only   | per token read/write              |                                        |

---

## 10. Failure Modes

| Failure                        | Trigger                      | Impact                              | Severity | Recovery                    |
| ------------------------------ | ---------------------------- | ----------------------------------- | -------- | --------------------------- |
| `UNAUTHORIZED`                 | No BO session                | 401 on API; callback error redirect | low      | Sign in as BO               |
| `OAUTH_STATE_MISMATCH`         | Missing/expired/forged state | Callback error redirect             | med      | Retry Connect               |
| `invalid_grant`                | Refresh token revoked        | `needs_reauth` on status            | med      | Reconnect                   |
| Missing refresh token          | Google omitted token         | Connect fails / error redirect      | med      | Retry with `prompt=consent` |
| Encryption key missing/invalid | Bad `TOKEN_ENCRYPTION_KEY`   | 500 on connect/status               | high     | Fix env (64-char hex)       |

---

## 11. Dependencies

- **Depends on (modules):** O01 (linked BO / `client_users`), F01 session shape (`requireOwnerSession`)
- **Depended on by (modules):** future email invoice-pull (D04 listed this as out of scope); not D04 itself
- **External services:** Google OAuth 2.0 + Gmail API (`googleapis`)

---

## 12. Open Questions

None. Locked 2026-08-22: BO-owned via `client_users.id`; `/owner/onboarding` for the full card; dashboard compact card only.

---

## 13. Manual verification

1. Connect Gmail → row `status=active`, `onboarding_progress.gmail_connected=true`, address shown.
2. Refresh the page → still connected.
3. Disconnect → row gone, flag false.
4. Reconnect works (new consent + refresh token).
5. Revoke access at [Google Account permissions](https://myaccount.google.com/permissions) → next `GET /api/gmail/status` returns `needs_reauth`.

---

## 14. Change Log

| Date       | Change                                    | By           |
| ---------- | ----------------------------------------- | ------------ |
| 2026-08-22 | Initial spec (Gmail Connect Foundation)   | Bani / agent |
| 2026-08-22 | Implemented connect / status / disconnect | agent        |
