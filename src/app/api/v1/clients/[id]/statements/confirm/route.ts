import { NextResponse } from 'next/server';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { bankStatements } from '@/db/schema/muneem';
import { requireFirmOrOwnerForClient, UnauthorizedError, ForbiddenError } from '@/lib/auth/tenant';
import { inngest } from '@/lib/inngest/client';

const schema = z.object({ statementId: z.string().uuid() });

const SKIP_VIRUS_SCAN = process.env.SKIP_VIRUS_SCAN === 'true';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    await requireFirmOrOwnerForClient(id);

    const body = await request.json();
    const result = schema.safeParse(body);
    if (!result.success) {
      return NextResponse.json(
        { error: 'Invalid input', details: result.error.flatten() },
        { status: 400 },
      );
    }

    const { statementId } = result.data;

    const statement = await db.query.bankStatements.findFirst({
      where: and(
        eq(bankStatements.id, statementId),
        eq(bankStatements.clientOrgId, id),
      ),
      columns: { id: true, scanStatus: true, status: true },
    });

    if (!statement) {
      return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    }

    if (statement.status !== 'processing') {
      return NextResponse.json({ error: 'ALREADY_PROCESSED' }, { status: 409 });
    }

    // In dev (SKIP_VIRUS_SCAN=true), the file was marked clean at insert time.
    // Fire the Inngest event immediately so the pipeline runs without ClamAV.
    if (SKIP_VIRUS_SCAN && statement.scanStatus === 'clean') {
      await inngest.send({
        name: 'muneem/statement.uploaded',
        data: { statementId },
      });
      return NextResponse.json({ queued: true });
    }

    // In prod the file is still pending scan. F03's ClamAV callback will flip
    // scan_status to 'clean' and fire muneem/statement.uploaded at that point.
    return NextResponse.json({ queued: false });
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
