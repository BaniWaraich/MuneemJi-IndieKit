import type { RawTransaction, BankIdentification } from './types';

export class KvIntegrityError extends Error {
  constructor(detail: string) {
    super(`KV integrity check failed: ${detail}`);
    this.name = 'KvIntegrityError';
  }
}

export type ExtractionMethod = 'pdfplumber_cached' | 'pdfplumber_new' | 'csv_llm';

export type RenderKvInput = {
  bank: BankIdentification | null;
  currency: string;
  openingBalance: number;
  closingBalance: number;
  transactions: RawTransaction[];
  extractionMethod: ExtractionMethod;
  extractionConfidence: number;
  accountHolder?: string | null;
  accountNumberLast4?: string | null;
};

export type RenderKvOutput = {
  markdown: string;
  periodStart: string | null;
  periodEnd: string | null;
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const toMinor = (major: number): bigint => BigInt(Math.round(major * 100));

const clamp01 = (v: number): number => {
  if (Number.isNaN(v)) return 0;
  return Math.max(0, Math.min(1, v));
};

// Description must occupy a single line so D03's parser can split each
// `- description: <value>` cleanly. Bank narrations are already single-line
// after the extraction step joins multi-line continuations, but normalise
// defensively against stray CR/LF/tabs and runs of whitespace.
const flattenDescription = (s: string): string => s.replace(/\s+/g, ' ').trim();

export function renderMarkdownKv(input: RenderKvInput): RenderKvOutput {
  const { bank, currency, openingBalance, closingBalance, transactions, extractionMethod } = input;

  const rows: {
    date: string;
    description: string;
    debitMinor: bigint;
    creditMinor: bigint;
    balanceMinor: bigint;
  }[] = [];

  for (let i = 0; i < transactions.length; i++) {
    const t = transactions[i];
    if (!t.date || !DATE_RE.test(t.date)) {
      throw new KvIntegrityError(`row ${i}: date '${t.date}' is not YYYY-MM-DD`);
    }
    const debit = t.debit ?? 0;
    const credit = t.credit ?? 0;
    if (debit > 0 && credit > 0) {
      throw new KvIntegrityError(`row ${i}: both debit and credit non-zero`);
    }
    rows.push({
      date: t.date,
      description: flattenDescription(t.description),
      debitMinor: toMinor(debit),
      creditMinor: toMinor(credit),
      balanceMinor: toMinor(t.balance),
    });
  }

  const dates = [...rows.map((r) => r.date)].sort();
  const periodStart = dates[0] ?? null;
  const periodEnd = dates[dates.length - 1] ?? null;
  const conf = clamp01(input.extractionConfidence);
  const accountHolder = input.accountHolder ?? null;
  const accountNumberLast4 = input.accountNumberLast4 ?? null;

  const lines: string[] = [];
  lines.push('---');
  lines.push(`account_holder: ${accountHolder == null ? 'null' : JSON.stringify(accountHolder)}`);
  // account_number_last4 is quoted to preserve leading zeros per D02 §2.1.
  lines.push(
    `account_number_last4: ${
      accountNumberLast4 == null ? 'null' : JSON.stringify(accountNumberLast4)
    }`,
  );
  lines.push(`bank_name: ${bank ? JSON.stringify(bank.bankName) : 'null'}`);
  lines.push(`bank_identifier: ${bank ? JSON.stringify(bank.bankIdentifier) : 'null'}`);
  lines.push(`country: ${bank ? JSON.stringify(bank.country) : 'null'}`);
  lines.push(`period_start: ${periodStart ?? 'null'}`);
  lines.push(`period_end: ${periodEnd ?? 'null'}`);
  lines.push(`opening_balance_minor: ${toMinor(openingBalance).toString()}`);
  lines.push(`closing_balance_minor: ${toMinor(closingBalance).toString()}`);
  lines.push(`currency: ${currency}`);
  lines.push(`transaction_count: ${rows.length}`);
  lines.push(`extraction_method: ${extractionMethod}`);
  lines.push(`extraction_confidence: ${conf.toFixed(2)}`);
  lines.push('---');
  lines.push('');

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    lines.push(`## Transaction ${i + 1}`);
    lines.push(`- date: ${r.date}`);
    lines.push(`- description: ${r.description}`);
    lines.push(`- debit_minor: ${r.debitMinor.toString()}`);
    lines.push(`- credit_minor: ${r.creditMinor.toString()}`);
    lines.push(`- balance_minor: ${r.balanceMinor.toString()}`);
    lines.push('');
  }

  const markdown = lines.join('\n');

  const blockCount = (markdown.match(/^## Transaction \d+$/gm) ?? []).length;
  if (blockCount !== rows.length) {
    throw new KvIntegrityError(
      `frontmatter transaction_count ${rows.length} ≠ block count ${blockCount}`,
    );
  }

  return { markdown, periodStart, periodEnd };
}

export type ConfidencePath =
  | 'pdfplumber_cached'
  | 'pdfplumber_new_first_try'
  | 'pdfplumber_regen'
  | 'csv_llm';

export function computeExtractionConfidence(params: {
  path: ConfidencePath;
  bankIdentified: boolean;
}): number {
  let base: number;
  switch (params.path) {
    case 'pdfplumber_cached':
      base = 0.95;
      break;
    case 'pdfplumber_new_first_try':
      base = 0.8;
      break;
    case 'pdfplumber_regen':
      base = 0.65;
      break;
    case 'csv_llm':
      base = 0.75;
      break;
  }
  if (!params.bankIdentified) base -= 0.1;
  return clamp01(base);
}
