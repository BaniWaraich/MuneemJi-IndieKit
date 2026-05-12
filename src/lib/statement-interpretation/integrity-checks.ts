import type { Phase1Document, Phase1Transaction } from './parse-markdown-kv';

export class NormalisationIntegrityError extends Error {
  constructor(public readonly detail: string) {
    super(`normalisation integrity check failed: ${detail}`);
    this.name = 'NormalisationIntegrityError';
  }
}

export type IntegrityInput = {
  doc: Phase1Document;
  rowsToInsert: { amount_minor: bigint }[];
};

/**
 * Hard-fail checks per §7.5. Run before any bank_transactions insert.
 *
 * 1. Row count: rowsToInsert.length === frontmatter.transaction_count.
 * 2. Sum integrity: Σ |amount_minor| of D03 rows == Σ (debit_minor + credit_minor)
 *    of D02 KV, within 1 paise tolerance.
 *
 * Throws on mismatch. The caller commits nothing on failure.
 */
export function assertIntegrity(input: IntegrityInput): void {
  const { doc, rowsToInsert } = input;

  if (rowsToInsert.length !== doc.frontmatter.transaction_count) {
    throw new NormalisationIntegrityError(
      `row count ${rowsToInsert.length} ≠ frontmatter.transaction_count ${doc.frontmatter.transaction_count}`,
    );
  }

  const extractionSum = sumKvDebitsAndCredits(doc.transactions);
  const normalisedAbsSum = rowsToInsert.reduce((acc, r) => {
    const v = r.amount_minor;
    return acc + (v < 0n ? -v : v);
  }, 0n);

  const diff = extractionSum - normalisedAbsSum;
  const absDiff = diff < 0n ? -diff : diff;
  if (absDiff > 1n) {
    throw new NormalisationIntegrityError(
      `sum mismatch: extraction=${extractionSum}, normalised=${normalisedAbsSum}`,
    );
  }
}

function sumKvDebitsAndCredits(rows: Phase1Transaction[]): bigint {
  let acc = 0n;
  for (const r of rows) acc += r.debit_minor + r.credit_minor;
  return acc;
}

export function computeNormalisedSumMinor(rows: { amount_minor: bigint }[]): bigint {
  return rows.reduce((acc, r) => {
    const v = r.amount_minor;
    return acc + (v < 0n ? -v : v);
  }, 0n);
}
