"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { GmailStatusPayload } from "@/lib/gmail/types";

const primaryBtn =
  "inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-hover focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50";

const secondaryBtn =
  "inline-flex items-center gap-2 rounded-lg border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-50 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 disabled:opacity-50";

function formatDate(iso: string | null): string {
  if (!iso) return "";
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(iso));
}

export function GmailConnectCard({
  initial,
  flash,
}: {
  initial: GmailStatusPayload;
  flash?: "connected" | "error";
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<"connect" | "disconnect" | null>(null);
  const [error, setError] = useState<string | null>(
    flash === "error" ? "Couldn't connect Gmail. Please try again." : null,
  );

  async function startOAuth() {
    setBusy("connect");
    setError(null);
    try {
      const res = await fetch("/api/gmail/auth-url");
      if (res.status === 401) {
        setError("Sign in again to connect Gmail.");
        return;
      }
      if (!res.ok) {
        setError("Couldn't start Gmail connect. Please try again.");
        return;
      }
      const data = (await res.json()) as { url?: string };
      if (!data.url) {
        setError("Couldn't start Gmail connect. Please try again.");
        return;
      }
      window.location.href = data.url;
    } catch {
      setError("Couldn't start Gmail connect. Please try again.");
      setBusy(null);
    }
  }

  async function disconnect() {
    setBusy("disconnect");
    setError(null);
    try {
      const res = await fetch("/api/gmail/disconnect", { method: "POST" });
      if (!res.ok) {
        setError("Couldn't disconnect Gmail. Please try again.");
        setBusy(null);
        return;
      }
      router.refresh();
    } catch {
      setError("Couldn't disconnect Gmail. Please try again.");
    } finally {
      setBusy(null);
    }
  }

  const status = initial.status;

  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-6 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-base font-medium text-neutral-900">
            Connect Gmail
          </h3>
          <p className="mt-1 text-sm text-neutral-700">
            We&apos;ll look for invoices in your inbox. Access is read-only.
          </p>
        </div>
        {status === "active" && (
          <span className="inline-flex items-center rounded-full border border-green-200 bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700">
            Connected
          </span>
        )}
        {status === "needs_reauth" && (
          <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
            Needs reconnection
          </span>
        )}
      </div>

      {flash === "connected" && status === "active" && (
        <p className="mt-3 text-sm text-green-700">Gmail is connected.</p>
      )}

      {status === "active" && (
        <div className="mt-4 flex flex-col gap-1">
          <p className="text-sm font-medium text-neutral-900">
            {initial.gmailAddress}
          </p>
          {initial.connectedAt && (
            <p className="text-xs text-neutral-500">
              Connected {formatDate(initial.connectedAt)}
            </p>
          )}
        </div>
      )}

      {status === "needs_reauth" && (
        <p className="mt-4 text-sm text-neutral-700">
          Access was revoked or expired. Connect again to keep collecting
          invoices from Gmail.
        </p>
      )}

      {status === "revoked" && (
        <p className="mt-4 text-sm text-neutral-700">
          This Gmail connection is no longer valid. Connect again to continue.
        </p>
      )}

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

      <div className="mt-5 flex flex-wrap gap-2">
        {(status === "disconnected" || status === "revoked") && (
          <button
            type="button"
            className={primaryBtn}
            onClick={startOAuth}
            disabled={busy !== null}
          >
            {busy === "connect" ? "Redirecting…" : "Connect Gmail"}
          </button>
        )}
        {status === "needs_reauth" && (
          <>
            <button
              type="button"
              className={primaryBtn}
              onClick={startOAuth}
              disabled={busy !== null}
            >
              {busy === "connect" ? "Redirecting…" : "Reconnect"}
            </button>
            <button
              type="button"
              className={secondaryBtn}
              onClick={disconnect}
              disabled={busy !== null}
            >
              {busy === "disconnect" ? "Disconnecting…" : "Disconnect"}
            </button>
          </>
        )}
        {status === "active" && (
          <button
            type="button"
            className={secondaryBtn}
            onClick={disconnect}
            disabled={busy !== null}
          >
            {busy === "disconnect" ? "Disconnecting…" : "Disconnect"}
          </button>
        )}
      </div>
    </div>
  );
}
