import Link from "next/link";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  bankStatements,
  clientOrgs,
  invoiceChecklistItems,
  payeeClarifications,
} from "@/db/schema/muneem";
import { getOwnerSession } from "@/lib/auth/tenant";
import { getGmailStatus } from "@/lib/gmail/status";
import { summarizeChecklist } from "@/lib/invoice-checklist/summary";
import { GmailIntegrationsCard } from "../_components/gmail-integrations-card";

export default async function OwnerDashboard() {
  const session = await getOwnerSession();
  if (!session) return null;

  const [org, gmailStatus, [latest]] = await Promise.all([
    db.query.clientOrgs.findFirst({
      where: eq(clientOrgs.id, session.clientOrgId),
    }),
    getGmailStatus(session.ownerId),
    db
      .select({ id: bankStatements.id })
      .from(bankStatements)
      .where(
        and(
          eq(bankStatements.clientOrgId, session.clientOrgId),
          eq(bankStatements.status, "parsed"),
        ),
      )
      .orderBy(desc(bankStatements.createdAt))
      .limit(1),
  ]);

  let summary = {
    toCollect: 0,
    collected: 0,
    findYourself: 0,
    quickQuestions: 0,
  };
  if (latest) {
    const [items, pending] = await Promise.all([
      db
        .select({
          status: invoiceChecklistItems.status,
          documentId: invoiceChecklistItems.documentId,
          gmailSearchStatus: invoiceChecklistItems.gmailSearchStatus,
        })
        .from(invoiceChecklistItems)
        .where(eq(invoiceChecklistItems.statementId, latest.id)),
      db
        .select({ id: payeeClarifications.id })
        .from(payeeClarifications)
        .where(
          and(
            eq(payeeClarifications.statementId, latest.id),
            eq(payeeClarifications.status, "pending"),
          ),
        ),
    ]);
    summary = summarizeChecklist(items, pending.length);
  }

  const gmailOk = gmailStatus.status === "active";
  const checklistHref = latest
    ? `/owner/statements/${latest.id}/checklist`
    : "/owner/statements";

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

      {(!gmailOk || !latest) && (
        <div className="rounded-xl border border-neutral-200 bg-white p-6 shadow-sm">
          <h3 className="text-base font-medium text-neutral-900">
            Get started
          </h3>
          <div className="mt-4 flex flex-col gap-3 sm:flex-row">
            {!gmailOk && (
              <Link
                href="/owner/onboarding#gmail"
                className="bg-primary hover:bg-primary-hover focus:ring-primary inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors focus:ring-2 focus:ring-offset-2 focus:outline-none"
              >
                Connect Gmail
              </Link>
            )}
            <Link
              href="/owner/statements"
              className="inline-flex items-center justify-center rounded-lg border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-50 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
            >
              Upload statement
            </Link>
          </div>
          <p className="mt-3 text-xs text-neutral-500">
            You can upload a statement before connecting Gmail — we&apos;ll just
            ask you to find a few invoices yourself.
          </p>
        </div>
      )}

      <Link
        href={checklistHref}
        className="block rounded-xl border border-neutral-200 bg-white p-6 shadow-sm transition-colors hover:border-neutral-300"
      >
        <p className="text-sm text-neutral-500">Invoices to collect</p>
        <p className="mt-1 text-3xl font-semibold text-neutral-900">
          {summary.toCollect}
        </p>
        <p className="mt-2 text-xs text-neutral-500">
          {summary.collected} collected · {summary.findYourself} to find
          yourself
          {summary.quickQuestions > 0
            ? ` · ${summary.quickQuestions} quick questions`
            : ""}
        </p>
      </Link>

      <GmailIntegrationsCard status={gmailStatus} />
    </div>
  );
}
