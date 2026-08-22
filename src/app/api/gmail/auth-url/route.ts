import { NextResponse } from "next/server";
import { requireOwnerSession, UnauthorizedError } from "@/lib/auth/tenant";
import {
  GMAIL_OAUTH_STATE_COOKIE,
  GMAIL_OAUTH_STATE_MAX_AGE_SEC,
  buildGmailAuthUrl,
  createOAuthState,
} from "@/lib/gmail/oauth";

export async function GET() {
  try {
    const session = await requireOwnerSession();
    const state = createOAuthState(session.ownerId);
    const url = buildGmailAuthUrl(state);

    const res = NextResponse.json({ url, state });
    res.cookies.set(GMAIL_OAUTH_STATE_COOKIE, state, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: GMAIL_OAUTH_STATE_MAX_AGE_SEC,
      path: "/",
    });
    return res;
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
    }
    throw e;
  }
}
