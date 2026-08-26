/**
 *   node --import tsx --test src/lib/payee-memory/fingerprint.test.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { fingerprintPayee, titleCasePayee } from "./fingerprint";
import { memoryFromAnswer, memoryOmitsPayee } from "./types";

test("same name with UPI/IMPS noise maps to the same key", () => {
  const a = fingerprintPayee("UPI/RAJESH KUMAR/111");
  const b = fingerprintPayee("IMPS/RAJESH KUMAR/222");
  const c = fingerprintPayee("NEFT/RAJESH KUMAR");
  assert.equal(a, "RAJESH KUMAR");
  assert.equal(a, b);
  assert.equal(a, c);
});

test("strips payment-app tokens when a name remains", () => {
  assert.equal(fingerprintPayee("UPI/PAYTM/RAJESH KUMAR"), "RAJESH KUMAR");
});

test("UPI handle uses local part", () => {
  assert.equal(fingerprintPayee("UPI/rajesh.kumar@okaxis"), "RAJESH KUMAR");
});

test("merchant strings keep the brand", () => {
  assert.equal(fingerprintPayee("AMAZON WEB SERVICES"), "AMAZON WEB SERVICES");
  assert.match(fingerprintPayee("SPOTIFY PVT LTD 199"), /SPOTIFY/);
});

test("titleCasePayee is human-readable", () => {
  assert.equal(titleCasePayee("RAJESH KUMAR"), "Rajesh Kumar");
});

test("memoryFromAnswer maps buttons to policy", () => {
  assert.deepEqual(memoryFromAnswer("landlord"), {
    relationship: "landlord",
    invoicePolicy: "always",
  });
  assert.deepEqual(memoryFromAnswer("supplier"), {
    relationship: "vendor",
    invoicePolicy: "always",
  });
  assert.deepEqual(memoryFromAnswer("family"), {
    relationship: "family",
    invoicePolicy: "never",
  });
  assert.deepEqual(memoryFromAnswer("self"), {
    relationship: "self",
    invoicePolicy: "never",
  });
});

test("family/self/never omit future questions and Gmail", () => {
  assert.equal(
    memoryOmitsPayee({
      payeeKey: "RAJESH KUMAR",
      displayName: "Rajesh Kumar",
      relationship: "family",
      invoicePolicy: "never",
      source: "clarification",
    }),
    true,
  );
});
