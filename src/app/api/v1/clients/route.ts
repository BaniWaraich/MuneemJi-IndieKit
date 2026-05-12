import { NextResponse } from 'next/server';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { clientOrgs } from '@/db/schema/muneem';
import { requireFirmSession, UnauthorizedError } from '@/lib/auth/tenant';
import { isValidGSTIN } from '@/lib/muneem-validation/india';

const COUNTRY_DEFAULTS = {
  IN: { currency: 'INR', taxRegime: 'GST_INDIA' as const },
  IE: { currency: 'EUR', taxRegime: 'VAT_EU' as const },
  CA: { currency: 'CAD', taxRegime: 'GST_HST_CANADA' as const },
};

const createSchema = z.object({
  name: z.string().min(1, 'Client name is required'),
  country: z.enum(['IN', 'IE', 'CA']).default('IN'),
  taxNumber: z.string().optional().nullable(),
});

export async function GET() {
  try {
    const session = await requireFirmSession();
    const rows = await db.select().from(clientOrgs).where(eq(clientOrgs.firmId, session.firmId));
    return NextResponse.json({ clients: rows });
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
    }
    throw e;
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireFirmSession();
    const body = await request.json();
    const result = createSchema.safeParse(body);
    if (!result.success) {
      return NextResponse.json(
        { error: 'Invalid input', details: result.error.flatten() },
        { status: 400 },
      );
    }
    const data = result.data;

    if (data.country === 'IN' && data.taxNumber && !isValidGSTIN(data.taxNumber)) {
      return NextResponse.json(
        {
          error: 'Invalid input',
          details: {
            fieldErrors: {
              taxNumber: ['GSTIN must be 15 characters (e.g. 22AAAAA0000A1Z5)'],
            },
            formErrors: [],
          },
        },
        { status: 400 },
      );
    }

    const { currency, taxRegime } = COUNTRY_DEFAULTS[data.country];
    const [row] = await db
      .insert(clientOrgs)
      .values({
        firmId: session.firmId,
        name: data.name,
        country: data.country,
        currency,
        taxRegime,
        taxNumber: data.taxNumber ?? null,
      })
      .returning();

    return NextResponse.json({ client: row }, { status: 201 });
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
    }
    throw e;
  }
}
