import { desc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { bankStatements } from '@/db/schema/muneem';
import { requireOwnerSession } from '@/lib/auth/tenant';
import { StatementsPanel } from '@/app/(accountant)/clients/[id]/statements-panel';

export default async function OwnerStatementsPage() {
  const session = await requireOwnerSession();

  const rows = await db
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
    .where(eq(bankStatements.clientOrgId, session.clientOrgId))
    .orderBy(desc(bankStatements.createdAt));

  const initial = rows.map((r) => ({
    ...r,
    createdAt: r.createdAt.toISOString(),
  }));

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold text-neutral-900">Statements</h2>
        <p className="mt-1 text-sm text-neutral-500">
          Upload your bank statement and we&apos;ll pull out each transaction automatically.
        </p>
      </div>
      <StatementsPanel
        clientOrgId={session.clientOrgId}
        initial={initial}
        detailHrefPrefix="/owner/statements"
      />
    </div>
  );
}
