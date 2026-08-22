/**
 * Unit tests for AES-256-GCM token helpers.
 *
 *   node --import tsx --test src/lib/encryption/tokens.test.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";

process.env.TOKEN_ENCRYPTION_KEY = "  " + "ab".repeat(32) + "  ";

const { decryptToken, encryptToken } = await import("./tokens");

test("round-trips plaintext", () => {
  const secret = "ya29.access-token-example";
  assert.equal(decryptToken(encryptToken(secret)), secret);
});

test("trims whitespace on TOKEN_ENCRYPTION_KEY", () => {
  const secret = "refresh-token";
  assert.equal(decryptToken(encryptToken(secret)), secret);
});

test("rejects tampered ciphertext", () => {
  const payload = encryptToken("hello");
  const [iv, tag, data] = payload.split(".");
  const buf = Buffer.from(data, "base64");
  buf[0] = buf[0] ^ 0xff;
  const tampered = `${iv}.${tag}.${buf.toString("base64")}`;
  assert.throws(() => decryptToken(tampered));
});

test("rejects malformed payload", () => {
  assert.throws(() => decryptToken("not-a-token"));
});
