import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { bankStatements, clientOrgs, documents } from "@/db/schema/muneem";

/** Shared firm budget across bank statements and invoice documents. */
export const MAX_FIRM_STORAGE_BYTES = 500 * 1024 * 1024; // 500 MiB

/**
 * Sum of `bank_statements.file_size_bytes` + `documents.file_size_bytes`
 * for every client org belonging to the firm. Pending/orphan rows count.
 */
export async function getFirmStorageBytes(firmId: string): Promise<bigint> {
  const [statementRow] = await db
    .select({
      total: sql<string>`coalesce(sum(${bankStatements.fileSizeBytes}), 0)`,
    })
    .from(bankStatements)
    .innerJoin(clientOrgs, eq(bankStatements.clientOrgId, clientOrgs.id))
    .where(eq(clientOrgs.firmId, firmId));

  const [documentRow] = await db
    .select({
      total: sql<string>`coalesce(sum(${documents.fileSizeBytes}), 0)`,
    })
    .from(documents)
    .innerJoin(clientOrgs, eq(documents.clientOrgId, clientOrgs.id))
    .where(eq(clientOrgs.firmId, firmId));

  return BigInt(statementRow?.total ?? 0) + BigInt(documentRow?.total ?? 0);
}
