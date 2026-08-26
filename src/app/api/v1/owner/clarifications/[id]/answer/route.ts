import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { invoiceChecklistItems, payeeClarifications } from "@/db/schema/muneem";
import { requireOwnerSession, UnauthorizedError } from "@/lib/auth/tenant";
import { inngest } from "@/lib/inngest/client";
import { memoryFromAnswer } from "@/lib/payee-memory/types";
import { upsertPayeeMemory } from "@/lib/payee-memory/store";
import { answerClarificationSchema } from "@/lib/validations/checklist.schema";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireOwnerSession();
    const { id } = await params;
    const parsed = answerClarificationSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid input", details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const clarification = await db.query.payeeClarifications.findFirst({
      where: and(
        eq(payeeClarifications.id, id),
        eq(payeeClarifications.clientOrgId, session.clientOrgId),
      ),
    });
    if (!clarification) {
      return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
    }
    if (clarification.status !== "pending") {
      return NextResponse.json({ error: "ALREADY_ANSWERED" }, { status: 409 });
    }

    const { answer } = parsed.data;
    const now = new Date();

    if (answer === "skip") {
      await db
        .update(payeeClarifications)
        .set({ status: "skipped", answer: "skip", updatedAt: now })
        .where(eq(payeeClarifications.id, clarification.id));
      return NextResponse.json({ ok: true });
    }

    const mapped = memoryFromAnswer(answer);
    const item = await db.query.invoiceChecklistItems.findFirst({
      where: and(
        eq(invoiceChecklistItems.statementId, clarification.statementId),
        eq(invoiceChecklistItems.payeeKey, clarification.payeeKey),
        eq(invoiceChecklistItems.clientOrgId, session.clientOrgId),
      ),
    });

    await upsertPayeeMemory({
      clientOrgId: session.clientOrgId,
      payeeKey: clarification.payeeKey,
      displayName: item?.displayName ?? clarification.payeeKey,
      relationship: mapped.relationship,
      invoicePolicy: mapped.invoicePolicy,
      source: "clarification",
    });

    await db
      .update(payeeClarifications)
      .set({ status: "answered", answer, updatedAt: now })
      .where(eq(payeeClarifications.id, clarification.id));

    if (item) {
      const nextStatus =
        mapped.invoicePolicy === "never" ? "not_needed" : "to_collect";
      const gmailEligible = nextStatus === "to_collect";
      await db
        .update(invoiceChecklistItems)
        .set({
          status: nextStatus,
          source: "clarified",
          gmailSearchStatus: gmailEligible ? "queued" : "not_eligible",
          updatedAt: now,
        })
        .where(eq(invoiceChecklistItems.id, item.id));

      if (gmailEligible) {
        await inngest.send({
          id: `gmail-pull-${item.id}`,
          name: "muneem/gmail.invoice-search",
          data: {
            clientOrgId: session.clientOrgId,
            statementId: clarification.statementId,
            itemId: item.id,
          },
        });
      }
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
    }
    throw e;
  }
}
