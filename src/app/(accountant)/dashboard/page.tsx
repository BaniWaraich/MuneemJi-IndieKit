import Link from 'next/link';
import { redirect } from 'next/navigation';
import { eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { clientOrgs, clientContacts } from '@/db/schema/muneem';
import { auth } from '@/auth';
import { SignOutButton } from './sign-out-button';

export default async function AccountantDashboard() {
  const session = await auth();
  if (!session || (session.user.role !== 'ca_admin' && session.user.role !== 'ca_staff') || !session.user.firmId) {
    redirect('/login');
  }

  const rows = await db
    .select({
      id: clientOrgs.id,
      name: clientOrgs.name,
      country: clientOrgs.country,
      taxRegime: clientOrgs.taxRegime,
      contactCount: sql<number>`count(${clientContacts.id})::int`,
      acceptedCount: sql<number>`count(${clientContacts.id}) filter (where ${clientContacts.hasAccount})::int`,
    })
    .from(clientOrgs)
    .leftJoin(clientContacts, eq(clientContacts.clientOrgId, clientOrgs.id))
    .where(eq(clientOrgs.firmId, session.user.firmId))
    .groupBy(clientOrgs.id);

  return (
    <div className="min-h-screen bg-neutral-100">
      <nav className="border-b border-neutral-200 bg-white">
        <div className="mx-auto max-w-7xl px-6">
          <div className="flex h-16 items-center justify-between">
            <h1 className="text-lg font-semibold text-neutral-900">Muneem Jee</h1>
            <div className="flex items-center gap-4">
              <span className="text-sm text-neutral-500">{session.user.email}</span>
              <SignOutButton />
            </div>
          </div>
        </div>
      </nav>

      <main className="mx-auto max-w-7xl space-y-6 px-6 py-8">
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-semibold text-neutral-900">Clients</h2>
          <Link
            href="/clients/new"
            className="bg-primary hover:bg-primary-hover focus:ring-primary inline-flex items-center rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors focus:ring-2 focus:ring-offset-2 focus:outline-none"
          >
            Add client
          </Link>
        </div>

        {rows.length === 0 ? (
          <div className="rounded-xl border border-neutral-200 bg-white p-12 text-center shadow-sm">
            <p className="text-neutral-700">You haven&apos;t added any clients yet.</p>
            <p className="mt-1 text-sm text-neutral-500">
              Add your first client to start collecting invoices and statements.
            </p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm">
            <table className="w-full text-sm">
              <thead className="bg-neutral-100 text-left text-neutral-700">
                <tr>
                  <th className="px-6 py-3 font-medium">Name</th>
                  <th className="px-6 py-3 font-medium">Country</th>
                  <th className="px-6 py-3 font-medium">Tax regime</th>
                  <th className="px-6 py-3 font-medium">Contacts</th>
                  <th className="px-6 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-200">
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="px-6 py-3 font-medium text-neutral-900">{r.name}</td>
                    <td className="px-6 py-3 text-neutral-700">{r.country}</td>
                    <td className="px-6 py-3">
                      <span className="inline-flex items-center rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-xs font-medium text-violet-700">
                        {r.taxRegime}
                      </span>
                    </td>
                    <td className="px-6 py-3 text-neutral-700">
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
      </main>
    </div>
  );
}
