import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/db';
import { clientContacts } from '@/db/schema/muneem';
import {
  requireFirmSession,
  assertFirmOwnsClient,
  UnauthorizedError,
  ForbiddenError,
} from '@/lib/auth/tenant';

const schema = z.object({
  name: z.string().min(1, 'Contact name is required'),
  email: z.string().email('Enter a valid email address'),
});

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

    try {
      const [row] = await db
        .insert(clientContacts)
        .values({
          clientOrgId: id,
          name: result.data.name,
          email: result.data.email,
        })
        .returning();
      return NextResponse.json({ contact: row }, { status: 201 });
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      if (msg.includes('client_contacts_org_email')) {
        return NextResponse.json(
          {
            error: 'CONTACT_EMAIL_DUPLICATE',
            details: {
              fieldErrors: {
                email: ['This email is already a contact for this client'],
              },
              formErrors: [],
            },
          },
          { status: 400 },
        );
      }
      throw err;
    }
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
