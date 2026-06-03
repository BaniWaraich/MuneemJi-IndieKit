import { NextResponse } from 'next/server';
import { and, asc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { bankTransactions } from '@/db/schema/muneem';
import { requireOwnerSession, UnauthorizedError } from '@/lib/auth/tenant';

export async function GET() {
  try {
    const session = await requireOwnerSession();

    const rows = await db
      .select({
        id: bankTransactions.id,
        transactionDate: bankTransactions.transactionDate,
        description: bankTransactions.description,
        amountMinor: bankTransactions.amountMinor,
        currency: bankTransactions.currency,
      })
      .from(bankTransactions)
      .where(
        and(
          eq(bankTransactions.clientOrgId, session.clientOrgId),
          eq(bankTransactions.matchStatus, 'unmatched'),
        ),
      )
      .orderBy(asc(bankTransactions.transactionDate));

    return NextResponse.json({
      transactions: rows.map((r) => ({ ...r, amountMinor: r.amountMinor.toString() })),
    });
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
    }
    throw e;
  }
}
