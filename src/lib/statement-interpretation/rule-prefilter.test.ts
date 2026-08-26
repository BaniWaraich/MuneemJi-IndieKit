/**
 *   node --import tsx --test src/lib/statement-interpretation/rule-prefilter.test.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { fingerprintPayee } from "@/lib/payee-memory/fingerprint";
import type { PayeeMemoryRecord } from "@/lib/payee-memory/types";
import type { Phase1Transaction } from "./parse-markdown-kv";
import { runRulePrefilter, type RulePrefilterContext } from "./rule-prefilter";

function tx(
  index: number,
  description: string,
  debit = 50_000n,
): Phase1Transaction {
  return {
    transaction_index: index,
    date: "2026-02-10",
    description,
    debit_minor: debit,
    credit_minor: 0n,
    balance_minor: 0n,
  };
}

const emptyCtx: RulePrefilterContext = {
  ownAccountLast4: null,
  bankAccounts: [],
  knownVendors: [],
  knownCustomers: [],
  activeLoans: [],
  ownerDrawingsPattern: null,
};

function memory(
  description: string,
  partial: Pick<PayeeMemoryRecord, "relationship" | "invoicePolicy">,
): PayeeMemoryRecord {
  return {
    payeeKey: fingerprintPayee(description),
    displayName: "Remembered payee",
    source: "clarification",
    ...partial,
  };
}

test("payee memory: family → owner drawing, no invoice", () => {
  const description = "IMPS RAJESH KUMAR";
  const result = runRulePrefilter([tx(0, description)], {
    ...emptyCtx,
    payeeMemory: [
      memory(description, { relationship: "family", invoicePolicy: "never" }),
    ],
  });
  const match = result.matches.get(0);
  assert.equal(result.unmatched.length, 0);
  assert.equal(match?.category, "owner_drawing");
  assert.equal(match?.needs_invoice, false);
  assert.equal(match?.method, "rule_owner_drawing");
});

test("payee memory: self → inter-account transfer", () => {
  const description = "NEFT OWN SAVINGS";
  const result = runRulePrefilter([tx(0, description)], {
    ...emptyCtx,
    payeeMemory: [
      memory(description, { relationship: "self", invoicePolicy: "never" }),
    ],
  });
  const match = result.matches.get(0);
  assert.equal(match?.category, "inter_account_transfer");
  assert.equal(match?.needs_invoice, false);
});

test("payee memory: never vendor → vendor_payment without invoice", () => {
  const description = "UPI COFFEE SHOP";
  const result = runRulePrefilter([tx(0, description)], {
    ...emptyCtx,
    payeeMemory: [
      memory(description, { relationship: "vendor", invoicePolicy: "never" }),
    ],
  });
  const match = result.matches.get(0);
  assert.equal(match?.category, "vendor_payment");
  assert.equal(match?.needs_invoice, false);
});

test("payee memory: always does not prefilter (O04 still collects)", () => {
  const description = "UPI SPOTIFY";
  const result = runRulePrefilter([tx(0, description)], {
    ...emptyCtx,
    payeeMemory: [
      memory(description, { relationship: "vendor", invoicePolicy: "always" }),
    ],
  });
  assert.equal(result.matches.size, 0);
  assert.equal(result.unmatched.length, 1);
});
