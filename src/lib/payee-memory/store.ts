import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { payeeMemory } from "@/db/schema/muneem";
import type {
  InvoicePolicy,
  PayeeMemoryRecord,
  PayeeMemorySource,
  PayeeRelationship,
} from "./types";

export async function getPayeeMemory(
  clientOrgId: string,
  payeeKey: string,
): Promise<PayeeMemoryRecord | null> {
  const row = await db.query.payeeMemory.findFirst({
    where: and(
      eq(payeeMemory.clientOrgId, clientOrgId),
      eq(payeeMemory.payeeKey, payeeKey),
    ),
  });
  if (!row) return null;
  return {
    payeeKey: row.payeeKey,
    displayName: row.displayName,
    relationship: row.relationship,
    invoicePolicy: row.invoicePolicy,
    source: row.source,
  };
}

export async function listPayeeMemory(
  clientOrgId: string,
): Promise<PayeeMemoryRecord[]> {
  const rows = await db.query.payeeMemory.findMany({
    where: eq(payeeMemory.clientOrgId, clientOrgId),
  });
  return rows.map((row) => ({
    payeeKey: row.payeeKey,
    displayName: row.displayName,
    relationship: row.relationship,
    invoicePolicy: row.invoicePolicy,
    source: row.source,
  }));
}

export async function upsertPayeeMemory(input: {
  clientOrgId: string;
  payeeKey: string;
  displayName: string;
  relationship: PayeeRelationship;
  invoicePolicy: InvoicePolicy;
  source: PayeeMemorySource;
}): Promise<void> {
  const now = new Date();
  await db
    .insert(payeeMemory)
    .values({
      clientOrgId: input.clientOrgId,
      payeeKey: input.payeeKey,
      displayName: input.displayName,
      relationship: input.relationship,
      invoicePolicy: input.invoicePolicy,
      source: input.source,
      confirmedAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [payeeMemory.clientOrgId, payeeMemory.payeeKey],
      set: {
        displayName: input.displayName,
        relationship: input.relationship,
        invoicePolicy: input.invoicePolicy,
        source: input.source,
        confirmedAt: now,
        updatedAt: now,
      },
    });
}
