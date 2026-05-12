import Link from "next/link";
import { and, eq, sql, count } from "drizzle-orm";
import { db } from "@/db";
import {
  clientOrgs,
  clientContacts,
  clientProfiles,
  bankStatements,
  bankTransactions,
} from "@/db/schema/muneem";
import { auth } from "@/auth";
import { redirect } from "next/navigation";

export default async function AccountantDashboard() {
  const session = await auth();
  if (
    !session ||
    (session.user.role !== "ca_admin" && session.user.role !== "ca_staff") ||
    !session.user.firmId
  ) {
    redirect("/login");
  }

  const firmId = session.user.firmId;

  const [rows, statementsCount, pendingInvoices] = await Promise.all([
    db
      .select({
        id: clientOrgs.id,
        name: clientOrgs.name,
        country: clientOrgs.country,
        taxRegime: clientOrgs.taxRegime,
        contactCount: sql<number>`count(distinct ${clientContacts.id})::int`,
        acceptedCount: sql<number>`count(distinct ${clientContacts.id}) filter (where ${clientContacts.hasAccount})::int`,
        hasProfile: sql<boolean>`bool_or(${clientProfiles.clientOrgId} is not null)`,
      })
      .from(clientOrgs)
      .leftJoin(clientContacts, eq(clientContacts.clientOrgId, clientOrgs.id))
      .leftJoin(clientProfiles, eq(clientProfiles.clientOrgId, clientOrgs.id))
      .where(eq(clientOrgs.firmId, firmId))
      .groupBy(clientOrgs.id),

    db
      .select({ n: count() })
      .from(bankStatements)
      .innerJoin(clientOrgs, eq(clientOrgs.id, bankStatements.clientOrgId))
      .where(eq(clientOrgs.firmId, firmId)),

    db
      .select({ n: count() })
      .from(bankTransactions)
      .innerJoin(clientOrgs, eq(clientOrgs.id, bankTransactions.clientOrgId))
      .where(
        and(
          eq(clientOrgs.firmId, firmId),
          eq(bankTransactions.needsInvoice, true),
        ),
      ),
  ]);

  const totalClients = rows.length;
  const totalStatements = statementsCount[0]?.n ?? 0;
  const totalPending = pendingInvoices[0]?.n ?? 0;

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-6 py-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-neutral-900">Dashboard</h1>
        <Link
          href="/clients/new"
          className="bg-primary hover:bg-primary-hover focus:ring-primary inline-flex items-center rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors focus:ring-2 focus:ring-offset-2 focus:outline-none"
        >
          Add client
        </Link>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: "Total clients", value: totalClients },
          { label: "Statements processed", value: totalStatements },
          { label: "Invoices needed", value: totalPending },
        ].map(({ label, value }) => (
          <div
            key={label}
            className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm"
          >
            <p className="text-sm text-neutral-500">{label}</p>
            <p className="mt-1 text-3xl font-semibold text-neutral-900">
              {value}
            </p>
          </div>
        ))}
      </div>

      {/* Client list */}
      {rows.length === 0 ? (
        <div className="rounded-xl border border-neutral-200 bg-white p-12 text-center shadow-sm">
          <p className="text-neutral-700">No clients yet.</p>
          <p className="mt-1 text-sm text-neutral-500">
            Add your first client to start collecting invoices and statements.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 text-left text-neutral-600">
              <tr>
                <th className="px-6 py-3 font-medium">Name</th>
                <th className="px-6 py-3 font-medium">Country</th>
                <th className="px-6 py-3 font-medium">Tax regime</th>
                <th className="px-6 py-3 font-medium">Setup</th>
                <th className="px-6 py-3 font-medium">Contacts</th>
                <th className="px-6 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-200">
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-neutral-50">
                  <td className="px-6 py-3 font-medium text-neutral-900">
                    {r.name}
                  </td>
                  <td className="px-6 py-3 text-neutral-600">{r.country}</td>
                  <td className="px-6 py-3">
                    <span className="inline-flex items-center rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-xs font-medium text-violet-700">
                      {r.taxRegime}
                    </span>
                  </td>
                  <td className="px-6 py-3">
                    {r.hasProfile ? (
                      <span className="inline-flex items-center rounded-full border border-green-200 bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700">
                        Complete
                      </span>
                    ) : (
                      <Link
                        href={`/clients/${r.id}/onboarding`}
                        className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 hover:bg-amber-100"
                      >
                        Setup needed
                      </Link>
                    )}
                  </td>
                  <td className="px-6 py-3 text-neutral-600">
                    {r.acceptedCount}/{r.contactCount} accepted
                  </td>
                  <td className="px-6 py-3 text-right">
                    <Link
                      href={`/clients/${r.id}`}
                      className="text-primary hover:text-primary-hover font-medium"
                    >
                      View
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
