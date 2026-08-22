import Link from "next/link";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { bankTransactions, clientOrgs } from "@/db/schema/muneem";
import { getOwnerSession } from "@/lib/auth/tenant";
import { getGmailStatus } from "@/lib/gmail/status";
import { GmailIntegrationsCard } from "../_components/gmail-integrations-card";

export default async function OwnerDashboard() {
  const session = await getOwnerSession();
  if (!session) return null;

  const [org, [{ count }], gmailStatus] = await Promise.all([
    db.query.clientOrgs.findFirst({
      where: eq(clientOrgs.id, session.clientOrgId),
    }),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(bankTransactions)
      .where(
        and(
          eq(bankTransactions.clientOrgId, session.clientOrgId),
          eq(bankTransactions.matchStatus, "unmatched"),
        ),
      ),
    getGmailStatus(session.ownerId),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-2xl font-semibold text-neutral-900">
          Welcome back.
        </h2>
        <p className="mt-1 text-sm text-neutral-500">
          You&apos;re signed in to{" "}
          <span className="font-medium">{org?.name}</span>.
        </p>
      </div>

      <Link
        href="/owner/pending"
        className="block rounded-xl border border-neutral-200 bg-white p-6 shadow-sm transition-colors hover:border-neutral-300"
      >
        <p className="text-sm text-neutral-500">Pending items</p>
        <p className="mt-1 text-3xl font-semibold text-neutral-900">{count}</p>
        <p className="mt-2 text-xs text-neutral-500">
          {count === 0
            ? "Nothing pending — upload a statement to get started."
            : "Transactions waiting for a matching invoice."}
        </p>
      </Link>

      <GmailIntegrationsCard status={gmailStatus} />

      <div className="rounded-xl border border-neutral-200 bg-white p-6 shadow-sm">
        <h3 className="text-base font-medium text-neutral-900">
          Getting started
        </h3>
        <ul className="mt-3 flex flex-col gap-2 text-sm text-neutral-700">
          <li>
            1. Connect Gmail on the{" "}
            <Link
              href="/owner/onboarding"
              className="text-primary hover:text-primary-hover"
            >
              Onboarding
            </Link>{" "}
            page.
          </li>
          <li>
            2. Upload your bank statement on the{" "}
            <Link
              href="/owner/statements"
              className="text-primary hover:text-primary-hover"
            >
              Statements
            </Link>{" "}
            page.
          </li>
          <li>
            3. We&apos;ll list any transactions we couldn&apos;t match on the{" "}
            <Link
              href="/owner/pending"
              className="text-primary hover:text-primary-hover"
            >
              Pending
            </Link>{" "}
            page.
          </li>
        </ul>
      </div>
    </div>
  );
}
