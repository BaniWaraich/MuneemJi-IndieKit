/**
 *   node --import tsx --test src/lib/statement-parser/classify-page-contract.test.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  parseExtractedPages,
  fallbackKindFromText,
  shouldSalvagePage,
  salvagePageNumbers,
  scannedPageNumbers,
  assertVisionPageCap,
  VisionPageCapError,
  VISION_PAGE_CAP,
} from "./extracted-pages";
import type { ExtractedPage } from "./page-schema";

test("kind absent and sparse text -> scanned (deploy-skew fallback)", () => {
  assert.equal(fallbackKindFromText(""), "scanned");
  assert.equal(fallbackKindFromText("HDFC Bank Page 1"), "scanned");
  const pages = parseExtractedPages(
    JSON.stringify({ pages: [{ page: 1, text: "scan" }] }),
  );
  assert.equal(pages[0].kind, "scanned");
});

test("kind absent and dense text -> text", () => {
  const dense = "A".repeat(80);
  assert.equal(fallbackKindFromText(dense), "text");
  const pages = parseExtractedPages(
    JSON.stringify({ pages: [{ page: 1, text: dense }] }),
  );
  assert.equal(pages[0].kind, "text");
});

test("sandbox kind wins over text density", () => {
  const pages = parseExtractedPages(
    JSON.stringify({
      pages: [
        {
          page: 1,
          text: "A".repeat(80),
          kind: "scanned",
          signals: {
            char_count: 80,
            alnum_count: 80,
            word_count: 1,
            image_area_ratio: 0.9,
          },
        },
      ],
    }),
  );
  assert.equal(pages[0].kind, "scanned");
});

test("salvage when text page extracted zero txs and image ratio >= 0.25", () => {
  const page: ExtractedPage = {
    page: 2,
    text: "header",
    kind: "text",
    signals: {
      char_count: 10,
      alnum_count: 10,
      word_count: 1,
      image_area_ratio: 0.25,
    },
  };
  assert.equal(shouldSalvagePage(page, 0), true);
  assert.equal(shouldSalvagePage(page, 3), false);
  assert.equal(
    shouldSalvagePage(
      { ...page, signals: { ...page.signals, image_area_ratio: 0.24 } },
      0,
    ),
    false,
  );
  assert.deepEqual(salvagePageNumbers([page], new Map([[2, 0]])), [2]);
});

test("scannedPageNumbers ignores blank and text", () => {
  const pages: ExtractedPage[] = [
    {
      page: 1,
      text: "",
      kind: "blank",
      signals: {
        char_count: 0,
        alnum_count: 0,
        word_count: 0,
        image_area_ratio: 0,
      },
    },
    {
      page: 2,
      text: "",
      kind: "scanned",
      signals: {
        char_count: 0,
        alnum_count: 0,
        word_count: 0,
        image_area_ratio: 1,
      },
    },
    {
      page: 3,
      text: "table",
      kind: "text",
      signals: {
        char_count: 200,
        alnum_count: 200,
        word_count: 40,
        image_area_ratio: 0,
      },
    },
  ];
  assert.deepEqual(scannedPageNumbers(pages), [2]);
});

test("vision cap throws VisionPageCapError above 40", () => {
  assert.doesNotThrow(() => assertVisionPageCap(VISION_PAGE_CAP));
  assert.throws(
    () => assertVisionPageCap(VISION_PAGE_CAP + 1),
    VisionPageCapError,
  );
  try {
    assertVisionPageCap(41);
  } catch (err) {
    assert.equal((err as Error).name, "VisionPageCapError");
    assert.match((err as Error).message, /VisionPageCapError/);
  }
});
