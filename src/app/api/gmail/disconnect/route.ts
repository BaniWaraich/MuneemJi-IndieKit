import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { gmailConnections } from "@/db/schema/muneem";
import { requireOwnerSession, UnauthorizedError } from "@/lib/auth/tenant";
import { setGmailConnectedFlag } from "@/lib/gmail/onboarding";

export async function POST() {
  try {
    const session = await requireOwnerSession();
    await db
      .delete(gmailConnections)
      .where(eq(gmailConnections.userId, session.ownerId));
    await setGmailConnectedFlag(session.ownerId, false);
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
    }
    throw e;
  }
}
