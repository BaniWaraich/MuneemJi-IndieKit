import Link from 'next/link';
import { notFound } from 'next/navigation';
import { and, asc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { bankStatements, bankTransactions } from '@/db/schema/muneem';
import { requireOwnerSession } from '@/lib/auth/tenant';
import { formatINR, formatDateIN } from '@/lib/format/inr';

export default async function OwnerStatementDetailPage({
  params,
}: {
  params: Promise<{ sid: string }>;
}) {
  const { sid } = await params;
  const session = await requireOwnerSession();

  const statement = await db.query.bankStatements.findFirst({
    where: and(eq(bankStatements.id, sid), eq(bankStatements.clientOrgId, session.clientOrgId)),
  });
  if (!statement) notFound();

  const txs = await db
    .select()
    .from(bankTransactions)
    .where(eq(bankTransactions.statementId, sid))
    .orderBy(asc(bankTransactions.transactionDate));

  return (
    <div className="space-y-6">
      <Link href="/owner/statements" className="text-primary hover:text-primary-hover text-sm">
        ← Back to Statements
      </Link>

      <div className="rounded-xl border border-neutral-200 bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-semibold text-neutral-900">{statement.filename}</h1>
        <p className="mt-1 text-sm text-neutral-500">
          {statement.periodStart && statement.periodEnd
            ? `${formatDateIN(statement.periodStart)} – ${formatDateIN(statement.periodEnd)} · `
            : ''}
          {statement.currency} · status:{' '}
          <span className="font-medium text-neutral-700">{statement.status}</span>
        </p>
        {statement.status === 'failed' && statement.errorMessage && (
          <p className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">
            {statement.errorMessage}
          </p>
        )}
      </div>

      <div className="rounded-xl border border-neutral-200 bg-white shadow-sm">
        <div className="border-b border-neutral-200 px-6 py-4">
          <h2 className="text-lg font-semibold text-neutral-900">Transactions ({txs.length})</h2>
        </div>
        {txs.length === 0 ? (
          <p className="px-6 py-6 text-sm text-neutral-500">
            {statement.status === 'processing'
              ? 'Parsing in progress — refresh in a moment.'
              : 'No transactions parsed from this statement.'}
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-neutral-100 text-xs text-neutral-700">
              <tr>
                <th className="px-6 py-2 text-left font-medium">Date</th>
                <th className="px-6 py-2 text-left font-medium">Description</th>
                <th className="px-6 py-2 text-right font-medium">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-200">
              {txs.map((t) => (
                <tr key={t.id}>
                  <td className="px-6 py-2 whitespace-nowrap text-neutral-700">
                    {formatDateIN(t.transactionDate)}
                  </td>
                  <td className="px-6 py-2 text-neutral-900">{t.description}</td>
                  <td
                    className={`px-6 py-2 text-right font-medium whitespace-nowrap ${
                      t.amountMinor < 0n ? 'text-red-600' : 'text-green-700'
                    }`}
                  >
                    {formatINR(t.amountMinor)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
