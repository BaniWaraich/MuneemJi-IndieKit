import type { CsvLlmResult, CsvLlmTransaction } from "./csv-llm-parser";
import type { NumberedPageResult, PageRow } from "./page-schema";

export class PdfMergeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PdfMergeError";
  }
}

export function combinePageResults(
  textPages: NumberedPageResult[],
  visionPages: NumberedPageResult[],
): NumberedPageResult[] {
  const byPage = new Map<number, NumberedPageResult>();
  for (const p of textPages) byPage.set(p.page, p);
  // Vision overwrites the same page (salvage) and fills scanned pages.
  for (const p of visionPages) byPage.set(p.page, p);
  return [...byPage.values()].sort((a, b) => a.page - b.page);
}

/**
 * Forward-fill missing balances using LLM-reported debit/credit movement.
 * Some banks leave the running-balance cell blank on intra-day rows.
 */
export function forwardFillBalances(rows: PageRow[]): CsvLlmTransaction[] {
  const anchorIdx = rows.findIndex((r) => r.balance != null);
  if (anchorIdx < 0) {
    throw new PdfMergeError(
      "no row has a printed balance — cannot anchor running balance",
    );
  }
  const balances = new Array<number>(rows.length);
  balances[anchorIdx] = rows[anchorIdx].balance as number;

  for (let i = anchorIdx - 1; i >= 0; i--) {
    const next = rows[i + 1];
    const nextMovement = (next.credit ?? 0) - (next.debit ?? 0);
    balances[i] = balances[i + 1] - nextMovement;
  }

  for (let i = anchorIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    const movement = (row.credit ?? 0) - (row.debit ?? 0);
    const computed = balances[i - 1] + movement;
    if (row.balance != null && Math.abs(row.balance - computed) > 0.01) {
      console.warn(
        `pdf-page-merge: row ${i} balance reconcile mismatch — printed=${row.balance}, computed=${computed.toFixed(2)} (using printed)`,
      );
      balances[i] = row.balance;
    } else {
      balances[i] = row.balance ?? computed;
    }
  }

  return rows.map((r, i) => ({ ...r, balance: balances[i] }));
}

/**
 * Per-row debit/credit direction from the balance delta across consecutive
 * rows. Row 0's direction is still taken from the model.
 */
export function applyBalanceDeltaDirectionOverride(
  txs: CsvLlmTransaction[],
): void {
  for (let i = 1; i < txs.length; i++) {
    const delta = txs[i].balance - txs[i - 1].balance;
    const llmMagnitude = (txs[i].credit ?? 0) + (txs[i].debit ?? 0);
    const derivedMagnitude = Math.abs(delta);
    if (Math.abs(derivedMagnitude - llmMagnitude) > 0.01) {
      console.warn(
        `pdf-page-merge: row ${i} amount disagreement — llm=${llmMagnitude}, balance-delta=${derivedMagnitude.toFixed(2)} (using delta)`,
      );
    }
    if (delta >= 0) {
      txs[i].credit = derivedMagnitude;
      txs[i].debit = null;
    } else {
      txs[i].debit = derivedMagnitude;
      txs[i].credit = null;
    }
  }
}

export function mergePdfPageResults(pages: NumberedPageResult[]): CsvLlmResult {
  const merged: PageRow[] = pages
    .slice()
    .sort((a, b) => a.page - b.page)
    .flatMap((p) => p.transactions);
  const currency = pages.find((p) => p.currency)?.currency ?? "INR";

  if (merged.length === 0) {
    throw new PdfMergeError("no transactions extracted from any page");
  }

  const row0 = merged[0];
  const row0HasDebit = row0.debit != null;
  const row0HasCredit = row0.credit != null;
  if (row0HasDebit === row0HasCredit) {
    throw new PdfMergeError(
      "merged row 0: exactly one of debit/credit must be non-null",
    );
  }
  if (!merged.some((r) => r.balance != null)) {
    throw new PdfMergeError(
      "no row has a printed balance — cannot anchor running balance",
    );
  }

  const transactions = forwardFillBalances(merged);
  applyBalanceDeltaDirectionOverride(transactions);

  const first = transactions[0];
  const last = transactions[transactions.length - 1];
  const opening_balance =
    first.balance - (first.credit ?? 0) + (first.debit ?? 0);
  const closing_balance = last.balance;

  return {
    currency,
    opening_balance,
    closing_balance,
    transactions,
  };
}
