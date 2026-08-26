"use client";

import type { ReactNode } from "react";
import { formatINR } from "@/lib/format/inr";
import type { ChecklistItemDto } from "./checklist-types";

const secondaryBtn =
  "inline-flex items-center gap-2 rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium text-neutral-700 transition-colors hover:bg-neutral-50 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 disabled:opacity-50";

function Badge({
  children,
  tone,
}: {
  children: ReactNode;
  tone: "amber" | "green";
}) {
  const cls =
    tone === "green"
      ? "bg-green-50 text-green-700 border-green-200"
      : "bg-amber-50 text-amber-700 border-amber-200";
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${cls}`}
    >
      {children}
    </span>
  );
}

export function InvoiceChecklist({
  toCollect,
  collected,
  onNotNeeded,
  busyId,
}: {
  toCollect: ChecklistItemDto[];
  collected: ChecklistItemDto[];
  onNotNeeded: (id: string) => Promise<void>;
  busyId: string | null;
}) {
  return (
    <div className="flex flex-col gap-6">
      <section className="rounded-xl border border-neutral-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-neutral-900">
          Invoices to collect
        </h2>
        {toCollect.length === 0 ? (
          <p className="mt-3 text-sm text-neutral-500">
            Nothing left to collect for this statement.
          </p>
        ) : (
          <ul className="mt-4 divide-y divide-neutral-200">
            {toCollect.map((item) => (
              <li
                key={item.id}
                className="flex flex-wrap items-center justify-between gap-3 py-3"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-neutral-900">
                    {item.displayName}
                  </p>
                  <p className="text-xs text-neutral-500">
                    {item.periodLabel}
                    {item.occurrenceCount > 1
                      ? ` · ${item.occurrenceCount} times`
                      : ""}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <p className="text-sm font-medium text-neutral-900">
                    {formatINR(BigInt(item.amountMinor))}
                  </p>
                  <Badge tone="amber">To collect</Badge>
                  <button
                    type="button"
                    className={secondaryBtn}
                    disabled={busyId === item.id}
                    onClick={() => onNotNeeded(item.id)}
                  >
                    Not needed
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-xl border border-neutral-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-neutral-900">
          Collected from Gmail
        </h2>
        {collected.length === 0 ? (
          <p className="mt-3 text-sm text-neutral-500">
            No invoices pulled from Gmail yet.
          </p>
        ) : (
          <ul className="mt-4 divide-y divide-neutral-200">
            {collected.map((item) => (
              <li
                key={item.id}
                className="flex flex-wrap items-center justify-between gap-3 py-3"
              >
                <div>
                  <p className="text-sm font-medium text-neutral-900">
                    {item.displayName}
                  </p>
                  {item.fromGmail && (
                    <p className="text-xs text-neutral-500">from your Gmail</p>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <Badge tone="green">Collected</Badge>
                  {item.viewUrl && (
                    <a
                      href={item.viewUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-primary hover:text-primary-hover text-sm font-medium"
                    >
                      View
                    </a>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
