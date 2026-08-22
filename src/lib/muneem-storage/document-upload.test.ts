/**
 * Unit tests for D04 document-upload helpers.
 *
 *   node --import tsx --test src/lib/muneem-storage/document-upload.test.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  MAX_DOCUMENT_BYTES,
  documentS3Key,
  fileTypeFromContentType,
  isAllowedDocumentContentType,
  sanitiseFilename,
} from "./document-upload";
import { createDocumentSchema } from "@/lib/validations/documents.schema";

test("allows PDF, common images, HEIC/HEIF, and octet-stream", () => {
  for (const mime of [
    "application/pdf",
    "image/png",
    "image/jpeg",
    "image/webp",
    "image/heic",
    "image/heif",
    "application/octet-stream",
  ]) {
    assert.equal(isAllowedDocumentContentType(mime), true, mime);
  }
});

test("rejects CSV and Office MIME types", () => {
  assert.equal(isAllowedDocumentContentType("text/csv"), false);
  assert.equal(
    isAllowedDocumentContentType(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ),
    false,
  );
});

test("fileType is pdf only for application/pdf", () => {
  assert.equal(fileTypeFromContentType("application/pdf"), "pdf");
  assert.equal(fileTypeFromContentType("image/png"), "image");
  assert.equal(fileTypeFromContentType("image/heic"), "image");
  assert.equal(fileTypeFromContentType("application/octet-stream"), "image");
});

test("sanitiseFilename keeps basename and strips path separators", () => {
  assert.equal(sanitiseFilename("invoice.pdf"), "invoice.pdf");
  assert.equal(sanitiseFilename("../../etc/passwd"), "passwd");
  assert.equal(sanitiseFilename("folder\\nested\\bill.png"), "bill.png");
});

test("sanitiseFilename caps the filename segment at 180 chars", () => {
  const long = `${"a".repeat(200)}.pdf`;
  assert.equal(sanitiseFilename(long).length, 180);
});

test("documentS3Key uses documents/{clientOrgId}/ prefix", () => {
  const key = documentS3Key("org-1", "inv.pdf");
  assert.match(key, /^documents\/org-1\/\d+-[0-9a-f]{16}-inv\.pdf$/);
});

test("create schema rejects fileSizeBytes above 25_000_000", () => {
  const over = createDocumentSchema.safeParse({
    filename: "big.pdf",
    contentType: "application/pdf",
    fileSizeBytes: 26_000_000,
  });
  assert.equal(over.success, false);

  const ok = createDocumentSchema.safeParse({
    filename: "ok.pdf",
    contentType: "application/pdf",
    fileSizeBytes: MAX_DOCUMENT_BYTES,
  });
  assert.equal(ok.success, true);
});
