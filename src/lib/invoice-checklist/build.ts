import { eq } from "drizzle-orm";
import { db } from "@/db";
import {
  bankStatements,
  bankTransactions,
  invoiceChecklistItems,
  invoiceChecklistItemTxs,
  payeeClarifications,
} from "@/db/schema/muneem";
import { formatINR } from "@/lib/format/inr";
import {
  buildClarificationPrompt,
  classifyStatementPayees,
  periodLabelFromIso,
  periodLabelFromTxs,
} from "@/lib/invoice-checklist/classify";
import type { BankTxLike } from "@/lib/invoice-checklist/types";
import { listPayeeMemory } from "@/lib/payee-memory/store";

export async function buildInvoiceChecklist(statementId: string): Promise<{
  skipped: boolean;
  clientOrgId: string | null;
  gmailItemIds: string[];
}> {
  const statement = await db.query.bankStatements.findFirst({
    where: eq(bankStatements.id, statementId),
  });
  if (!statement || statement.status !== "parsed") {
    return {
      skipped: true,
      clientOrgId: statement?.clientOrgId ?? null,
      gmailItemIds: [],
    };
  }

  const [already] = await db
    .select({ id: invoiceChecklistItems.id })
    .from(invoiceChecklistItems)
    .where(eq(invoiceChecklistItems.statementId, statementId))
    .limit(1);
  if (already) {
    return {
      skipped: true,
      clientOrgId: statement.clientOrgId,
      gmailItemIds: [],
    };
  }

  const rows = await db
    .select()
    .from(bankTransactions)
    .where(eq(bankTransactions.statementId, statementId));

  const txs: BankTxLike[] = rows.map((r) => ({
    id: r.id,
    description: r.description,
    amountMinor: r.amountMinor,
    transactionDate: r.transactionDate,
    needsInvoice: r.needsInvoice,
    category: r.category,
    matchStatus: r.matchStatus,
    interpretationConfidence: r.interpretationConfidence,
  }));

  const memory = await listPayeeMemory(statement.clientOrgId);
  const clusters = classifyStatementPayees({ transactions: txs, memory });
  const periodLabel =
    periodLabelFromTxs(txs) || periodLabelFromIso(statement.periodStart);

  const gmailItemIds: string[] = [];

  await db.transaction(async (tx) => {
    for (const c of clusters) {
      const gmailSearchStatus = c.gmailEligible ? "queued" : "not_eligible";
      const [item] = await tx
        .insert(invoiceChecklistItems)
        .values({
          clientOrgId: statement.clientOrgId,
          statementId,
          payeeKey: c.payeeKey,
          displayName: c.displayName,
          amountMinor: c.amountMinor,
          currency: statement.currency,
          occurrenceCount: c.occurrenceCount,
          periodLabel,
          status: c.status,
          source: c.source,
          gmailSearchStatus,
        })
        .returning({ id: invoiceChecklistItems.id });

      if (c.transactionIds.length > 0) {
        await tx.insert(invoiceChecklistItemTxs).values(
          c.transactionIds.map((bankTransactionId) => ({
            itemId: item.id,
            bankTransactionId,
          })),
        );
      }

      if (c.kind === "clarification") {
        const typical = c.sampleAmountsMinor[0] ?? c.amountMinor;
        await tx.insert(payeeClarifications).values({
          clientOrgId: statement.clientOrgId,
          statementId,
          payeeKey: c.payeeKey,
          promptText: buildClarificationPrompt({
            displayName: c.displayName,
            typicalAmountLabel: formatINR(typical),
            occurrenceCount: c.occurrenceCount,
            periodLabel,
          }),
          sampleAmountsMinor: c.sampleAmountsMinor.map((n) => n.toString()),
          occurrenceCount: c.occurrenceCount,
          status: "pending",
        });
      }

      if (c.gmailEligible && c.status === "to_collect") {
        gmailItemIds.push(item.id);
      }
    }
  });

  return {
    skipped: false,
    clientOrgId: statement.clientOrgId,
    gmailItemIds,
  };
}
