export type BankTxLike = {
  id: string;
  description: string;
  amountMinor: bigint;
  transactionDate: string;
  needsInvoice: boolean;
  category: string | null;
  matchStatus: string;
  interpretationConfidence: string | null;
};

export type ClassifiedKind =
  | "omit"
  | "high_confidence"
  | "clarification"
  | "to_collect"
  | "to_collect_no_gmail";

export type ClassifiedCluster = {
  payeeKey: string;
  displayName: string;
  amountMinor: bigint;
  occurrenceCount: number;
  transactionIds: string[];
  sampleAmountsMinor: bigint[];
  kind: ClassifiedKind;
  source: "high_confidence" | "user_confirmed" | "clarified";
  gmailEligible: boolean;
  status: "to_collect" | "not_needed" | "awaiting_clarification";
};

const EXCLUDE_CATEGORIES = new Set([
  "bank_charge",
  "salary",
  "inter_account_transfer",
  "loan_emi",
  "tax_payment",
  "owner_drawing",
]);

export function isDebit(amountMinor: bigint): boolean {
  return amountMinor < 0n;
}

export function parseConfidence(raw: string | null): number {
  if (!raw) return 0;
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

export function shouldIncludeTransaction(
  tx: BankTxLike,
  alwaysCollect: boolean,
): boolean {
  if (!isDebit(tx.amountMinor)) return false;
  if (alwaysCollect) return true;
  if (tx.matchStatus === "out_of_scope") return false;
  if (tx.category && EXCLUDE_CATEGORIES.has(tx.category)) return false;
  return tx.needsInvoice || isHighConfidenceVendor(tx);
}

export function isHighConfidenceVendor(tx: BankTxLike): boolean {
  return (
    tx.category === "vendor_payment" &&
    parseConfidence(tx.interpretationConfidence) >= 0.8
  );
}

export function isGmailEligible(input: {
  status: string;
  invoicePolicy?: string | null;
}): boolean {
  if (input.status !== "to_collect") return false;
  if (input.invoicePolicy === "never") return false;
  return true;
}
