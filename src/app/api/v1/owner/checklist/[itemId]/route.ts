import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { invoiceChecklistItems } from "@/db/schema/muneem";
import { requireOwnerSession, UnauthorizedError } from "@/lib/auth/tenant";
import { upsertPayeeMemory } from "@/lib/payee-memory/store";
import { patchChecklistItemSchema } from "@/lib/validations/checklist.schema";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ itemId: string }> },
) {
  try {
    const session = await requireOwnerSession();
    const { itemId } = await params;
    const parsed = patchChecklistItemSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid input", details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const item = await db.query.invoiceChecklistItems.findFirst({
      where: and(
        eq(invoiceChecklistItems.id, itemId),
        eq(invoiceChecklistItems.clientOrgId, session.clientOrgId),
      ),
    });
    if (!item) {
      return NextResponse.json({ error: "ITEM_NOT_FOUND" }, { status: 404 });
    }

    await db
      .update(invoiceChecklistItems)
      .set({
        status: "not_needed",
        gmailSearchStatus: "not_eligible",
        updatedAt: new Date(),
      })
      .where(eq(invoiceChecklistItems.id, item.id));

    await upsertPayeeMemory({
      clientOrgId: session.clientOrgId,
      payeeKey: item.payeeKey,
      displayName: item.displayName,
      relationship: "unknown",
      invoicePolicy: "never",
      source: "list_edit",
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
    }
    throw e;
  }
}
