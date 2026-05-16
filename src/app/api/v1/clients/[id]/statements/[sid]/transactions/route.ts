import { NextResponse } from 'next/server';
import { and, asc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { bankStatements, bankTransactions } from '@/db/schema/muneem';
import { requireFirmOrOwnerForClient, UnauthorizedError, ForbiddenError } from '@/lib/auth/tenant';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; sid: string }> },
) {
  try {
    const { id, sid } = await params;
    await requireFirmOrOwnerForClient(id);

    const statement = await db.query.bankStatements.findFirst({
      where: and(eq(bankStatements.id, sid), eq(bankStatements.clientOrgId, id)),
    });
    if (!statement) {
      return NextResponse.json({ error: 'STATEMENT_NOT_FOUND' }, { status: 404 });
    }

    const url = new URL(request.url);
    const limit = Math.min(Number(url.searchParams.get('limit') ?? 100), 500);
    const offset = Math.max(Number(url.searchParams.get('offset') ?? 0), 0);

    const rows = await db
      .select()
      .from(bankTransactions)
      .where(eq(bankTransactions.statementId, sid))
      .orderBy(asc(bankTransactions.transactionDate))
      .limit(limit)
      .offset(offset);

    return NextResponse.json({
      statement: {
        id: statement.id,
        filename: statement.filename,
        status: statement.status,
        errorMessage: statement.errorMessage,
        periodStart: statement.periodStart,
        periodEnd: statement.periodEnd,
        currency: statement.currency,
      },
      transactions: rows.map((r) => ({
        id: r.id,
        transactionDate: r.transactionDate,
        description: r.description,
        amountMinor: r.amountMinor.toString(),
        currency: r.currency,
        matchStatus: r.matchStatus,
      })),
    });
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
    }
    if (e instanceof ForbiddenError) {
      return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
    }
    throw e;
  }
}
