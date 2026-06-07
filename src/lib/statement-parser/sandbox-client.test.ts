/**
 * Regression test for the encrypted-PDF 422 mapping in sandbox-client.
 *
 * Runs on Node's built-in test runner via tsx (the repo has no Vitest/Jest):
 *   node --import tsx --test src/lib/statement-parser/sandbox-client.test.ts
 *
 * The sandbox parks an encrypted PDF behind HTTP 422; extractPdfPages must
 * translate that into the typed EncryptedPdfError / WrongPdfPasswordError so the
 * D02 Inngest function can route the statement to `password_required` instead of
 * `failed`. The stable discriminator is the `error` value — these cases assert
 * the mapping fires even when the redundant `requiresPassword` flag is absent,
 * which is exactly the version-skew that produced "returned 422: encrypted".
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  extractPdfPages,
  EncryptedPdfError,
  WrongPdfPasswordError,
  SandboxError,
} from "./sandbox-client";

type MockBody = Record<string, unknown>;

/** Stub global.fetch with a single 422 response carrying `body`. */
function stubFetch(status: number, body: MockBody) {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  })) as unknown as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

const PDF = Buffer.from("%PDF-1.4 fake");

test("422 error:encrypted (no requiresPassword) -> EncryptedPdfError", async () => {
  const restore = stubFetch(422, { error: "encrypted" });
  try {
    await assert.rejects(extractPdfPages(PDF), EncryptedPdfError);
  } finally {
    restore();
  }
});

test("422 error:wrong_password (no requiresPassword) -> WrongPdfPasswordError", async () => {
  const restore = stubFetch(422, { error: "wrong_password" });
  try {
    await assert.rejects(extractPdfPages(PDF, "nope"), WrongPdfPasswordError);
  } finally {
    restore();
  }
});

test("422 with requiresPassword:true still maps (backwards-compat)", async () => {
  const restore = stubFetch(422, {
    error: "encrypted",
    requiresPassword: true,
  });
  try {
    await assert.rejects(extractPdfPages(PDF), EncryptedPdfError);
  } finally {
    restore();
  }
});

test("non-encryption error stays a generic SandboxError", async () => {
  const restore = stubFetch(500, { error: "boom" });
  try {
    await assert.rejects(extractPdfPages(PDF), SandboxError);
  } finally {
    restore();
  }
});
