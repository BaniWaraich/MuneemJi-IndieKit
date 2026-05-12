import Link from 'next/link';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { bankTransactions, clientOrgs } from '@/db/schema/muneem';
import { requireOwnerSession } from '@/lib/auth/tenant';

export default async function OwnerDashboard() {
  const session = await requireOwnerSession();

  const [org, [{ count }]] = await Promise.all([
    db.query.clientOrgs.findFirst({ where: eq(clientOrgs.id, session.clientOrgId) }),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(bankTransactions)
      .where(
        and(
          eq(bankTransactions.clientOrgId, session.clientOrgId),
          eq(bankTransactions.matchStatus, 'unmatched'),
        ),
      ),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold text-neutral-900">Welcome back.</h2>
        <p className="mt-1 text-sm text-neutral-500">
          You&apos;re signed in to <span className="font-medium">{org?.name}</span>.
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
            ? 'Nothing pending — upload a statement to get started.'
            : 'Transactions waiting for a matching invoice.'}
        </p>
      </Link>

      <div className="rounded-xl border border-neutral-200 bg-white p-6 shadow-sm">
        <h3 className="text-base font-medium text-neutral-900">Getting started</h3>
        <ul className="mt-3 space-y-2 text-sm text-neutral-700">
          <li>
            1. Upload your bank statement on the{' '}
            <Link href="/owner/statements" className="text-primary hover:text-primary-hover">
              Statements
            </Link>{' '}
            page.
          </li>
          <li>
            2. We&apos;ll list any transactions we couldn&apos;t match on the{' '}
            <Link href="/owner/pending" className="text-primary hover:text-primary-hover">
              Pending
            </Link>{' '}
            page.
          </li>
        </ul>
      </div>
    </div>
  );
}
