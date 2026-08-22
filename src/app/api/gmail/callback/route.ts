import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { gmailConnections } from "@/db/schema/muneem";
import { requireOwnerSession, UnauthorizedError } from "@/lib/auth/tenant";
import { encryptToken } from "@/lib/encryption/tokens";
import { setGmailConnectedFlag } from "@/lib/gmail/onboarding";
import {
  GMAIL_OAUTH_STATE_COOKIE,
  GMAIL_READONLY_SCOPE,
  createGmailApi,
  createGmailOAuthClient,
  exchangeGmailCode,
  verifyOAuthState,
} from "@/lib/gmail/oauth";

function onboardingRedirect(result: "connected" | "error") {
  const base = (
    process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"
  ).replace(/\/$/, "");
  return NextResponse.redirect(
    new URL(`/owner/onboarding?gmail=${result}`, base),
  );
}

function clearStateCookie(res: NextResponse) {
  res.cookies.set(GMAIL_OAUTH_STATE_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 0,
    path: "/",
  });
  return res;
}

export async function GET(request: Request) {
  try {
    const session = await requireOwnerSession();
    const url = new URL(request.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const cookieStore = await cookies();
    const cookieState = cookieStore.get(GMAIL_OAUTH_STATE_COOKIE)?.value;

    if (
      !code ||
      !state ||
      !cookieState ||
      cookieState !== state ||
      !verifyOAuthState(state, session.ownerId)
    ) {
      return clearStateCookie(onboardingRedirect("error"));
    }

    const tokens = await exchangeGmailCode(code);
    if (!tokens.access_token) {
      return clearStateCookie(onboardingRedirect("error"));
    }

    const existing = await db.query.gmailConnections.findFirst({
      where: eq(gmailConnections.userId, session.ownerId),
      columns: { refreshToken: true },
    });

    const refreshPlain = tokens.refresh_token;
    if (!refreshPlain && !existing) {
      return clearStateCookie(onboardingRedirect("error"));
    }

    const oauth2 = createGmailOAuthClient();
    oauth2.setCredentials({ access_token: tokens.access_token });
    const gmailApi = createGmailApi(oauth2);
    const profile = await gmailApi.users.getProfile({ userId: "me" });
    const gmailAddress = profile.data.emailAddress;
    if (!gmailAddress) {
      return clearStateCookie(onboardingRedirect("error"));
    }

    const expiry = tokens.expiry_date
      ? new Date(tokens.expiry_date)
      : new Date(Date.now() + 3600 * 1000);
    const now = new Date();
    const accessCipher = encryptToken(tokens.access_token);
    const refreshCipher = refreshPlain
      ? encryptToken(refreshPlain)
      : existing!.refreshToken;

    await db
      .insert(gmailConnections)
      .values({
        userId: session.ownerId,
        gmailAddress,
        accessToken: accessCipher,
        refreshToken: refreshCipher,
        tokenExpiry: expiry,
        scopes: tokens.scope ?? GMAIL_READONLY_SCOPE,
        status: "active",
        connectedAt: now,
        lastUsedAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: gmailConnections.userId,
        set: {
          gmailAddress,
          accessToken: accessCipher,
          refreshToken: refreshCipher,
          tokenExpiry: expiry,
          scopes: tokens.scope ?? GMAIL_READONLY_SCOPE,
          status: "active",
          lastUsedAt: now,
          updatedAt: now,
        },
      });

    await setGmailConnectedFlag(session.ownerId, true);

    return clearStateCookie(onboardingRedirect("connected"));
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      const login = (
        process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"
      ).replace(/\/$/, "");
      return NextResponse.redirect(new URL("/owner/login", login));
    }
    console.error("Gmail OAuth callback failed", e);
    return clearStateCookie(onboardingRedirect("error"));
  }
}
