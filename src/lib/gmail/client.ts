import { eq } from "drizzle-orm";
import { db } from "@/db";
import { gmailConnections } from "@/db/schema/muneem";
import { decryptToken, encryptToken } from "@/lib/encryption/tokens";
import {
  GmailNeedsReauthError,
  GmailNotConnectedError,
  isGoogleAuthFailure,
} from "@/lib/gmail/errors";
import { createGmailApi, createGmailOAuthClient } from "@/lib/gmail/oauth";

const EXPIRY_SKEW_MS = 60_000;

async function loadConnection(userId: string) {
  return db.query.gmailConnections.findFirst({
    where: eq(gmailConnections.userId, userId),
  });
}

async function markNeedsReauth(userId: string): Promise<void> {
  await db
    .update(gmailConnections)
    .set({ status: "needs_reauth", updatedAt: new Date() })
    .where(eq(gmailConnections.userId, userId));
}

async function persistRefreshedTokens(
  userId: string,
  accessToken: string,
  expiry: Date,
  refreshToken?: string | null,
): Promise<void> {
  const now = new Date();
  await db
    .update(gmailConnections)
    .set({
      accessToken: encryptToken(accessToken),
      ...(refreshToken ? { refreshToken: encryptToken(refreshToken) } : {}),
      tokenExpiry: expiry,
      lastUsedAt: now,
      updatedAt: now,
    })
    .where(eq(gmailConnections.userId, userId));
}

export async function getValidAccessToken(userId: string): Promise<string> {
  const row = await loadConnection(userId);
  if (!row) throw new GmailNotConnectedError();
  if (row.status === "needs_reauth" || row.status === "revoked") {
    throw new GmailNeedsReauthError();
  }

  const accessToken = decryptToken(row.accessToken);
  const oauth2 = createGmailOAuthClient();
  oauth2.setCredentials({
    access_token: accessToken,
    refresh_token: decryptToken(row.refreshToken),
    expiry_date: row.tokenExpiry.getTime(),
  });

  try {
    if (row.tokenExpiry.getTime() - EXPIRY_SKEW_MS <= Date.now()) {
      const { credentials } = await oauth2.refreshAccessToken();
      const access = credentials.access_token;
      if (!access) throw new GmailNeedsReauthError();
      const expiry = credentials.expiry_date
        ? new Date(credentials.expiry_date)
        : new Date(Date.now() + 3600 * 1000);
      await persistRefreshedTokens(
        userId,
        access,
        expiry,
        credentials.refresh_token,
      );
      return access;
    }

    const now = new Date();
    await db
      .update(gmailConnections)
      .set({ lastUsedAt: now, updatedAt: now })
      .where(eq(gmailConnections.userId, userId));
    return accessToken;
  } catch (err) {
    if (err instanceof GmailNeedsReauthError) {
      await markNeedsReauth(userId);
      throw err;
    }
    if (isGoogleAuthFailure(err)) {
      await markNeedsReauth(userId);
      throw new GmailNeedsReauthError();
    }
    throw err;
  }
}

async function gmailForUser(userId: string) {
  const accessToken = await getValidAccessToken(userId);
  const auth = createGmailOAuthClient();
  auth.setCredentials({ access_token: accessToken });
  return createGmailApi(auth);
}

export async function searchMessages(
  userId: string,
  query: string,
  opts?: { maxResults?: number; pageToken?: string },
) {
  const gmail = await gmailForUser(userId);
  try {
    const res = await gmail.users.messages.list({
      userId: "me",
      q: query,
      maxResults: opts?.maxResults,
      pageToken: opts?.pageToken,
    });
    return {
      messages: res.data.messages ?? [],
      nextPageToken: res.data.nextPageToken ?? undefined,
    };
  } catch (err) {
    if (isGoogleAuthFailure(err)) {
      await markNeedsReauth(userId);
      throw new GmailNeedsReauthError();
    }
    throw err;
  }
}

export async function getMessage(userId: string, messageId: string) {
  const gmail = await gmailForUser(userId);
  try {
    const res = await gmail.users.messages.get({
      userId: "me",
      id: messageId,
      format: "full",
    });
    return res.data;
  } catch (err) {
    if (isGoogleAuthFailure(err)) {
      await markNeedsReauth(userId);
      throw new GmailNeedsReauthError();
    }
    throw err;
  }
}

export async function downloadAttachment(
  userId: string,
  messageId: string,
  attachmentId: string,
): Promise<Buffer> {
  const gmail = await gmailForUser(userId);
  try {
    const res = await gmail.users.messages.attachments.get({
      userId: "me",
      messageId,
      id: attachmentId,
    });
    return Buffer.from(res.data.data ?? "", "base64url");
  } catch (err) {
    if (isGoogleAuthFailure(err)) {
      await markNeedsReauth(userId);
      throw new GmailNeedsReauthError();
    }
    throw err;
  }
}

async function loadConnectionById(connectionId: string) {
  return db.query.gmailConnections.findFirst({
    where: eq(gmailConnections.id, connectionId),
  });
}

export async function searchMessagesForConnection(
  connectionId: string,
  query: string,
  opts?: { maxResults?: number; pageToken?: string },
) {
  const row = await loadConnectionById(connectionId);
  if (!row) throw new GmailNotConnectedError();
  return searchMessages(row.userId, query, opts);
}

export async function getMessageForConnection(
  connectionId: string,
  messageId: string,
) {
  const row = await loadConnectionById(connectionId);
  if (!row) throw new GmailNotConnectedError();
  return getMessage(row.userId, messageId);
}

export async function downloadAttachmentForConnection(
  connectionId: string,
  messageId: string,
  attachmentId: string,
) {
  const row = await loadConnectionById(connectionId);
  if (!row) throw new GmailNotConnectedError();
  return downloadAttachment(row.userId, messageId, attachmentId);
}

export async function probeGmailAccess(userId: string): Promise<string> {
  const gmail = await gmailForUser(userId);
  try {
    const res = await gmail.users.getProfile({ userId: "me" });
    return res.data.emailAddress ?? "";
  } catch (err) {
    if (isGoogleAuthFailure(err)) {
      await markNeedsReauth(userId);
      throw new GmailNeedsReauthError();
    }
    throw err;
  }
}
