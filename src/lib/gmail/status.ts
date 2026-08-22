import { eq } from "drizzle-orm";
import { db } from "@/db";
import { gmailConnections } from "@/db/schema/muneem";
import { probeGmailAccess } from "@/lib/gmail/client";
import {
  GmailNeedsReauthError,
  GmailNotConnectedError,
} from "@/lib/gmail/errors";
import type { GmailStatusPayload } from "@/lib/gmail/types";

export async function getGmailStatus(
  userId: string,
): Promise<GmailStatusPayload> {
  const row = await db.query.gmailConnections.findFirst({
    where: eq(gmailConnections.userId, userId),
  });

  if (!row) {
    return {
      status: "disconnected" as const,
      gmailAddress: null,
      connectedAt: null,
      lastUsedAt: null,
    };
  }

  if (row.status === "active") {
    try {
      const address = await probeGmailAccess(userId);
      const fresh = await db.query.gmailConnections.findFirst({
        where: eq(gmailConnections.userId, userId),
        columns: { lastUsedAt: true, gmailAddress: true },
      });
      return {
        status: "active" as const,
        gmailAddress: address || fresh?.gmailAddress || row.gmailAddress,
        connectedAt: row.connectedAt.toISOString(),
        lastUsedAt:
          (fresh?.lastUsedAt ?? row.lastUsedAt)?.toISOString() ?? null,
      };
    } catch (err) {
      if (
        err instanceof GmailNeedsReauthError ||
        err instanceof GmailNotConnectedError
      ) {
        const updated = await db.query.gmailConnections.findFirst({
          where: eq(gmailConnections.userId, userId),
        });
        if (!updated) {
          return {
            status: "disconnected" as const,
            gmailAddress: null,
            connectedAt: null,
            lastUsedAt: null,
          };
        }
        return {
          status: updated.status,
          gmailAddress: updated.gmailAddress,
          connectedAt: updated.connectedAt.toISOString(),
          lastUsedAt: updated.lastUsedAt?.toISOString() ?? null,
        };
      }
      return {
        status: row.status,
        gmailAddress: row.gmailAddress,
        connectedAt: row.connectedAt.toISOString(),
        lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
      };
    }
  }

  return {
    status: row.status,
    gmailAddress: row.gmailAddress,
    connectedAt: row.connectedAt.toISOString(),
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
  };
}
