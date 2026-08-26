/**
 *   node --import tsx --test src/lib/invoice-checklist/classify.test.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { fingerprintPayee } from "@/lib/payee-memory/fingerprint";
import { isPersonNameTransfer } from "./clarification";
import { classifyStatementPayees, isGmailEligibleForCluster } from "./classify";
import { matchMerchant } from "./merchants";
import { isGmailEligible, type BankTxLike } from "./types";

function tx(
  partial: Partial<BankTxLike> & Pick<BankTxLike, "id" | "description">,
): BankTxLike {
  return {
    amountMinor: -199900n,
    transactionDate: "2026-02-10",
    needsInvoice: true,
    category: "unknown",
    matchStatus: "unmatched",
    interpretationConfidence: "0.40",
    ...partial,
  };
}

test("clustering: 3 lines same payee → 1 checklist item", () => {
  const result = classifyStatementPayees({
    memory: [],
    transactions: [
      tx({
        id: "1",
        description: "UPI/RAJESH KUMAR/111",
        amountMinor: -2500000n,
      }),
      tx({
        id: "2",
        description: "IMPS/RAJESH KUMAR/222",
        amountMinor: -2500000n,
      }),
      tx({ id: "3", description: "NEFT/RAJESH KUMAR", amountMinor: -2500000n }),
    ],
  });
  assert.equal(result.length, 1);
  assert.equal(result[0]?.payeeKey, fingerprintPayee("UPI/RAJESH KUMAR/111"));
  assert.equal(result[0]?.occurrenceCount, 3);
  assert.equal(result[0]?.amountMinor, 7500000n);
  assert.equal(result[0]?.kind, "clarification");
  assert.equal(result[0]?.gmailEligible, false);
});

test("clarification detection: person-name IMPS vs AWS", () => {
  assert.equal(
    isPersonNameTransfer(
      "IMPS/RAJESH KUMAR/99",
      fingerprintPayee("IMPS/RAJESH KUMAR/99"),
      false,
    ),
    true,
  );
  const awsKey = fingerprintPayee("AMAZON WEB SERVICES");
  assert.ok(matchMerchant(awsKey));
  assert.equal(
    isPersonNameTransfer("AMAZON WEB SERVICES", awsKey, true),
    false,
  );
});

test("high-confidence subscriptions appear without a question", () => {
  const result = classifyStatementPayees({
    memory: [],
    transactions: [
      tx({
        id: "s",
        description: "SPOTIFY PVT LTD",
        amountMinor: -11900n,
        category: "vendor_payment",
        interpretationConfidence: "0.90",
      }),
      tx({
        id: "c",
        description: "ANTHROPIC CLAUDE SUBSCRIPTION",
        amountMinor: -199900n,
      }),
    ],
  });
  assert.equal(result.length, 2);
  assert.ok(result.every((r) => r.kind === "high_confidence"));
  assert.ok(result.every((r) => r.gmailEligible));
  assert.ok(result.some((r) => r.displayName === "Spotify"));
  assert.ok(result.some((r) => r.displayName === "Claude"));
});

test("credits are excluded", () => {
  const result = classifyStatementPayees({
    memory: [],
    transactions: [
      tx({
        id: "in",
        description: "NEFT FROM CUSTOMER",
        amountMinor: 500000n,
        needsInvoice: false,
        category: "customer_receipt",
      }),
    ],
  });
  assert.equal(result.length, 0);
});

test("checklist gating: awaiting clarification is not Gmail eligible", () => {
  assert.equal(isGmailEligible({ status: "awaiting_clarification" }), false);
  assert.equal(isGmailEligible({ status: "to_collect" }), true);
  assert.equal(
    isGmailEligible({ status: "to_collect", invoicePolicy: "never" }),
    false,
  );
});

test("memory: after relationship=family, fingerprint skips clarification", () => {
  const key = fingerprintPayee("UPI/RAJESH KUMAR/1");
  const result = classifyStatementPayees({
    memory: [
      {
        payeeKey: key,
        displayName: "Rajesh Kumar",
        relationship: "family",
        invoicePolicy: "never",
        source: "clarification",
      },
    ],
    transactions: [
      tx({
        id: "1",
        description: "UPI/RAJESH KUMAR/1",
        amountMinor: -2500000n,
      }),
    ],
  });
  assert.equal(result.length, 0);
});

test("cap 5 clarifications; extras stay on list without Gmail", () => {
  const names = [
    "RAJESH KUMAR",
    "AMIT SHARMA",
    "PRIYA SINGH",
    "VIKAS PATEL",
    "NEHA GUPTA",
    "ANIL MEHTA",
    "KIRAN JOSHI",
  ];
  const txs: BankTxLike[] = names.map((name, i) =>
    tx({
      id: String(i),
      description: `IMPS/${name}/99`,
      amountMinor: BigInt(-(i + 1) * 100000),
    }),
  );
  const result = classifyStatementPayees({ memory: [], transactions: txs });
  const questions = result.filter((r) => r.kind === "clarification");
  const extras = result.filter((r) => r.kind === "to_collect_no_gmail");
  assert.equal(questions.length, 5);
  assert.equal(extras.length, 2);
  assert.ok(extras.every((e) => !isGmailEligibleForCluster(e)));
});
