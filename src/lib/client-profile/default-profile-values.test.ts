/**
 *   node --import tsx --test src/lib/client-profile/default-profile-values.test.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultClientProfileValues } from "./default-profile-values";

test("defaultClientProfileValues uses seed industry and description", () => {
  const v = defaultClientProfileValues({
    industry: "Textile trading",
    description: "Panipat yarn trader",
  });
  assert.equal(v.industry, "Textile trading");
  assert.equal(v.description, "Panipat yarn trader");
  assert.equal(v.legalStructure, "sole_proprietorship");
  assert.equal(v.gstRegistrationType, "unregistered");
  assert.deepEqual(v.bankAccounts, []);
});

test("defaultClientProfileValues caps industry at 100 chars", () => {
  const v = defaultClientProfileValues({ industry: "x".repeat(120) });
  assert.equal(v.industry.length, 100);
});
