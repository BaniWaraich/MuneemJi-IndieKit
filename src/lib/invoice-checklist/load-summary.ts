import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  bankStatements,
  invoiceChecklistItems,
  payeeClarifications,
} from "@/db/schema/muneem";
import { summarizeChecklist, type ChecklistSummary } from "./summary";

const EMPTY: ChecklistSummary = {
  toCollect: 0,
  collected: 0,
  findYourself: 0,
  quickQuestions: 0,
};

export type LatestChecklistSummary = {
  statementId: string | null;
  summary: ChecklistSummary;
};

export async function loadLatestParsedChecklistSummary(
  clientOrgId: string,
): Promise<LatestChecklistSummary> {
  try {
    const [latest] = await db
      .select({ id: bankStatements.id })
      .from(bankStatements)
      .where(
        and(
          eq(bankStatements.clientOrgId, clientOrgId),
          eq(bankStatements.status, "parsed"),
        ),
      )
      .orderBy(desc(bankStatements.createdAt))
      .limit(1);

    if (!latest) return { statementId: null, summary: EMPTY };

    const [items, pending] = await Promise.all([
      db
        .select({
          status: invoiceChecklistItems.status,
          documentId: invoiceChecklistItems.documentId,
          gmailSearchStatus: invoiceChecklistItems.gmailSearchStatus,
        })
        .from(invoiceChecklistItems)
        .where(eq(invoiceChecklistItems.statementId, latest.id)),
      db
        .select({ id: payeeClarifications.id })
        .from(payeeClarifications)
        .where(
          and(
            eq(payeeClarifications.statementId, latest.id),
            eq(payeeClarifications.status, "pending"),
          ),
        ),
    ]);

    return {
      statementId: latest.id,
      summary: summarizeChecklist(items, pending.length),
    };
  } catch (err) {
    console.error("loadLatestParsedChecklistSummary", err);
    return { statementId: null, summary: EMPTY };
  }
}
