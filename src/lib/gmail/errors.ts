export class GmailNotConnectedError extends Error {
  constructor() {
    super("GMAIL_NOT_CONNECTED");
    this.name = "GmailNotConnectedError";
  }
}

export class GmailNeedsReauthError extends Error {
  constructor() {
    super("GMAIL_NEEDS_REAUTH");
    this.name = "GmailNeedsReauthError";
  }
}

export function isGoogleAuthFailure(err: unknown): boolean {
  const e = err as {
    code?: number | string;
    status?: number;
    message?: string;
    response?: { status?: number; data?: { error?: string } };
  };
  const apiError = e.response?.data?.error;
  if (apiError === "invalid_grant" || apiError === "invalid_token") return true;
  if (e.code === 401 || e.status === 401 || e.response?.status === 401) {
    return true;
  }
  return (
    typeof e.message === "string" &&
    /invalid_grant|invalid_token|unauthorized/i.test(e.message)
  );
}
