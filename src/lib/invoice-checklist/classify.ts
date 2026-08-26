import {
  fingerprintPayee,
  titleCasePayee,
} from "@/lib/payee-memory/fingerprint";
import {
  memoryOmitsPayee,
  type PayeeMemoryRecord,
} from "@/lib/payee-memory/types";
import { isPersonNameTransfer } from "./clarification";
import { matchMerchant } from "./merchants";
import {
  isHighConfidenceVendor,
  shouldIncludeTransaction,
  type BankTxLike,
  type ClassifiedCluster,
} from "./types";

export const MAX_CLARIFICATIONS = 5;

type RawCluster = {
  payeeKey: string;
  txs: BankTxLike[];
};

function periodFromDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-IN", {
    month: "short",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  }).format(d);
}

export function periodLabelFromTxs(txs: BankTxLike[]): string {
  const first = txs[0]?.transactionDate;
  return first ? periodFromDate(first) : "";
}

export function periodLabelFromIso(iso: string | null | undefined): string {
  return iso ? periodFromDate(iso) : "";
}

function debitMagnitude(amountMinor: bigint): bigint {
  return amountMinor < 0n ? -amountMinor : amountMinor;
}

function memoryByKey(
  rows: PayeeMemoryRecord[],
): Map<string, PayeeMemoryRecord> {
  return new Map(rows.map((r) => [r.payeeKey, r]));
}

function clusterTransactions(txs: BankTxLike[]): RawCluster[] {
  const map = new Map<string, BankTxLike[]>();
  for (const tx of txs) {
    const key = fingerprintPayee(tx.description);
    const list = map.get(key);
    if (list) list.push(tx);
    else map.set(key, [tx]);
  }
  return [...map.entries()].map(([payeeKey, clustered]) => ({
    payeeKey,
    txs: clustered,
  }));
}

function toDraft(
  raw: RawCluster,
  memory: PayeeMemoryRecord | undefined,
): ClassifiedCluster | null {
  const merchant = matchMerchant(raw.payeeKey);
  const always = memory?.invoicePolicy === "always";
  const included = raw.txs.filter((tx) => shouldIncludeTransaction(tx, always));
  if (included.length === 0) return null;

  if (memoryOmitsPayee(memory)) return null;

  const magnitudes = included.map((t) => debitMagnitude(t.amountMinor));
  const amountMinor = magnitudes.reduce((a, b) => a + b, 0n);
  const displayName =
    memory?.displayName ??
    merchant?.displayName ??
    titleCasePayee(raw.payeeKey);
  const sampleAmountsMinor = [...magnitudes].sort((a, b) =>
    a > b ? -1 : a < b ? 1 : 0,
  );

  const highConf =
    Boolean(merchant) ||
    always ||
    included.some((tx) => isHighConfidenceVendor(tx));

  const person = included.some((tx) =>
    isPersonNameTransfer(tx.description, raw.payeeKey, Boolean(merchant)),
  );

  const base = {
    payeeKey: raw.payeeKey,
    displayName,
    amountMinor,
    occurrenceCount: included.length,
    transactionIds: included.map((t) => t.id),
    sampleAmountsMinor,
  };

  if (always) {
    return {
      ...base,
      kind: "high_confidence",
      source: "user_confirmed",
      gmailEligible: true,
      status: "to_collect",
    };
  }

  if (highConf) {
    return {
      ...base,
      kind: "high_confidence",
      source: "high_confidence",
      gmailEligible: true,
      status: "to_collect",
    };
  }

  if (person) {
    return {
      ...base,
      kind: "clarification",
      source: "high_confidence",
      gmailEligible: false,
      status: "awaiting_clarification",
    };
  }

  return {
    ...base,
    kind: "to_collect",
    source: "high_confidence",
    gmailEligible: true,
    status: "to_collect",
  };
}

/**
 * Cluster debit txs and split into list / questions / omit.
 * Cap 5 clarifications by amount descending; extras stay on the list without Gmail.
 */
export function classifyStatementPayees(input: {
  transactions: BankTxLike[];
  memory: PayeeMemoryRecord[];
}): ClassifiedCluster[] {
  const mem = memoryByKey(input.memory);
  const drafts: ClassifiedCluster[] = [];
  for (const raw of clusterTransactions(input.transactions)) {
    const draft = toDraft(raw, mem.get(raw.payeeKey));
    if (draft) drafts.push(draft);
  }

  const candidates = drafts
    .filter((d) => d.kind === "clarification")
    .sort((a, b) => (a.amountMinor > b.amountMinor ? -1 : 1));
  const keep = new Set(
    candidates.slice(0, MAX_CLARIFICATIONS).map((d) => d.payeeKey),
  );

  return drafts.map((d) => {
    if (d.kind !== "clarification") return d;
    if (keep.has(d.payeeKey)) return d;
    return {
      ...d,
      kind: "to_collect_no_gmail",
      status: "to_collect",
      gmailEligible: false,
    };
  });
}

export function isGmailEligibleForCluster(cluster: ClassifiedCluster): boolean {
  return cluster.status === "to_collect" && cluster.gmailEligible;
}

export function buildClarificationPrompt(input: {
  displayName: string;
  typicalAmountLabel: string;
  occurrenceCount: number;
  periodLabel: string;
}): string {
  const times =
    input.occurrenceCount > 1
      ? ` (${input.occurrenceCount} times in ${input.periodLabel})`
      : ` in ${input.periodLabel}`;
  return `You paid ${input.displayName} ${input.typicalAmountLabel}${times}. What was this?`;
}
