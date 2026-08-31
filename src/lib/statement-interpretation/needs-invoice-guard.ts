/**
 * Deterministic post-LLM guard: opaque / unknown debits must request an invoice.
 * The LLM prompt already says "when uncertain, default true", but models often
 * set needs_invoice=false on cheque/CLG narrations with category=unknown.
 */
export function enforceUnknownDebitNeedsInvoice(input: {
  category: string;
  needsInvoice: boolean;
  debitMinor: bigint;
}): boolean {
  if (input.debitMinor <= 0n) return input.needsInvoice;
  if (input.category !== "unknown") return input.needsInvoice;
  return true;
}
