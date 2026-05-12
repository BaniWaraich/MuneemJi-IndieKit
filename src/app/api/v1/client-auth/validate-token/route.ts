import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { clientContacts, clientOrgs } from '@/db/schema/muneem';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const token = url.searchParams.get('token');
  if (!token) {
    return NextResponse.json({ error: 'INVALID_TOKEN' }, { status: 400 });
  }

  const contact = await db.query.clientContacts.findFirst({
    where: eq(clientContacts.inviteToken, token),
  });
  if (!contact) {
    return NextResponse.json({ error: 'INVALID_TOKEN' }, { status: 404 });
  }
  if (contact.hasAccount) {
    return NextResponse.json({ error: 'ALREADY_ACCEPTED' }, { status: 410 });
  }
  if (!contact.inviteExpiresAt || contact.inviteExpiresAt < new Date()) {
    return NextResponse.json({ error: 'EXPIRED_TOKEN' }, { status: 410 });
  }

  const org = await db.query.clientOrgs.findFirst({
    where: eq(clientOrgs.id, contact.clientOrgId),
  });

  return NextResponse.json({
    contact: { name: contact.name, email: contact.email },
    org: { name: org?.name ?? '' },
    expiresAt: contact.inviteExpiresAt,
  });
}
