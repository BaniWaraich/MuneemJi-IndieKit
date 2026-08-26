"use client";

import { useState } from "react";
import type { ClarificationDto } from "./checklist-types";

const primaryBtn =
  "inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-hover focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50";

const secondaryBtn =
  "inline-flex items-center gap-2 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-50 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 disabled:opacity-50";

const ANSWERS = [
  { value: "landlord", label: "Rent / landlord" },
  { value: "supplier", label: "Supplier" },
  { value: "family", label: "Personal / family" },
  { value: "self", label: "My other account" },
  { value: "skip", label: "Skip for now" },
] as const;

export function QuickQuestionsCard({
  questions,
  onAnswered,
}: {
  questions: ClarificationDto[];
  onAnswered: () => Promise<void>;
}) {
  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (questions.length === 0) return null;
  const current = questions[Math.min(index, questions.length - 1)];
  if (!current) return null;

  async function answer(value: (typeof ANSWERS)[number]["value"]) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/v1/owner/clarifications/${current.id}/answer`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ answer: value }),
        },
      );
      if (!res.ok) {
        setError("Couldn't save that answer. Please try again.");
        return;
      }
      await onAnswered();
      setIndex(0);
    } catch {
      setError("Couldn't save that answer. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-xl border border-neutral-200 bg-white p-6 shadow-sm">
      <h2 className="text-lg font-semibold text-neutral-900">
        Quick questions
      </h2>
      <p className="mt-1 text-sm text-neutral-500">
        Help us recognize a few payments on your statement.
      </p>
      <p className="mt-4 text-sm text-neutral-700">{current.promptText}</p>
      <div className="mt-4 flex flex-wrap gap-2">
        {ANSWERS.map((a) => (
          <button
            key={a.value}
            type="button"
            disabled={busy}
            onClick={() => answer(a.value)}
            className={a.value === "skip" ? secondaryBtn : primaryBtn}
          >
            {a.label}
          </button>
        ))}
      </div>
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
      <p className="mt-3 text-xs text-neutral-500">
        Question {Math.min(index + 1, questions.length)} of {questions.length}
      </p>
    </section>
  );
}
