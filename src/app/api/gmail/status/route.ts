import { NextResponse } from "next/server";
import { requireOwnerSession, UnauthorizedError } from "@/lib/auth/tenant";
import { getGmailStatus } from "@/lib/gmail/status";

export async function GET() {
  try {
    const session = await requireOwnerSession();
    const status = await getGmailStatus(session.ownerId);
    return NextResponse.json(status);
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
    }
    throw e;
  }
}
