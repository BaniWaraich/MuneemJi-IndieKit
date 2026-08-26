export const PAYEE_RELATIONSHIPS = [
  "vendor",
  "customer",
  "family",
  "employee",
  "self",
  "landlord",
  "unknown",
] as const;
export type PayeeRelationship = (typeof PAYEE_RELATIONSHIPS)[number];

export const INVOICE_POLICIES = ["always", "never", "ask"] as const;
export type InvoicePolicy = (typeof INVOICE_POLICIES)[number];

export const PAYEE_MEMORY_SOURCES = [
  "clarification",
  "list_edit",
  "agent_inferred",
] as const;
export type PayeeMemorySource = (typeof PAYEE_MEMORY_SOURCES)[number];

export type PayeeMemoryRecord = {
  payeeKey: string;
  displayName: string;
  relationship: PayeeRelationship;
  invoicePolicy: InvoicePolicy;
  source: PayeeMemorySource;
};

export const CLARIFICATION_ANSWERS = [
  "landlord",
  "supplier",
  "family",
  "self",
  "skip",
] as const;
export type ClarificationAnswer = (typeof CLARIFICATION_ANSWERS)[number];

export function memoryFromAnswer(
  answer: Exclude<ClarificationAnswer, "skip">,
): {
  relationship: PayeeRelationship;
  invoicePolicy: InvoicePolicy;
} {
  switch (answer) {
    case "landlord":
      return { relationship: "landlord", invoicePolicy: "always" };
    case "supplier":
      return { relationship: "vendor", invoicePolicy: "always" };
    case "family":
      return { relationship: "family", invoicePolicy: "never" };
    case "self":
      return { relationship: "self", invoicePolicy: "never" };
  }
}

/** Family / self / explicit never — no question, no Gmail. */
export function memoryOmitsPayee(
  row: PayeeMemoryRecord | null | undefined,
): boolean {
  if (!row) return false;
  if (row.invoicePolicy === "never") return true;
  return row.relationship === "family" || row.relationship === "self";
}
