import { NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  bankStatements,
  invoiceChecklistItems,
  payeeClarifications,
} from "@/db/schema/muneem";
import { requireOwnerSession, UnauthorizedError } from "@/lib/auth/tenant";
import { summarizeChecklist } from "@/lib/invoice-checklist/summary";

export async function GET() {
  try {
    const session = await requireOwnerSession();

    const [latest] = await db
      .select()
      .from(bankStatements)
      .where(
        and(
          eq(bankStatements.clientOrgId, session.clientOrgId),
          eq(bankStatements.status, "parsed"),
        ),
      )
      .orderBy(desc(bankStatements.createdAt))
      .limit(1);

    if (!latest) {
      return NextResponse.json({
        summary: {
          toCollect: 0,
          collected: 0,
          findYourself: 0,
          quickQuestions: 0,
        },
        statementId: null,
      });
    }

    const items = await db
      .select({
        status: invoiceChecklistItems.status,
        documentId: invoiceChecklistItems.documentId,
        gmailSearchStatus: invoiceChecklistItems.gmailSearchStatus,
      })
      .from(invoiceChecklistItems)
      .where(eq(invoiceChecklistItems.statementId, latest.id));

    const pending = await db
      .select({ id: payeeClarifications.id })
      .from(payeeClarifications)
      .where(
        and(
          eq(payeeClarifications.statementId, latest.id),
          eq(payeeClarifications.status, "pending"),
        ),
      );

    return NextResponse.json({
      statementId: latest.id,
      summary: summarizeChecklist(items, pending.length),
    });
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
    }
    throw e;
  }
}
