/**
 *   node --import tsx --test src/lib/statement-parser/pdf-llm-parser.test.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  parseTextPagesWithLlm,
  setPdfLlmClientForTests,
  PDF_TEXT_MODEL,
} from "./pdf-llm-parser";
import type { ExtractedPage } from "./page-schema";

test.afterEach(() => {
  setPdfLlmClientForTests(undefined);
});

function page(
  partial: Partial<ExtractedPage> & Pick<ExtractedPage, "page" | "kind">,
): ExtractedPage {
  return {
    text: "NEFT row",
    signals: {
      char_count: 200,
      alnum_count: 200,
      word_count: 40,
      image_area_ratio: 0,
    },
    ...partial,
  };
}

test("parseTextPagesWithLlm skips blank and scanned (no OpenAI call)", async () => {
  let calls = 0;
  setPdfLlmClientForTests({
    chat: {
      completions: {
        create: async () => {
          calls += 1;
          return { choices: [{ message: { content: "{}" } }] };
        },
      },
    },
  });
  const out = await parseTextPagesWithLlm([
    page({ page: 1, kind: "blank" }),
    page({ page: 2, kind: "scanned" }),
  ]);
  assert.deepEqual(out, []);
  assert.equal(calls, 0);
});

test("parseTextPagesWithLlm calls gpt-4o-mini only for text pages", async () => {
  const models: string[] = [];
  setPdfLlmClientForTests({
    chat: {
      completions: {
        create: async (body: unknown) => {
          const b = body as { model: string };
          models.push(b.model);
          return {
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    currency: "INR",
                    transactions: [
                      {
                        date: "2026-04-02",
                        description: "NEFT",
                        debit: 10,
                        credit: null,
                        balance: 90,
                      },
                    ],
                  }),
                },
              },
            ],
          };
        },
      },
    },
  });
  const out = await parseTextPagesWithLlm([
    page({ page: 1, kind: "text" }),
    page({ page: 2, kind: "blank" }),
    page({ page: 3, kind: "scanned" }),
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].page, 1);
  assert.equal(out[0].transactions.length, 1);
  assert.deepEqual(models, [PDF_TEXT_MODEL]);
  assert.equal(PDF_TEXT_MODEL, "gpt-4o-mini");
});
