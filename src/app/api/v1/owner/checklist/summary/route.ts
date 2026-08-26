import { NextResponse } from "next/server";
import { requireOwnerSession, UnauthorizedError } from "@/lib/auth/tenant";
import { loadLatestParsedChecklistSummary } from "@/lib/invoice-checklist/load-summary";

export async function GET() {
  try {
    const session = await requireOwnerSession();
    const { statementId, summary } = await loadLatestParsedChecklistSummary(
      session.clientOrgId,
    );
    return NextResponse.json({ statementId, summary });
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
    }
    throw e;
  }
}
