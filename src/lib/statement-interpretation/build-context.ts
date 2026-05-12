import type { clientProfiles, clientKnowledge } from '@/db/schema/muneem';

type ProfileRow = typeof clientProfiles.$inferSelect;
type KnowledgeRow = typeof clientKnowledge.$inferSelect;

const NONE = '(none)';

export function buildClientContextBlock(profile: ProfileRow, knowledge: KnowledgeRow | null): string {
  const banks = serialiseBankAccounts(profile.bankAccounts);
  const vendors = knowledge ? serialiseKnownVendors(knowledge.knownVendors) : NONE;
  const customers = knowledge ? serialiseKnownCustomers(knowledge.knownCustomers) : NONE;
  const loans = knowledge ? serialiseActiveLoans(knowledge.activeLoans) : NONE;
  const drawings = knowledge ? serialiseOwnerDrawings(knowledge.ownerDrawingsPattern) : NONE;
  const seasonality = knowledge ? serialiseSeasonality(knowledge.seasonality) : NONE;
  const cashDeposits = knowledge ? serialiseCashDeposits(knowledge.cashDepositPattern) : NONE;

  return [
    'CLIENT CONTEXT',
    `Business: ${profile.industry} | ${profile.businessType} | ${profile.legalStructure}`,
    `GST registration: ${profile.gstRegistrationType}`,
    `Description: ${profile.description}`,
    `Transaction mode: ${profile.primaryTransactionMode}`,
    `Has inter-company transactions: ${profile.hasInterCompanyTransactions}`,
    `Known bank accounts: ${banks}`,
    '',
    'KNOWN VENDORS (already pre-filtered out of this batch — included for context only,',
    "so you understand the client's vendor landscape):",
    vendors,
    '',
    'KNOWN CUSTOMERS (already pre-filtered out — included for context):',
    customers,
    '',
    'KNOWN RECURRING DEBITS (already pre-filtered out — included for context):',
    loans,
    '',
    'OWNER DRAWINGS PATTERN (already pre-filtered when matched):',
    drawings,
    '',
    'SEASONALITY:',
    seasonality,
    '',
    'CASH DEPOSIT PATTERN (only relevant if transaction_mode is cash_heavy):',
    cashDeposits,
  ].join('\n');
}

function serialiseBankAccounts(arr: ProfileRow['bankAccounts']): string {
  if (!Array.isArray(arr) || arr.length === 0) return NONE;
  return arr
    .map(
      (a) =>
        `- ${a.account_label} (${a.bank_name}, ****${a.account_number_last4})${
          a.is_primary_operating ? ' [primary]' : ''
        }`,
    )
    .join('\n');
}

function serialiseKnownVendors(arr: KnowledgeRow['knownVendors']): string {
  if (!Array.isArray(arr) || arr.length === 0) return NONE;
  return arr
    .map(
      (v) =>
        `- ${v.name} (${v.category}, needs_invoice=${v.needs_invoice}); patterns: ${(v.description_patterns ?? []).join(' | ')}`,
    )
    .join('\n');
}

function serialiseKnownCustomers(arr: KnowledgeRow['knownCustomers']): string {
  if (!Array.isArray(arr) || arr.length === 0) return NONE;
  return arr
    .map((c) => `- ${c.name}; patterns: ${(c.description_patterns ?? []).join(' | ')}`)
    .join('\n');
}

function serialiseActiveLoans(arr: KnowledgeRow['activeLoans']): string {
  if (!Array.isArray(arr) || arr.length === 0) return NONE;
  return arr
    .map(
      (l) =>
        `- ${l.lender} (${l.loan_type}); pattern: ${l.description_pattern}; ~${l.approximate_amount_minor} minor units`,
    )
    .join('\n');
}

function serialiseOwnerDrawings(p: KnowledgeRow['ownerDrawingsPattern']): string {
  if (!p) return NONE;
  return `- method=${p.method}; ~${p.approximate_monthly_minor}/mo; pattern=${
    p.typical_description_pattern ?? '(none)'
  }`;
}

function serialiseSeasonality(s: KnowledgeRow['seasonality']): string {
  if (!s) return NONE;
  return `peak months=${(s.peak_months ?? []).join(',')}; lean months=${(s.lean_months ?? []).join(',')}${
    s.notes ? `; notes=${s.notes}` : ''
  }`;
}

function serialiseCashDeposits(c: KnowledgeRow['cashDepositPattern']): string {
  if (!c) return NONE;
  return `frequency=${c.frequency}; range ${c.typical_amount_min_minor}–${c.typical_amount_max_minor} minor units`;
}
