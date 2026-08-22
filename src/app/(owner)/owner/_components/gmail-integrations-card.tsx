import Link from "next/link";
import type { GmailStatusPayload } from "@/lib/gmail/types";

function statusLabel(status: GmailStatusPayload["status"]): {
  label: string;
  className: string;
} {
  if (status === "active") {
    return {
      label: "Connected",
      className: "border-green-200 bg-green-50 text-green-700",
    };
  }
  if (status === "needs_reauth") {
    return {
      label: "Needs reconnection",
      className: "border-amber-200 bg-amber-50 text-amber-700",
    };
  }
  return {
    label: "Not connected",
    className: "border-neutral-200 bg-neutral-50 text-neutral-700",
  };
}

export function GmailIntegrationsCard({
  status,
}: {
  status: GmailStatusPayload;
}) {
  const badge = statusLabel(status.status);
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-6 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-base font-medium text-neutral-900">
            Data sources
          </h3>
          <p className="mt-1 text-sm text-neutral-500">
            Where we collect invoices from.
          </p>
        </div>
        <Link
          href="/owner/onboarding"
          className="text-sm font-medium text-primary hover:text-primary-hover"
        >
          Manage
        </Link>
      </div>
      <div className="mt-4 flex items-center justify-between gap-3 border-t border-neutral-200 pt-4">
        <div className="min-w-0">
          <p className="text-sm font-medium text-neutral-900">Gmail</p>
          <p className="truncate text-xs text-neutral-500">
            {status.status === "active" && status.gmailAddress
              ? status.gmailAddress
              : "Not connected"}
          </p>
        </div>
        <span
          className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-xs font-medium ${badge.className}`}
        >
          {badge.label}
        </span>
      </div>
    </div>
  );
}
