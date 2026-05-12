import { NextResponse } from 'next/server';
import { z } from 'zod';
import crypto from 'crypto';
import { desc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { bankStatements } from '@/db/schema/muneem';
import { requireFirmOrOwnerForClient, UnauthorizedError, ForbiddenError } from '@/lib/auth/tenant';
import { presignPut } from '@/lib/muneem-storage/presign';

const schema = z.object({
  filename: z.string().min(1).max(255),
  contentType: z.string().min(1).max(127),
});

// SKIP_VIRUS_SCAN skips ClamAV and marks uploads clean on ingest. Safe in dev,
// catastrophic in prod — hard-fail if someone sets it there.
if (process.env.NODE_ENV === 'production' && process.env.SKIP_VIRUS_SCAN === 'true') {
  throw new Error('SKIP_VIRUS_SCAN=true is forbidden in production');
}
const SKIP_VIRUS_SCAN = process.env.SKIP_VIRUS_SCAN === 'true';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const access = await requireFirmOrOwnerForClient(id);

    const body = await request.json();
    const result = schema.safeParse(body);
    if (!result.success) {
      return NextResponse.json(
        { error: 'Invalid input', details: result.error.flatten() },
        { status: 400 },
      );
    }

    const s3Key = `statements/${id}/${Date.now()}-${crypto.randomBytes(8).toString('hex')}-${result.data.filename}`;
    const uploadUrl = await presignPut(s3Key, result.data.contentType, 900);

    const [row] = await db
      .insert(bankStatements)
      .values({
        clientOrgId: id,
        uploadedByUser: access.kind === 'firm' ? access.session.userId : null,
        uploadedByClient: access.kind === 'owner' ? access.session.ownerId : null,
        s3Key,
        filename: result.data.filename,
        currency: 'INR',
        status: 'processing',
        scanStatus: SKIP_VIRUS_SCAN ? 'clean' : 'pending',
      })
      .returning({ id: bankStatements.id });

    return NextResponse.json({ statementId: row.id, uploadUrl, s3Key }, { status: 200 });
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

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    await requireFirmOrOwnerForClient(id);

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
      .where(eq(bankStatements.clientOrgId, id))
      .orderBy(desc(bankStatements.createdAt));

    return NextResponse.json({ statements: rows });
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
