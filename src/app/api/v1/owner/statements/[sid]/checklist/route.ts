import { NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  bankStatements,
  documents,
  gmailConnections,
  invoiceChecklistItems,
  payeeClarifications,
} from "@/db/schema/muneem";
import { requireOwnerSession, UnauthorizedError } from "@/lib/auth/tenant";
import { summarizeChecklist } from "@/lib/invoice-checklist/summary";
import { isS3Configured, presignGet } from "@/lib/muneem-storage/presign";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ sid: string }> },
) {
  try {
    const session = await requireOwnerSession();
    const { sid } = await params;

    const statement = await db.query.bankStatements.findFirst({
      where: and(
        eq(bankStatements.id, sid),
        eq(bankStatements.clientOrgId, session.clientOrgId),
      ),
    });
    if (!statement) {
      return NextResponse.json(
        { error: "STATEMENT_NOT_FOUND" },
        { status: 404 },
      );
    }
    if (statement.status !== "parsed") {
      return NextResponse.json(
        { error: "NOT_READY", status: statement.status },
        { status: 409 },
      );
    }

    const [items, clarifications, gmailRow] = await Promise.all([
      db
        .select()
        .from(invoiceChecklistItems)
        .where(
          and(
            eq(invoiceChecklistItems.statementId, sid),
            eq(invoiceChecklistItems.clientOrgId, session.clientOrgId),
          ),
        ),
      db
        .select()
        .from(payeeClarifications)
        .where(
          and(
            eq(payeeClarifications.statementId, sid),
            eq(payeeClarifications.clientOrgId, session.clientOrgId),
            eq(payeeClarifications.status, "pending"),
          ),
        ),
      db.query.gmailConnections.findFirst({
        where: eq(gmailConnections.userId, session.ownerId),
      }),
    ]);

    const docIds = items
      .map((i) => i.documentId)
      .filter((id): id is string => Boolean(id));
    const docs =
      docIds.length > 0
        ? await db
            .select({
              id: documents.id,
              s3Key: documents.s3Key,
              gmailAddress: documents.gmailAddress,
            })
            .from(documents)
            .where(inArray(documents.id, docIds))
        : [];
    const docById = new Map(docs.map((d) => [d.id, d]));

    const s3Ok = isS3Configured();
    const mapped = await Promise.all(
      items.map(async (row) => {
        const doc = row.documentId ? docById.get(row.documentId) : undefined;
        let viewUrl: string | undefined;
        if (doc && s3Ok) {
          try {
            viewUrl = await presignGet(doc.s3Key);
          } catch {
            viewUrl = undefined;
          }
        }
        return {
          id: row.id,
          displayName: row.displayName,
          amountMinor: row.amountMinor.toString(),
          currency: row.currency,
          periodLabel: row.periodLabel,
          occurrenceCount: row.occurrenceCount,
          status: row.status,
          viewUrl,
          fromGmail: doc?.gmailAddress ? true : undefined,
        };
      }),
    );

    const toCollect = mapped.filter((i) => i.status === "to_collect");
    const collected = mapped.filter((i) => i.status === "collected");
    const notNeeded = mapped.filter((i) => i.status === "not_needed");

    let gmailHint: "needs_reauth" | "not_connected" | undefined;
    if (!gmailRow) gmailHint = "not_connected";
    else if (gmailRow.status === "needs_reauth") gmailHint = "needs_reauth";

    return NextResponse.json({
      statement: {
        id: statement.id,
        filename: statement.filename,
        status: statement.status,
        periodStart: statement.periodStart,
        periodEnd: statement.periodEnd,
        currency: statement.currency,
      },
      summary: summarizeChecklist(items, clarifications.length),
      clarifications: clarifications.map((c) => ({
        id: c.id,
        payeeKey: c.payeeKey,
        promptText: c.promptText,
        occurrenceCount: c.occurrenceCount,
        sampleAmountsMinor: c.sampleAmountsMinor,
      })),
      items: { toCollect, collected, notNeeded },
      gmailHint,
    });
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
    }
    throw e;
  }
}
