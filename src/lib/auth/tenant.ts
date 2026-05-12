/**
 * Muneem Ji tenant isolation helpers.
 * Uses Indie Kit's session shape: session.user.role + session.user.firmId.
 */

import { auth } from "@/auth";
import { db } from "@/db";
import { clientOrgs } from "@/db/schema/muneem";
import { and, eq } from "drizzle-orm";

export class UnauthorizedError extends Error {
  constructor() {
    super("UNAUTHORIZED");
    this.name = "UnauthorizedError";
  }
}

export class ForbiddenError extends Error {
  constructor() {
    super("FORBIDDEN");
    this.name = "ForbiddenError";
  }
}

export type FirmSession = {
  userId: string;
  firmId: string;
  email: string;
  role: "ca_admin" | "ca_staff";
};

export type OwnerSession = {
  ownerId: string;
  clientOrgId: string;
  email: string;
};

export async function requireFirmSession(): Promise<FirmSession> {
  const session = await auth();
  const role = session?.user?.role;
  if (
    !session?.user?.email ||
    !session.user.id ||
    (role !== "ca_admin" && role !== "ca_staff")
  ) {
    throw new UnauthorizedError();
  }
  if (!session.user.firmId) throw new UnauthorizedError();
  return {
    userId: session.user.id,
    firmId: session.user.firmId,
    email: session.user.email,
    role,
  };
}

export async function requireOwnerSession(): Promise<OwnerSession> {
  const session = await auth();
  if (
    !session?.user?.email ||
    !session.user.id ||
    session.user.role !== "business_owner"
  ) {
    throw new UnauthorizedError();
  }
  // For BOs, session.user.firmId holds their clientOrgId (set in auth.ts BO provider)
  if (!session.user.firmId) throw new UnauthorizedError();
  return {
    ownerId: session.user.id,
    clientOrgId: session.user.firmId,
    email: session.user.email,
  };
}

export async function assertFirmOwnsClient(
  firmId: string,
  clientOrgId: string
): Promise<void> {
  const row = await db.query.clientOrgs.findFirst({
    where: and(eq(clientOrgs.id, clientOrgId), eq(clientOrgs.firmId, firmId)),
  });
  if (!row) throw new ForbiddenError();
}

export function assertOwnerInOrg(
  session: OwnerSession,
  clientOrgId: string
): void {
  if (session.clientOrgId !== clientOrgId) throw new ForbiddenError();
}

export type FirmOrOwnerAccess =
  | { kind: "firm"; session: FirmSession }
  | { kind: "owner"; session: OwnerSession };

export async function requireFirmOrOwnerForClient(
  clientOrgId: string
): Promise<FirmOrOwnerAccess> {
  const session = await auth();
  if (!session?.user?.email || !session.user.id) throw new UnauthorizedError();

  const role = session.user.role;

  if (role === "ca_admin" || role === "ca_staff") {
    if (!session.user.firmId) throw new UnauthorizedError();
    const firm: FirmSession = {
      userId: session.user.id,
      firmId: session.user.firmId,
      email: session.user.email,
      role,
    };
    await assertFirmOwnsClient(firm.firmId, clientOrgId);
    return { kind: "firm", session: firm };
  }

  if (role === "business_owner") {
    if (!session.user.firmId) throw new UnauthorizedError();
    const owner: OwnerSession = {
      ownerId: session.user.id,
      clientOrgId: session.user.firmId,
      email: session.user.email,
    };
    assertOwnerInOrg(owner, clientOrgId);
    return { kind: "owner", session: owner };
  }

  throw new UnauthorizedError();
}
