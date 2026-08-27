/**
 *   node --import tsx --test src/lib/statement-parser/pdf-vision-parser.test.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  extractScannedPageWithVision,
  setPdfVisionClientForTests,
  PDF_VISION_MODEL,
} from "./pdf-vision-parser";

test.afterEach(() => {
  setPdfVisionClientForTests(undefined);
});

test("vision call uses gpt-4o, image_url, detail high — never mini", async () => {
  let captured: unknown;
  setPdfVisionClientForTests({
    chat: {
      completions: {
        create: async (body: unknown) => {
          captured = body;
          return {
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    currency: "INR",
                    transactions: [
                      {
                        date: "2026-04-03",
                        description: "UPI",
                        debit: null,
                        credit: 25,
                        balance: 125,
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

  const result = await extractScannedPageWithVision(2, "AAAA");
  assert.equal(result.transactions.length, 1);
  const body = captured as {
    model: string;
    messages: Array<{
      role: string;
      content: unknown;
    }>;
  };
  assert.equal(body.model, "gpt-4o");
  assert.equal(PDF_VISION_MODEL, "gpt-4o");
  assert.notEqual(body.model, "gpt-4o-mini");
  const user = body.messages.find((m) => m.role === "user");
  assert.ok(Array.isArray(user?.content));
  const parts = user?.content as Array<{
    type: string;
    image_url?: { url: string; detail: string };
  }>;
  const image = parts.find((p) => p.type === "image_url");
  assert.ok(image);
  assert.equal(image?.image_url?.detail, "high");
  assert.ok(image?.image_url?.url.startsWith("data:image/jpeg;base64,"));
  assert.ok(image?.image_url?.url.endsWith("AAAA"));
});
