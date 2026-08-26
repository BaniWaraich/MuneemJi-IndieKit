/**
 *   node --import tsx --test src/lib/gmail/attachments.test.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildGmailInvoiceQuery, findPdfAttachments } from "./attachments";

test("buildGmailInvoiceQuery includes name and date window", () => {
  const q = buildGmailInvoiceQuery({
    displayName: "Spotify",
    periodStart: "2026-02-01",
    periodEnd: "2026-02-28",
  });
  assert.match(q, /filename:pdf "Spotify"/);
  assert.match(q, /after:2026\/01\/25/);
  assert.match(q, /before:2026\/03\/08/);
});

test("findPdfAttachments walks nested parts", () => {
  const found = findPdfAttachments({
    payload: {
      parts: [
        {
          mimeType: "multipart/mixed",
          parts: [
            {
              filename: "invoice.pdf",
              mimeType: "application/pdf",
              body: { attachmentId: "att-1" },
            },
          ],
        },
      ],
    },
  });
  assert.equal(found.length, 1);
  assert.equal(found[0]?.attachmentId, "att-1");
});
