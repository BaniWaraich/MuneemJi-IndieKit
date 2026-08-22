import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import {
  accountantFirms,
  clientContacts,
  clientOrgs,
  clientProfiles,
  clientUsers,
} from "@/db/schema/muneem";
import { defaultClientProfileValues } from "@/lib/client-profile/default-profile-values";
import { ownerSignupSchema } from "@/lib/validations/owner-signup.schema";

const PLATFORM_FIRM_EMAIL = "platform-owners@muneemji.internal";
const PLATFORM_FIRM_NAME = "Muneem Ji";

async function getOrCreatePlatformFirm() {
  const existing = await db.query.accountantFirms.findFirst({
    where: eq(accountantFirms.email, PLATFORM_FIRM_EMAIL),
  });
  if (existing) return existing;

  const [created] = await db
    .insert(accountantFirms)
    .values({
      name: PLATFORM_FIRM_NAME,
      email: PLATFORM_FIRM_EMAIL,
      country: "IN",
    })
    .onConflictDoNothing({ target: accountantFirms.email })
    .returning();
  if (created) return created;

  const retry = await db.query.accountantFirms.findFirst({
    where: eq(accountantFirms.email, PLATFORM_FIRM_EMAIL),
  });
  if (!retry) throw new Error("Could not create platform firm");
  return retry;
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }
  const parsed = ownerSignupSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { name, businessName, email, password } = parsed.data;
  const emailNorm = email.toLowerCase();

  const existing = await db.query.clientUsers.findFirst({
    where: eq(clientUsers.email, emailNorm),
  });
  if (existing) {
    return NextResponse.json(
      { error: "An account with this email already exists" },
      { status: 409 },
    );
  }

  try {
    const firm = await getOrCreatePlatformFirm();
    const passwordHash = await bcrypt.hash(password, 12);

    await db.transaction(async (tx) => {
      const [org] = await tx
        .insert(clientOrgs)
        .values({
          firmId: firm.id,
          name: businessName,
          country: "IN",
          currency: "INR",
          taxRegime: "GST_INDIA",
        })
        .returning({ id: clientOrgs.id });

      const [contact] = await tx
        .insert(clientContacts)
        .values({
          clientOrgId: org.id,
          name,
          email: emailNorm,
          hasAccount: true,
        })
        .returning({ id: clientContacts.id });

      await tx.insert(clientUsers).values({
        contactId: contact.id,
        clientOrgId: org.id,
        email: emailNorm,
        name,
        passwordHash,
      });

      // D03 requires client_profiles — seed defaults until BO/CA completes O03.
      await tx.insert(clientProfiles).values({
        clientOrgId: org.id,
        ...defaultClientProfileValues({
          industry: businessName,
          description: `${businessName} — update your business profile for better classification.`,
        }),
      });
    });
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === "23505") {
      return NextResponse.json(
        { error: "An account with this email already exists" },
        { status: 409 },
      );
    }
    throw err;
  }

  return NextResponse.json({ ok: true, email: emailNorm }, { status: 201 });
}
