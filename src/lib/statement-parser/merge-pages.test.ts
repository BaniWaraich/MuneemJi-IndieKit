/**
 *   node --import tsx --test src/lib/statement-parser/merge-pages.test.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  combinePageResults,
  mergePdfPageResults,
  PdfMergeError,
} from "./pdf-page-merge";
import { computeExtractionConfidence } from "./render-markdown-kv";
import type { NumberedPageResult } from "./page-schema";

const p1: NumberedPageResult = {
  page: 1,
  currency: "INR",
  transactions: [
    {
      date: "2026-04-02",
      description: "NEFT A",
      debit: 10,
      credit: null,
      balance: 90,
    },
  ],
};

const p2: NumberedPageResult = {
  page: 2,
  currency: null,
  transactions: [
    {
      date: "2026-04-03",
      description: "UPI B",
      debit: null,
      credit: 25,
      balance: 115,
    },
  ],
};

test("mixed text+vision pages merge in page order", () => {
  const combined = combinePageResults([p1], [p2]);
  assert.deepEqual(
    combined.map((p) => p.page),
    [1, 2],
  );
  const merged = mergePdfPageResults(combined);
  assert.equal(merged.transactions.length, 2);
  assert.equal(merged.transactions[0].date, "2026-04-02");
  assert.equal(merged.transactions[1].date, "2026-04-03");
  assert.equal(merged.opening_balance, 100);
  assert.equal(merged.closing_balance, 115);
});

test("vision overwrites salvage text page of the same number", () => {
  const weakText: NumberedPageResult = {
    page: 1,
    currency: "INR",
    transactions: [],
  };
  const vision: NumberedPageResult = {
    page: 1,
    currency: "INR",
    transactions: [
      {
        date: "2026-04-02",
        description: "from scan",
        debit: 5,
        credit: null,
        balance: 95,
      },
    ],
  };
  const combined = combinePageResults([weakText], [vision]);
  assert.equal(combined.length, 1);
  assert.equal(combined[0].transactions[0].description, "from scan");
});

test("all-blank / empty merge throws the same no-transactions error", () => {
  assert.throws(
    () => mergePdfPageResults([]),
    (err: Error) => {
      assert.equal(err.name, "PdfMergeError");
      assert.match(err.message, /no transactions extracted from any page/);
      return true;
    },
  );
  assert.throws(
    () => mergePdfPageResults([{ page: 1, currency: null, transactions: [] }]),
    PdfMergeError,
  );
});

test("vision confidence base 0.65 minus unknown bank is 0.55", () => {
  assert.equal(
    computeExtractionConfidence({
      path: "pdf_vision",
      bankIdentified: false,
    }).toFixed(2),
    "0.55",
  );
  assert.equal(
    computeExtractionConfidence({
      path: "pdfplumber_new_first_try",
      bankIdentified: false,
    }).toFixed(2),
    "0.70",
  );
});
