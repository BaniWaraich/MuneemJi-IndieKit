export const GMAIL_UI_STATUSES = [
  "disconnected",
  "active",
  "needs_reauth",
  "revoked",
] as const;

export type GmailStatusPayload = {
  status: (typeof GMAIL_UI_STATUSES)[number];
  gmailAddress: string | null;
  connectedAt: string | null;
  lastUsedAt: string | null;
};
