import { eq } from "drizzle-orm";
import { db } from "@/db";
import { clientProfiles } from "@/db/schema/muneem";
import {
  defaultClientProfileValues,
  type DefaultProfileSeed,
} from "./default-profile-values";

/**
 * Returns an existing profile or inserts a default row. Safe to call from
 * signup, upload gates, and D03 (idempotent).
 */
export async function ensureClientProfile(
  clientOrgId: string,
  seed: DefaultProfileSeed = {},
) {
  const existing = await db.query.clientProfiles.findFirst({
    where: eq(clientProfiles.clientOrgId, clientOrgId),
  });
  if (existing) return existing;

  const values = defaultClientProfileValues(seed);
  const [created] = await db
    .insert(clientProfiles)
    .values({
      clientOrgId,
      ...values,
    })
    .onConflictDoNothing({ target: clientProfiles.clientOrgId })
    .returning();

  if (created) return created;

  const row = await db.query.clientProfiles.findFirst({
    where: eq(clientProfiles.clientOrgId, clientOrgId),
  });
  if (!row) {
    throw new Error(`Failed to create client_profiles for ${clientOrgId}`);
  }
  return row;
}
