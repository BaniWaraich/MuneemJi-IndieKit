import { createHash } from 'crypto';
import { eq, desc } from 'drizzle-orm';
import { db } from '@/db';
import { bankStatements, bankTransactions, statementParseLog } from '@/db/schema/muneem';

export type InterpretationMethod =
  | 'rule_known_vendor'
  | 'rule_known_customer'
  | 'rule_active_loan'
  | 'rule_inter_account'
  | 'rule_owner_drawing'
  | 'llm'
  | 'llm_fallback';

export type Category =
  | 'vendor_payment'
  | 'customer_receipt'
  | 'salary'
  | 'bank_charge'
  | 'inter_account_transfer'
  | 'loan_emi'
  | 'owner_drawing'
  | 'tax_payment'
  | 'unknown';

export type MatchStatus = 'unmatched' | 'matched' | 'flagged' | 'out_of_scope';

export type ParseMethod = 'pdfplumber_cached' | 'pdfplumber_new' | 'csv_direct';

export type InterpretedRow = {
  transaction_index: number;
  date: string;
  description: string;
  amount_minor: bigint;
  needs_invoice: boolean;
  category: Category;
  reasoning: string;
  interpretation_method: InterpretationMethod;
  /** numeric(3,2) value as decimal string, e.g. "0.85" */
  interpretation_confidence: string;
  matched_known_vendor_name: string | null;
  matched_active_loan_lender: string | null;
  match_status: MatchStatus;
};

const OUT_OF_SCOPE_CATEGORIES: ReadonlySet<Category> = new Set([
  'inter_account_transfer',
  'salary',
  'bank_charge',
]);

export function deriveMatchStatus(
  category: Category,
  method: InterpretationMethod,
): MatchStatus {
  if (method === 'llm_fallback') return 'flagged';
  if (OUT_OF_SCOPE_CATEGORIES.has(category)) return 'out_of_scope';
  return 'unmatched';
}

export function computeDedupeKey(
  statementId: string,
  date: string,
  amountMinor: bigint,
  description: string,
): string {
  return createHash('sha256')
    .update(`${statementId}|${date}|${amountMinor}|${description}`, 'utf-8')
    .digest('hex');
}

/**
 * Reads parse_method from the most recent D02 log row for this statement.
 * D02 always writes a log row before transitioning to phase1_complete, so a
 * row exists when D03 runs. Falls back to 'csv_direct' defensively.
 */
export async function readD02ParseMethod(statementId: string): Promise<ParseMethod> {
  const row = await db.query.statementParseLog.findFirst({
    where: eq(statementParseLog.statementId, statementId),
    orderBy: desc(statementParseLog.createdAt),
    columns: { parseMethod: true },
  });
  return (row?.parseMethod as ParseMethod) ?? 'csv_direct';
}

export type InsertParams = {
  statementId: string;
  clientOrgId: string;
  firmId: string;
  currency: string;
  rows: InterpretedRow[];
  normalisationMode: 'llm' | 'fallback' | 'skipped';
  normalisedRowCount: number;
  normalisedSumMinor: bigint;
  parseMethod: ParseMethod;
};

/**
 * One Drizzle transaction: insert bank_transactions (ON CONFLICT DO NOTHING on
 * (statement_id, dedupe_key)) → update bank_statements.status='parsed' → write
 * D03's parse-log row (its own append row, parse_method copied from D02's
 * preceding row to satisfy the NOT NULL constraint). Idempotent on retry via
 * dedupe key + status guard.
 */
export async function insertInterpretedRows(params: InsertParams): Promise<void> {
  const { statementId, clientOrgId, firmId, currency, rows, normalisationMode, parseMethod } =
    params;

  await db.transaction(async (tx) => {
    if (rows.length > 0) {
      await tx
        .insert(bankTransactions)
        .values(
          rows.map((r) => ({
            statementId,
            clientOrgId,
            transactionDate: r.date,
            amountMinor: r.amount_minor,
            currency,
            description: r.description,
            needsInvoice: r.needs_invoice,
            matchStatus: r.match_status,
            dedupeKey: computeDedupeKey(statementId, r.date, r.amount_minor, r.description),
            category: r.category,
            reasoning: r.reasoning,
            interpretationMethod: r.interpretation_method,
            interpretationConfidence: r.interpretation_confidence,
            matchedKnownVendorName: r.matched_known_vendor_name,
            matchedActiveLoanLender: r.matched_active_loan_lender,
          })),
        )
        .onConflictDoNothing({
          target: [bankTransactions.statementId, bankTransactions.dedupeKey],
        });
    }

    await tx
      .update(bankStatements)
      .set({ status: 'parsed', errorMessage: null })
      .where(eq(bankStatements.id, statementId));

    try {
      await tx.insert(statementParseLog).values({
        firmId,
        statementId,
        parserScriptId: null,
        parseMethod,
        balanceCheckPass: true,
        transactionsFound: rows.length,
        openingBalance: null,
        closingBalance: null,
        computedClosing: null,
        normalisationMode,
        normalisedRowCount: params.normalisedRowCount,
        normalisedSumMinor: params.normalisedSumMinor,
        errorMessage: null,
      });
    } catch (err) {
      // safeWriteParseLog semantics: a D03 log-write hiccup must never mask a
      // successful interpret commit.
      console.error('insert-transactions: D03 parse-log write failed', err);
    }
  });
}
