type ChartOfAccount = {
  id: string;
  clientOrgId: string;
  code: string;
  name: string;
  accountType: 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE';
  taxRole: string | null;
  isSystem: boolean;
};

export type EngineInput = {
  clientOrgId: string;
  bankTransaction: {
    id: string;
    transactionDate: Date;
    amountMinor: bigint;
    currency: string;
    description: string;
  };
  extraction: {
    vendorName: string | null;
    vendorGstin: string | null;
    invoiceNumber: string | null;
    invoiceDate: Date | null;
    baseAmountMinor: bigint | null;
    cgstAmountMinor: bigint | null;
    sgstAmountMinor: bigint | null;
    igstAmountMinor: bigint | null;
    totalAmountMinor: bigint | null;
    currency: string;
  };
  taxRegime: 'GST_INDIA' | 'VAT_EU' | 'GST_HST_CANADA';
  chartOfAccounts: ChartOfAccount[];
};

export type JournalEntryRow = {
  transactionId: string;
  entryDate: Date;
  period: string;
  accountCode: string;
  accountName: string;
  drCr: 'DR' | 'CR';
  amountMinor: bigint;
  currency: string;
  narration: string;
  partyName: string | null;
  partyTaxNumber: string | null;
  invoiceRef: string | null;
  taxAmountMinor: bigint | null;
  taxRate: number | null;
  matchStatus: 'matched' | 'unmatched' | 'flagged';
  documentId: string | null;
};

function validateBalance(entries: JournalEntryRow[]): void {
  const totalDebits = entries
    .filter((e) => e.drCr === 'DR')
    .reduce((sum, e) => sum + e.amountMinor, 0n);
  const totalCredits = entries
    .filter((e) => e.drCr === 'CR')
    .reduce((sum, e) => sum + e.amountMinor, 0n);

  if (totalDebits !== totalCredits) {
    throw new Error('UNBALANCED_ENTRY');
  }
}

export async function createJournalEntries(_input: EngineInput): Promise<JournalEntryRow[]> {
  // Stub — full implementation comes in Phase 4
  const entries: JournalEntryRow[] = [];
  validateBalance(entries);
  return entries;
}
