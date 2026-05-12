import type {
  ActiveLoan,
  BankAccountEntry,
  KnownCustomer,
  KnownVendor,
  OwnerDrawingsPattern,
} from '@/db/schema/muneem';
import type { Phase1Transaction } from './parse-markdown-kv';

export type RuleCategory =
  | 'inter_account_transfer'
  | 'vendor_payment'
  | 'customer_receipt'
  | 'loan_emi'
  | 'owner_drawing';

export type RuleMethod =
  | 'rule_known_vendor'
  | 'rule_known_customer'
  | 'rule_active_loan'
  | 'rule_inter_account'
  | 'rule_owner_drawing';

export type RuleMatch = {
  transaction_index: number;
  category: RuleCategory;
  needs_invoice: boolean;
  method: RuleMethod;
  reasoning: string;
  matched_known_vendor_name: string | null;
  matched_active_loan_lender: string | null;
};

export type RulePrefilterContext = {
  /** account_number_last4 of the statement's own account, used to skip self-transfers. */
  ownAccountLast4: string | null;
  bankAccounts: BankAccountEntry[];
  knownVendors: KnownVendor[];
  knownCustomers: KnownCustomer[];
  activeLoans: ActiveLoan[];
  ownerDrawingsPattern: OwnerDrawingsPattern | null;
};

export type RulePrefilterResult = {
  matches: Map<number, RuleMatch>;
  unmatched: Phase1Transaction[];
};

const containsCi = (haystack: string, needle: string): boolean => {
  if (!needle) return false;
  return haystack.toLowerCase().includes(needle.toLowerCase());
};

/**
 * Run §7.2 rules in order, first-match wins, short-circuit. Order matters:
 * inter-account first (most specific), owner drawings last (most permissive).
 *
 * Malformed JSONB (e.g. `description_patterns` not an array) is logged and
 * treated as a no-rule-match for that entry — D03 falls through to the LLM
 * path. Per spec §10 (`RuleEvaluationError`).
 */
export function runRulePrefilter(
  transactions: Phase1Transaction[],
  ctx: RulePrefilterContext,
): RulePrefilterResult {
  const matches = new Map<number, RuleMatch>();
  const unmatched: Phase1Transaction[] = [];

  for (const tx of transactions) {
    const desc = tx.description ?? '';

    const inter = matchInterAccount(tx, desc, ctx);
    if (inter) {
      matches.set(tx.transaction_index, inter);
      continue;
    }

    const vendor = matchKnownVendor(tx, desc, ctx);
    if (vendor) {
      matches.set(tx.transaction_index, vendor);
      continue;
    }

    const customer = matchKnownCustomer(tx, desc, ctx);
    if (customer) {
      matches.set(tx.transaction_index, customer);
      continue;
    }

    const loan = matchActiveLoan(tx, desc, ctx);
    if (loan) {
      matches.set(tx.transaction_index, loan);
      continue;
    }

    const drawings = matchOwnerDrawings(tx, desc, ctx);
    if (drawings) {
      matches.set(tx.transaction_index, drawings);
      continue;
    }

    unmatched.push(tx);
  }

  return { matches, unmatched };
}

function matchInterAccount(
  tx: Phase1Transaction,
  desc: string,
  ctx: RulePrefilterContext,
): RuleMatch | null {
  if (!Array.isArray(ctx.bankAccounts)) return null;
  for (const acc of ctx.bankAccounts) {
    const last4 = acc?.account_number_last4;
    if (!last4 || typeof last4 !== 'string') continue;
    if (ctx.ownAccountLast4 && last4 === ctx.ownAccountLast4) continue;
    if (desc.includes(last4)) {
      return {
        transaction_index: tx.transaction_index,
        category: 'inter_account_transfer',
        needs_invoice: false,
        method: 'rule_inter_account',
        reasoning: `Inter-account transfer to/from ${acc.account_label ?? `account ${last4}`}`,
        matched_known_vendor_name: null,
        matched_active_loan_lender: null,
      };
    }
  }
  return null;
}

function matchKnownVendor(
  tx: Phase1Transaction,
  desc: string,
  ctx: RulePrefilterContext,
): RuleMatch | null {
  if (!Array.isArray(ctx.knownVendors)) return null;
  for (const v of ctx.knownVendors) {
    if (!v || !Array.isArray(v.description_patterns)) {
      logMalformed('knownVendors', v);
      continue;
    }
    for (const pat of v.description_patterns) {
      if (typeof pat === 'string' && containsCi(desc, pat)) {
        return {
          transaction_index: tx.transaction_index,
          category: 'vendor_payment',
          needs_invoice: Boolean(v.needs_invoice),
          method: 'rule_known_vendor',
          reasoning: `Matched known vendor: ${v.name}`,
          matched_known_vendor_name: v.name ?? null,
          matched_active_loan_lender: null,
        };
      }
    }
  }
  return null;
}

function matchKnownCustomer(
  tx: Phase1Transaction,
  desc: string,
  ctx: RulePrefilterContext,
): RuleMatch | null {
  if (!Array.isArray(ctx.knownCustomers)) return null;
  for (const c of ctx.knownCustomers) {
    if (!c || !Array.isArray(c.description_patterns)) {
      logMalformed('knownCustomers', c);
      continue;
    }
    for (const pat of c.description_patterns) {
      if (typeof pat === 'string' && containsCi(desc, pat)) {
        return {
          transaction_index: tx.transaction_index,
          category: 'customer_receipt',
          needs_invoice: false,
          method: 'rule_known_customer',
          reasoning: `Matched known customer: ${c.name}`,
          matched_known_vendor_name: null,
          matched_active_loan_lender: null,
        };
      }
    }
  }
  return null;
}

function matchActiveLoan(
  tx: Phase1Transaction,
  desc: string,
  ctx: RulePrefilterContext,
): RuleMatch | null {
  if (!Array.isArray(ctx.activeLoans)) return null;
  for (const l of ctx.activeLoans) {
    if (!l || typeof l.description_pattern !== 'string') {
      logMalformed('activeLoans', l);
      continue;
    }
    if (containsCi(desc, l.description_pattern)) {
      return {
        transaction_index: tx.transaction_index,
        category: 'loan_emi',
        needs_invoice: false,
        method: 'rule_active_loan',
        reasoning: `Matched active loan: ${l.lender} (${l.loan_type})`,
        matched_known_vendor_name: null,
        matched_active_loan_lender: l.lender ?? null,
      };
    }
  }
  return null;
}

function matchOwnerDrawings(
  tx: Phase1Transaction,
  desc: string,
  ctx: RulePrefilterContext,
): RuleMatch | null {
  const p = ctx.ownerDrawingsPattern;
  if (!p || typeof p.typical_description_pattern !== 'string') return null;
  if (tx.debit_minor <= 0n) return null;
  if (containsCi(desc, p.typical_description_pattern)) {
    return {
      transaction_index: tx.transaction_index,
      category: 'owner_drawing',
      needs_invoice: false,
      method: 'rule_owner_drawing',
      reasoning: 'Matched owner drawings pattern',
      matched_known_vendor_name: null,
      matched_active_loan_lender: null,
    };
  }
  return null;
}

function logMalformed(field: string, entry: unknown): void {
  console.warn(
    `rule-prefilter: malformed ${field} entry — skipping`,
    JSON.stringify(entry).slice(0, 200),
  );
}
