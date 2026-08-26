"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { InvoiceChecklist } from "./invoice-checklist";
import { QuickQuestionsCard } from "./quick-questions-card";
import type { ChecklistPayload } from "./checklist-types";

export function ChecklistClient({ sid }: { sid: string }) {
  const [data, setData] = useState<ChecklistPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/v1/owner/statements/${sid}/checklist`, {
      cache: "no-store",
    });
    if (res.status === 409) {
      setError("still-parsing");
      return;
    }
    if (!res.ok) {
      setError("Couldn't load this checklist. Please try again.");
      return;
    }
    setError(null);
    setData((await res.json()) as ChecklistPayload);
  }, [sid]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const timer = setInterval(() => void load(), 8000);
    return () => clearInterval(timer);
  }, [load]);

  async function markNotNeeded(id: string) {
    setBusyId(id);
    try {
      const res = await fetch(`/api/v1/owner/checklist/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "not_needed" }),
      });
      if (!res.ok) return;
      await load();
    } finally {
      setBusyId(null);
    }
  }

  if (error === "still-parsing") {
    return (
      <p className="text-sm text-neutral-500">
        Still analyzing this statement.{" "}
        <Link
          href={`/owner/statements/${sid}`}
          className="text-primary hover:text-primary-hover"
        >
          Back to progress
        </Link>
      </p>
    );
  }

  if (error) {
    return <p className="text-sm text-red-600">{error}</p>;
  }

  if (!data) {
    return <p className="text-sm text-neutral-500">Loading checklist…</p>;
  }

  const { summary } = data;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link
          href="/owner/statements"
          className="text-primary hover:text-primary-hover text-sm"
        >
          ← Back to Statements
        </Link>
        <h1 className="mt-3 text-2xl font-semibold text-neutral-900">
          Invoice checklist
        </h1>
        <p className="mt-1 text-sm text-neutral-500">
          {data.statement.filename}
        </p>
      </div>

      <div className="rounded-xl border border-neutral-200 bg-white p-6 shadow-sm">
        <p className="text-sm text-neutral-700">
          {summary.toCollect} to collect · {summary.collected} collected ·{" "}
          {summary.quickQuestions} quick questions
        </p>
        {data.gmailHint === "not_connected" && (
          <p className="mt-2 text-xs text-neutral-500">
            Connect Gmail in Onboarding so we can look for invoices in your
            inbox.
          </p>
        )}
        {data.gmailHint === "needs_reauth" && (
          <p className="mt-2 text-xs text-amber-700">
            Gmail needs to be reconnected so we can keep finding invoices.
          </p>
        )}
      </div>

      <QuickQuestionsCard questions={data.clarifications} onAnswered={load} />

      <InvoiceChecklist
        toCollect={data.items.toCollect}
        collected={data.items.collected}
        onNotNeeded={markNotNeeded}
        busyId={busyId}
      />

      <section className="rounded-xl border border-neutral-200 bg-white p-6 shadow-sm">
        <p className="text-sm text-neutral-700">
          {summary.collected} invoices collected · {summary.findYourself} to
          find yourself
        </p>
      </section>
    </div>
  );
}
