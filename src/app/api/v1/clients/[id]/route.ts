import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { clientOrgs, clientContacts } from '@/db/schema/muneem';
import {
  requireFirmSession,
  assertFirmOwnsClient,
  UnauthorizedError,
  ForbiddenError,
} from '@/lib/auth/tenant';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const session = await requireFirmSession();
    await assertFirmOwnsClient(session.firmId, id);

    const client = await db.query.clientOrgs.findFirst({
      where: eq(clientOrgs.id, id),
    });
    const contacts = await db
      .select()
      .from(clientContacts)
      .where(eq(clientContacts.clientOrgId, id));

    return NextResponse.json({ client, contacts });
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
