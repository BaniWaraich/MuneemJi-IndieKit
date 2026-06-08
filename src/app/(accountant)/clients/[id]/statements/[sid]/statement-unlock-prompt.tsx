"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const API_ERRORS: Record<string, string> = {
  NOT_FOUND:
    "This statement could not be found. Refresh the page and try again.",
  WRONG_STATUS:
    "This statement is no longer waiting for a password. Refresh the page.",
  VALIDATION: "Enter the PDF password to continue.",
};

export function StatementUnlockPrompt({
  clientOrgId,
  statementId,
  errorMessage,
  onSubmitted,
}: {
  clientOrgId: string;
  statementId: string;
  /** bank_statements.error_message — when it contains "incorrect", the last attempt was wrong. */
  errorMessage?: string | null;
  /**
   * Called after a successful unlock request. Provide this on client-rendered
   * surfaces (e.g. the statements list panel) that manage their own state and
   * need to re-fetch. When omitted, the component falls back to
   * `router.refresh()` (server-rendered surfaces like the detail page).
   */
  onSubmitted?: () => void;
}) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(
    errorMessage && errorMessage.toLowerCase().includes("incorrect")
      ? errorMessage
      : null,
  );

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!password.trim()) {
      setError("Enter the PDF password to continue.");
      return;
    }
    setError(null);
    setSubmitting(true);

    const submittedPassword = password;
    // Never keep the password in component state longer than the request.
    setPassword("");

    try {
      // POST /api/v1/clients/:id/statements/:sid/unlock (Task 1 — implemented).
      //   body: { password: string }   (non-empty, max 128 chars)
      //   200 -> { queued: true } ; 404 not found, 409 wrong status, 400 validation.
      const res = await fetch(
        `/api/v1/clients/${clientOrgId}/statements/${statementId}/unlock`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ password: submittedPassword }),
        },
      );

      if (res.ok) {
        // Status will transition to 'unlocking'; pick up the new state. Prefer
        // the caller's refresh hook (client-managed lists); otherwise re-render
        // the server tree.
        if (onSubmitted) onSubmitted();
        else router.refresh();
        return;
      }

      if (res.status === 404) {
        setError(API_ERRORS.NOT_FOUND);
      } else if (res.status === 409) {
        setError(API_ERRORS.WRONG_STATUS);
      } else if (res.status === 400) {
        setError(API_ERRORS.VALIDATION);
      } else {
        setError("Something went wrong. Please try again.");
      }
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-4">
      <p className="text-sm font-medium text-amber-800">
        This PDF is password-protected
      </p>
      <p className="mt-1 text-xs text-amber-700">
        Enter the PDF password to continue processing.
      </p>
      <form
        onSubmit={handleSubmit}
        className="mt-3 flex flex-wrap items-start gap-2"
      >
        <div className="min-w-0 flex-1">
          <input
            type="password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              if (error) setError(null);
            }}
            maxLength={128}
            autoComplete="off"
            placeholder="PDF password"
            aria-label="PDF password"
            className="focus:ring-primary w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 transition-colors placeholder:text-neutral-400 focus:border-transparent focus:ring-2 focus:outline-none"
          />
          {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
        </div>
        <button
          type="submit"
          disabled={submitting}
          className="bg-primary hover:bg-primary-hover focus:ring-primary inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors focus:ring-2 focus:ring-offset-2 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting ? "Unlocking…" : "Unlock & Process"}
        </button>
      </form>
    </div>
  );
}
