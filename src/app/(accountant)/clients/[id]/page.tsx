import Link from 'next/link';
import { redirect, notFound } from 'next/navigation';
import { and, eq } from 'drizzle-orm';
import { desc } from 'drizzle-orm';
import { db } from '@/db';
import { clientOrgs, clientContacts, bankStatements } from '@/db/schema/muneem';
import { auth } from '@/auth';
import { ContactsPanel } from './contacts-panel';
import { StatementsPanel } from './statements-panel';

export default async function ClientDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  if (!session || (session.user.role !== 'ca_admin' && session.user.role !== 'ca_staff') || !session.user.firmId) {
    redirect('/login');
  }

  const client = await db.query.clientOrgs.findFirst({
    where: and(eq(clientOrgs.id, id), eq(clientOrgs.firmId, session.user.firmId)),
  });
  if (!client) notFound();

  const contacts = await db.select().from(clientContacts).where(eq(clientContacts.clientOrgId, id));

  const statements = await db
    .select({
      id: bankStatements.id,
      filename: bankStatements.filename,
      status: bankStatements.status,
      periodStart: bankStatements.periodStart,
      periodEnd: bankStatements.periodEnd,
      currency: bankStatements.currency,
      createdAt: bankStatements.createdAt,
    })
    .from(bankStatements)
    .where(eq(bankStatements.clientOrgId, id))
    .orderBy(desc(bankStatements.createdAt));

  return (
    <div className="min-h-screen bg-neutral-100">
      <main className="mx-auto max-w-4xl space-y-6 px-6 py-8">
        <Link href="/dashboard" className="text-primary hover:text-primary-hover text-sm">
          ← Back to clients
        </Link>

        <div className="rounded-xl border border-neutral-200 bg-white p-6 shadow-sm">
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-2xl font-semibold text-neutral-900">{client.name}</h1>
              <p className="mt-1 text-sm text-neutral-500">
                {client.country} · {client.currency} ·{' '}
                <span className="inline-flex items-center rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-xs font-medium text-violet-700">
                  {client.taxRegime}
                </span>
              </p>
              {client.taxNumber && (
                <p className="mt-1 text-xs text-neutral-500">GSTIN: {client.taxNumber}</p>
              )}
            </div>
          </div>
        </div>

        <ContactsPanel
          clientOrgId={id}
          initialContacts={contacts.map((c) => ({
            id: c.id,
            name: c.name,
            email: c.email,
            hasAccount: c.hasAccount,
            inviteExpiresAt: c.inviteExpiresAt ? c.inviteExpiresAt.toISOString() : null,
            hasPendingInvite: !!c.inviteToken,
          }))}
        />

        <StatementsPanel
          clientOrgId={id}
          initial={statements.map((s) => ({
            id: s.id,
            filename: s.filename,
            status: s.status,
            periodStart: s.periodStart,
            periodEnd: s.periodEnd,
            currency: s.currency,
            createdAt: s.createdAt.toISOString(),
          }))}
        />
      </main>
    </div>
  );
}
