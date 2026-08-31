/**
 *   node --import tsx --test src/lib/statement-interpretation/needs-invoice-guard.test.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { enforceUnknownDebitNeedsInvoice } from "./needs-invoice-guard";

test("unknown debit forces needs_invoice even when LLM said false", () => {
  assert.equal(
    enforceUnknownDebitNeedsInvoice({
      category: "unknown",
      needsInvoice: false,
      debitMinor: 3_000_000n,
    }),
    true,
  );
});

test("unknown credit keeps LLM needs_invoice", () => {
  assert.equal(
    enforceUnknownDebitNeedsInvoice({
      category: "unknown",
      needsInvoice: false,
      debitMinor: 0n,
    }),
    false,
  );
});

test("tax_payment debit keeps LLM needs_invoice (O04 excludes category)", () => {
  assert.equal(
    enforceUnknownDebitNeedsInvoice({
      category: "tax_payment",
      needsInvoice: true,
      debitMinor: 2200n,
    }),
    true,
  );
  assert.equal(
    enforceUnknownDebitNeedsInvoice({
      category: "tax_payment",
      needsInvoice: false,
      debitMinor: 2200n,
    }),
    false,
  );
});

test("vendor_payment debit keeps LLM false if model said so", () => {
  assert.equal(
    enforceUnknownDebitNeedsInvoice({
      category: "vendor_payment",
      needsInvoice: false,
      debitMinor: 900_000n,
    }),
    false,
  );
});
