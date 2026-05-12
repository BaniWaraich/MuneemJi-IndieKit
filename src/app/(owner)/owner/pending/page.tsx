import { and, asc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { bankTransactions } from '@/db/schema/muneem';
import { requireOwnerSession } from '@/lib/auth/tenant';
import { formatINR, formatDateIN } from '@/lib/format/inr';

export default async function OwnerPendingPage() {
  const session = await requireOwnerSession();

  const txs = await db
    .select()
    .from(bankTransactions)
    .where(
      and(
        eq(bankTransactions.clientOrgId, session.clientOrgId),
        eq(bankTransactions.matchStatus, 'unmatched'),
      ),
    )
    .orderBy(asc(bankTransactions.transactionDate));

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold text-neutral-900">Pending items</h2>
        <p className="mt-1 text-sm text-neutral-500">
          Transactions we found on your statement that don&apos;t have a matching invoice yet.
          Upload an invoice for these in the next step.
        </p>
      </div>

      <div className="rounded-xl border border-neutral-200 bg-white shadow-sm">
        {txs.length === 0 ? (
          <p className="px-6 py-6 text-sm text-neutral-500">
            Nothing pending. Upload a statement to see transactions here.
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
