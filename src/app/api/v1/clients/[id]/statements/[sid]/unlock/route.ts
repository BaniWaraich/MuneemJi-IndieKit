import { NextResponse } from "next/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { bankStatements } from "@/db/schema/muneem";
import {
  requireFirmOrOwnerForClient,
  UnauthorizedError,
  ForbiddenError,
} from "@/lib/auth/tenant";
import { inngest } from "@/lib/inngest/client";

// Task 1 — Locked PDF Support.
// Supplies a password for a statement parked in `password_required` and
// re-triggers D02 by re-firing `muneem/statement.uploaded` with the password
// in the event payload. The password is NEVER persisted, NEVER logged, and
// only travels in the Inngest event payload (in-memory / encrypted transport).
const schema = z.object({
  password: z.string().min(1).max(128),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; sid: string }> },
) {
  try {
    const { id, sid } = await params;
    await requireFirmOrOwnerForClient(id);

    const body = await request.json().catch(() => null);
    const result = schema.safeParse(body);
    if (!result.success) {
      return NextResponse.json(
        { error: "Invalid input", details: result.error.flatten() },
        { status: 400 },
      );
    }

    const { password } = result.data;

    const statement = await db.query.bankStatements.findFirst({
      where: and(
        eq(bankStatements.id, sid),
        eq(bankStatements.clientOrgId, id),
      ),
      columns: { id: true, status: true },
    });

    if (!statement) {
      return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
    }

    if (statement.status !== "password_required") {
      return NextResponse.json(
        { error: "NOT_AWAITING_PASSWORD" },
        { status: 409 },
      );
    }

    // Transition to `unlocking` so the UI can reflect "Processing…" and D02's
    // idempotency guard accepts the re-fired event. Clear any prior
    // wrong-password message.
    await db
      .update(bankStatements)
      .set({ status: "unlocking", errorMessage: null })
      .where(eq(bankStatements.id, sid));

    // Re-fire D01's event so D02 re-runs. The password lives only in this
    // payload — it is not written to the row above.
    await inngest.send({
      name: "muneem/statement.uploaded",
      data: { statementId: sid, password },
    });

    return NextResponse.json({ queued: true });
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
    }
    if (e instanceof ForbiddenError) {
      return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
    }
    throw e;
  }
}
