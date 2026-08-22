import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { OAuth2Client } from "google-auth-library";
import { gmail, type gmail_v1 } from "googleapis/build/src/apis/gmail";

export const GMAIL_READONLY_SCOPE =
  "https://www.googleapis.com/auth/gmail.readonly";

export const GMAIL_OAUTH_STATE_COOKIE = "gmail_oauth_state";
export const GMAIL_OAUTH_STATE_MAX_AGE_SEC = 10 * 60;

export function gmailRedirectUri(): string {
  const base = (
    process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"
  ).replace(/\/$/, "");
  return `${base}/api/gmail/callback`;
}

export function createGmailOAuthClient() {
  const clientId = process.env.GOOGLE_GMAIL_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_GMAIL_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error(
      "GOOGLE_GMAIL_CLIENT_ID and GOOGLE_GMAIL_CLIENT_SECRET are required",
    );
  }
  return new OAuth2Client(clientId, clientSecret, gmailRedirectUri());
}

export function createGmailApi(auth: OAuth2Client): gmail_v1.Gmail {
  return gmail({ version: "v1", auth });
}

function hmacKey(): Buffer {
  const raw = process.env.TOKEN_ENCRYPTION_KEY?.trim() ?? "";
  const key = Buffer.from(raw, "hex");
  if (key.length !== 32) {
    throw new Error("TOKEN_ENCRYPTION_KEY must be 32-byte hex (64 characters)");
  }
  return key;
}

function sign(body: string): string {
  return createHmac("sha256", hmacKey()).update(body).digest("base64url");
}

export function createOAuthState(ownerId: string): string {
  const payload = JSON.stringify({
    ownerId,
    nonce: randomBytes(16).toString("hex"),
    exp: Date.now() + GMAIL_OAUTH_STATE_MAX_AGE_SEC * 1000,
  });
  const body = Buffer.from(payload).toString("base64url");
  return `${body}.${sign(body)}`;
}

export function verifyOAuthState(state: string, ownerId: string): boolean {
  const dot = state.lastIndexOf(".");
  if (dot <= 0) return false;
  const body = state.slice(0, dot);
  const sig = state.slice(dot + 1);
  const expected = sign(body);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;
  try {
    const parsed = JSON.parse(
      Buffer.from(body, "base64url").toString("utf8"),
    ) as {
      ownerId?: string;
      exp?: number;
    };
    if (parsed.ownerId !== ownerId) return false;
    if (typeof parsed.exp !== "number" || parsed.exp < Date.now()) return false;
    return true;
  } catch {
    return false;
  }
}

export function buildGmailAuthUrl(state: string): string {
  const client = createGmailOAuthClient();
  return client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: false,
    scope: [GMAIL_READONLY_SCOPE],
    state,
  });
}

export async function exchangeGmailCode(code: string) {
  const client = createGmailOAuthClient();
  const { tokens } = await client.getToken(code);
  return tokens;
}
