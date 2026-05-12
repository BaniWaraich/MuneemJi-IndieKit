import { NextResponse } from 'next/server';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { clientContacts, clientUsers } from '@/db/schema/muneem';

const schema = z.object({
  token: z.string().min(1),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

export async function POST(request: Request) {
  const body = await request.json();
  const result = schema.safeParse(body);
  if (!result.success) {
    return NextResponse.json(
      { error: 'Invalid input', details: result.error.flatten() },
      { status: 400 },
    );
  }

  const { token, password } = result.data;

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

  const existing = await db.query.clientUsers.findFirst({
    where: eq(clientUsers.email, contact.email),
  });
  if (existing) {
    return NextResponse.json({ error: 'EMAIL_ALREADY_REGISTERED' }, { status: 400 });
  }

  const passwordHash = await bcrypt.hash(password, 12);

  await db.insert(clientUsers).values({
    contactId: contact.id,
    clientOrgId: contact.clientOrgId,
    email: contact.email,
    name: contact.name,
    passwordHash,
  });

  await db
    .update(clientContacts)
    .set({ hasAccount: true, inviteToken: null, inviteExpiresAt: null })
    .where(eq(clientContacts.id, contact.id));

  return NextResponse.json({ ok: true, email: contact.email }, { status: 201 });
}
