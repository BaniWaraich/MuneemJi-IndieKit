/**
 * F10: Gmail invoice pull for an O04 checklist item.
 * Event: muneem/gmail.invoice-search
 */
import { and, eq } from "drizzle-orm";
import { NonRetriableError } from "inngest";
import { inngest } from "../client";
import { db } from "@/db";
import {
  bankStatements,
  clientOrgs,
  clientUsers,
  documents,
  gmailConnections,
  invoiceChecklistItems,
} from "@/db/schema/muneem";
import {
  buildGmailInvoiceQuery,
  findPdfAttachments,
} from "@/lib/gmail/attachments";
import {
  downloadAttachmentForConnection,
  getMessageForConnection,
  searchMessagesForConnection,
} from "@/lib/gmail/client";
import {
  GmailNeedsReauthError,
  GmailNotConnectedError,
} from "@/lib/gmail/errors";
import { gmailInvoiceSearch } from "./build-invoice-checklist";
import {
  documentS3Key,
  MAX_DOCUMENT_BYTES,
} from "@/lib/muneem-storage/document-upload";
import {
  getFirmStorageBytes,
  MAX_FIRM_STORAGE_BYTES,
} from "@/lib/muneem-storage/firm-storage";
import { StorageNotConfiguredError } from "@/lib/muneem-storage/presign";
import { putObjectBytes } from "@/lib/muneem-storage/put";
import { getPayeeMemory } from "@/lib/payee-memory/store";
import { memoryOmitsPayee } from "@/lib/payee-memory/types";

export const gmailInvoicePull = inngest.createFunction(
  {
    id: "gmail-invoice-pull",
    name: "Muneem: F10 Gmail Invoice Pull",
    retries: 3,
    throttle: {
      limit: 5,
      period: "1m",
      key: "event.data.clientOrgId",
    },
    triggers: [gmailInvoiceSearch],
  },
  async ({ event, step }) => {
    const { clientOrgId, statementId, itemId } = event.data;

    const outcome = await step.run("pull-pdf", () =>
      pullPdfForItem({ clientOrgId, statementId, itemId }),
    );

    if (outcome.kind === "stored" && outcome.documentId) {
      await step.sendEvent("document-uploaded", {
        name: "muneem/document.uploaded",
        data: { documentId: outcome.documentId, clientOrgId },
      });
    }

    return outcome;
  },
);

type PullOutcome =
  | { kind: "noop"; reason: string }
  | { kind: "skipped_no_gmail" }
  | { kind: "not_found" }
  | { kind: "failed"; reason: string }
  | { kind: "stored"; documentId: string };

async function pullPdfForItem(input: {
  clientOrgId: string;
  statementId: string;
  itemId: string;
}): Promise<PullOutcome> {
  const item = await db.query.invoiceChecklistItems.findFirst({
    where: and(
      eq(invoiceChecklistItems.id, input.itemId),
      eq(invoiceChecklistItems.clientOrgId, input.clientOrgId),
      eq(invoiceChecklistItems.statementId, input.statementId),
    ),
  });
  if (!item) throw new NonRetriableError("ITEM_NOT_FOUND");
  if (item.documentId && item.status === "collected") {
    return { kind: "noop", reason: "already_collected" };
  }
  if (item.status !== "to_collect") {
    return { kind: "noop", reason: "not_to_collect" };
  }

  const memory = await getPayeeMemory(input.clientOrgId, item.payeeKey);
  if (memoryOmitsPayee(memory)) {
    await markSearch(item.id, "not_eligible");
    return { kind: "noop", reason: "memory_never" };
  }

  const statement = await db.query.bankStatements.findFirst({
    where: eq(bankStatements.id, input.statementId),
  });
  if (!statement) throw new NonRetriableError("STATEMENT_NOT_FOUND");

  const connections = await db
    .select({
      id: gmailConnections.id,
      userId: gmailConnections.userId,
      gmailAddress: gmailConnections.gmailAddress,
    })
    .from(gmailConnections)
    .innerJoin(clientUsers, eq(gmailConnections.userId, clientUsers.id))
    .where(
      and(
        eq(clientUsers.clientOrgId, input.clientOrgId),
        eq(gmailConnections.status, "active"),
      ),
    );

  if (connections.length === 0) {
    await markSearch(item.id, "skipped_no_gmail");
    return { kind: "skipped_no_gmail" };
  }

  const query = buildGmailInvoiceQuery({
    displayName: item.displayName,
    periodStart: statement.periodStart,
    periodEnd: statement.periodEnd,
  });

  let searchedAny = false;
  for (const conn of connections) {
    try {
      const listed = await searchMessagesForConnection(conn.id, query, {
        maxResults: 5,
      });
      searchedAny = true;
      for (const msg of listed.messages) {
        if (!msg.id) continue;
        const full = await getMessageForConnection(conn.id, msg.id);
        const pdfs = findPdfAttachments(full);
        for (const pdf of pdfs) {
          const bytes = await downloadAttachmentForConnection(
            conn.id,
            msg.id,
            pdf.attachmentId,
          );
          if (bytes.length > MAX_DOCUMENT_BYTES) continue;
          const stored = await storePdf({
            clientOrgId: input.clientOrgId,
            itemId: item.id,
            filename: pdf.filename,
            bytes,
            connectionId: conn.id,
            gmailAddress: conn.gmailAddress,
            submittedByClient: conn.userId,
          });
          if (stored.kind === "stored") return stored;
          if (stored.kind === "failed") return stored;
        }
      }
    } catch (err) {
      if (
        err instanceof GmailNeedsReauthError ||
        err instanceof GmailNotConnectedError
      ) {
        continue;
      }
      throw err;
    }
  }

  if (!searchedAny) {
    await markSearch(item.id, "skipped_no_gmail");
    return { kind: "skipped_no_gmail" };
  }

  await markSearch(item.id, "complete");
  return { kind: "not_found" };
}

async function storePdf(input: {
  clientOrgId: string;
  itemId: string;
  filename: string;
  bytes: Buffer;
  connectionId: string;
  gmailAddress: string;
  submittedByClient: string;
}): Promise<PullOutcome> {
  const org = await db.query.clientOrgs.findFirst({
    where: eq(clientOrgs.id, input.clientOrgId),
    columns: { firmId: true },
  });
  if (!org) return { kind: "failed", reason: "org_missing" };

  const used = await getFirmStorageBytes(org.firmId);
  if (used + BigInt(input.bytes.length) > BigInt(MAX_FIRM_STORAGE_BYTES)) {
    await markSearch(input.itemId, "failed");
    return { kind: "failed", reason: "storage_cap" };
  }

  const s3Key = documentS3Key(input.clientOrgId, input.filename);
  try {
    await putObjectBytes({
      key: s3Key,
      body: input.bytes,
      contentType: "application/pdf",
    });
  } catch (err) {
    if (err instanceof StorageNotConfiguredError) {
      await markSearch(input.itemId, "failed");
      return { kind: "failed", reason: "s3" };
    }
    throw err;
  }

  const [doc] = await db
    .insert(documents)
    .values({
      clientOrgId: input.clientOrgId,
      submittedByClient: input.submittedByClient,
      s3Key,
      filename: input.filename,
      fileType: "pdf",
      fileSizeBytes: BigInt(input.bytes.length),
      scanStatus: "clean",
      ocrStatus: "pending",
      gmailConnectionId: input.connectionId,
      gmailAddress: input.gmailAddress,
    })
    .returning({ id: documents.id });

  await db
    .update(invoiceChecklistItems)
    .set({
      documentId: doc.id,
      status: "collected",
      gmailConnectionId: input.connectionId,
      gmailSearchStatus: "complete",
      updatedAt: new Date(),
    })
    .where(eq(invoiceChecklistItems.id, input.itemId));

  return { kind: "stored", documentId: doc.id };
}

async function markSearch(
  itemId: string,
  status: "not_eligible" | "skipped_no_gmail" | "complete" | "failed",
): Promise<void> {
  await db
    .update(invoiceChecklistItems)
    .set({ gmailSearchStatus: status, updatedAt: new Date() })
    .where(eq(invoiceChecklistItems.id, itemId));
}
