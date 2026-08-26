"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { StatementUnlockPrompt } from "@/app/(accountant)/clients/[id]/statements/[sid]/statement-unlock-prompt";

export function StatementParseProgress({
  clientOrgId,
  statementId,
}: {
  clientOrgId: string;
  statementId: string;
}) {
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;
    async function tick() {
      const res = await fetch(`/api/v1/clients/${clientOrgId}/statements`, {
        cache: "no-store",
      });
      if (!res.ok || cancelled) return;
      const data = (await res.json()) as {
        statements: { id: string; status: string }[];
      };
      const row = data.statements.find((s) => s.id === statementId);
      if (row?.status === "parsed") {
        router.replace(`/owner/statements/${statementId}/checklist`);
        return;
      }
      if (
        row?.status === "failed" ||
        row?.status === "empty" ||
        row?.status === "password_required"
      ) {
        router.refresh();
      }
    }
    const timer = setInterval(() => void tick(), 3000);
    void tick();
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [clientOrgId, statementId, router]);

  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-6 shadow-sm">
      <p className="text-sm text-neutral-700">
        Analyzing your statement… this usually takes 1–2 minutes.
      </p>
      <p className="mt-2 text-xs text-neutral-500">
        You can leave this page open — we&apos;ll take you to the invoice list
        when it&apos;s ready.
      </p>
    </div>
  );
}

export function OwnerUnlock({
  clientOrgId,
  statementId,
}: {
  clientOrgId: string;
  statementId: string;
}) {
  const router = useRouter();
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-6 shadow-sm">
      <p className="text-sm text-neutral-700">
        This statement is password-protected. Enter the password to continue.
      </p>
      <div className="mt-4">
        <StatementUnlockPrompt
          clientOrgId={clientOrgId}
          statementId={statementId}
          onSubmitted={() => router.refresh()}
        />
      </div>
    </div>
  );
}
