import type { RawTransaction } from './types';

export type BalanceValidationResult = {
  pass: boolean;
  computedClosing: bigint;
};

export type RunningBalanceResult = {
  pass: boolean;
  firstMismatchIndex: number | null;
  expected: bigint | null;
  got: bigint | null;
};

export class UnsupportedCurrencyError extends Error {
  constructor(currency: string) {
    super(`currency '${currency}' is not in the two-decimal allow-list`);
    this.name = 'UnsupportedCurrencyError';
  }
}

/**
 * Currencies we know use two-decimal minor units (paise, cents). V1 is
 * India-only — anything else throws so we never silently mis-convert a
 * zero-decimal or three-decimal currency by assuming *100.
 */
export const CURRENCIES_WITH_TWO_DECIMALS = new Set(['INR', 'USD', 'CAD', 'EUR', 'GBP']);

export function assertSupportedCurrency(currency: string): void {
  if (!CURRENCIES_WITH_TWO_DECIMALS.has(currency.toUpperCase())) {
    throw new UnsupportedCurrencyError(currency);
  }
}

const toMinor = (n: number): bigint => BigInt(Math.round(n * 100));

/**
 * Endpoint check: openingBalance + sum(credits) - sum(debits) == closingBalance.
 * Tolerance 1 minor unit to absorb float rounding.
 */
export function validateBalance(params: {
  openingBalance: number;
  closingBalance: number;
  rows: RawTransaction[];
}): BalanceValidationResult {
  const { openingBalance, closingBalance, rows } = params;

  const openingMinor = toMinor(openingBalance);
  const closingMinor = toMinor(closingBalance);

  let totalCredits = 0n;
  let totalDebits = 0n;

  for (const row of rows) {
    if (row.credit != null) totalCredits += toMinor(row.credit);
    if (row.debit != null) totalDebits += toMinor(row.debit);
  }

  const computedClosing = openingMinor + totalCredits - totalDebits;
  const diff = computedClosing - closingMinor;
  const absDiff = diff < 0n ? -diff : diff;

  return {
    pass: absDiff <= 1n,
    computedClosing,
  };
}

/**
 * Per-row check: row[i].balance == row[i-1].balance + credit - debit (tolerance
 * 1 minor unit). Catches misaligned columns and dropped rows that the endpoint
 * check misses (two mistakes can cancel).
 */
export function validateRunningBalances(params: {
  rows: RawTransaction[];
}): RunningBalanceResult {
  const { rows } = params;
  if (rows.length === 0) {
    return { pass: true, firstMismatchIndex: null, expected: null, got: null };
  }

  for (let i = 1; i < rows.length; i++) {
    const prev = toMinor(rows[i - 1].balance);
    const credit = rows[i].credit != null ? toMinor(rows[i].credit as number) : 0n;
    const debit = rows[i].debit != null ? toMinor(rows[i].debit as number) : 0n;
    const expected = prev + credit - debit;
    const got = toMinor(rows[i].balance);
    const diff = expected - got;
    const absDiff = diff < 0n ? -diff : diff;
    if (absDiff > 1n) {
      return { pass: false, firstMismatchIndex: i, expected, got };
    }
  }

  return { pass: true, firstMismatchIndex: null, expected: null, got: null };
}
