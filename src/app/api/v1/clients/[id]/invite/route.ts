import { NextResponse } from 'next/server';
import { z } from 'zod';
import crypto from 'crypto';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { clientContacts, clientOrgs } from '@/db/schema/muneem';
import { users } from '@/db/schema/user';
import {
  requireFirmSession,
  assertFirmOwnsClient,
  UnauthorizedError,
  ForbiddenError,
} from '@/lib/auth/tenant';
import { sendInviteEmail } from '@/lib/email/send-invite';

const schema = z.object({
  contactId: z.string().uuid(),
});

const INVITE_TTL_DAYS = 7;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const session = await requireFirmSession();
    await assertFirmOwnsClient(session.firmId, id);

    const body = await request.json();
    const result = schema.safeParse(body);
    if (!result.success) {
      return NextResponse.json(
        { error: 'Invalid input', details: result.error.flatten() },
        { status: 400 },
      );
    }

    const contact = await db.query.clientContacts.findFirst({
      where: and(eq(clientContacts.id, result.data.contactId), eq(clientContacts.clientOrgId, id)),
    });
    if (!contact) {
      return NextResponse.json({ error: 'CONTACT_NOT_FOUND' }, { status: 404 });
    }
    if (contact.hasAccount) {
      return NextResponse.json({ error: 'CONTACT_ALREADY_HAS_ACCOUNT' }, { status: 400 });
    }

    const token = crypto.randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000);

    await db
      .update(clientContacts)
      .set({ inviteToken: token, inviteExpiresAt: expiresAt })
      .where(eq(clientContacts.id, contact.id));

    const org = await db.query.clientOrgs.findFirst({ where: eq(clientOrgs.id, id) });
    const accountant = await db.query.users.findFirst({
      where: eq(users.id, session.userId),
    });

    const baseUrl = process.env.NEXTAUTH_URL || `http://localhost:${process.env.PORT || 3000}`;
    const inviteUrl = `${baseUrl}/invite/${token}`;

    await sendInviteEmail({
      to: contact.email,
      inviteUrl,
      orgName: org?.name ?? 'your organisation',
      accountantName: accountant?.name ?? 'your accountant',
      expiresAt,
    });

    return NextResponse.json({ ok: true, expiresAt }, { status: 200 });
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
