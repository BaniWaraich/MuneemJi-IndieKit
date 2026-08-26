import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { bankStatements } from "@/db/schema/muneem";
import { getOwnerSession } from "@/lib/auth/tenant";
import { formatDateIN } from "@/lib/format/inr";
import {
  OwnerUnlock,
  StatementParseProgress,
} from "../../_components/statement-parse-progress";

export default async function OwnerStatementDetailPage({
  params,
}: {
  params: Promise<{ sid: string }>;
}) {
  const { sid } = await params;
  const session = await getOwnerSession();
  if (!session) return null;

  const statement = await db.query.bankStatements.findFirst({
    where: and(
      eq(bankStatements.id, sid),
      eq(bankStatements.clientOrgId, session.clientOrgId),
    ),
  });
  if (!statement) notFound();

  if (statement.status === "parsed") {
    redirect(`/owner/statements/${sid}/checklist`);
  }

  const inFlight =
    statement.status === "processing" ||
    statement.status === "phase1_complete" ||
    statement.status === "unlocking";

  return (
    <div className="flex flex-col gap-6">
      <Link
        href="/owner/statements"
        className="text-primary hover:text-primary-hover text-sm"
      >
        ← Back to Statements
      </Link>

      <div className="rounded-xl border border-neutral-200 bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-semibold text-neutral-900">
          {statement.filename}
        </h1>
        <p className="mt-1 text-sm text-neutral-500">
          {statement.periodStart && statement.periodEnd
            ? `${formatDateIN(statement.periodStart)} – ${formatDateIN(statement.periodEnd)} · `
            : ""}
          {statement.currency}
        </p>
      </div>

      {inFlight && (
        <StatementParseProgress
          clientOrgId={session.clientOrgId}
          statementId={sid}
        />
      )}

      {statement.status === "password_required" && (
        <OwnerUnlock clientOrgId={session.clientOrgId} statementId={sid} />
      )}

      {statement.status === "failed" && (
        <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {statement.errorMessage ||
            "We couldn't read this statement. Try another file."}
        </p>
      )}

      {statement.status === "empty" && (
        <p className="text-sm text-neutral-500">
          We didn&apos;t find any payments on this statement.
        </p>
      )}
    </div>
  );
}
