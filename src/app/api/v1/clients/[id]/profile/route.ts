import { NextResponse } from "next/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { clientOrgs, clientProfiles } from "@/db/schema/muneem";
import { requireFirmSession, UnauthorizedError } from "@/lib/auth/tenant";

const bankAccountSchema = z.object({
  account_label: z.string().min(1).max(100),
  bank_name: z.string().min(1).max(100),
  account_number_last4: z.string().regex(/^\d{4}$/, "Must be exactly 4 digits"),
  is_primary_operating: z.boolean(),
  notes: z.string().max(200).optional(),
});

const profileSchema = z.object({
  legalStructure: z.enum([
    "sole_proprietorship",
    "partnership",
    "llp",
    "private_limited",
    "public_limited",
    "trust",
    "other",
  ]),
  businessType: z.enum(["manufacturer", "trader", "service_provider", "mixed"]),
  industry: z.string().min(1).max(100),
  description: z.string().min(1).max(500),
  gstRegistrationType: z.enum([
    "regular",
    "composition",
    "exempt",
    "unregistered",
  ]),
  primaryTransactionMode: z.enum(["mostly_digital", "mixed", "cash_heavy"]),
  invoiceSoftware: z.enum([
    "tally",
    "busy",
    "zoho_books",
    "quickbooks",
    "manual",
    "other",
  ]),
  hasInterCompanyTransactions: z.boolean(),
  bankAccounts: z
    .array(bankAccountSchema)
    .min(1, "At least one bank account is required")
    .refine((arr) => arr.some((a) => a.is_primary_operating), {
      message: "At least one account must be marked as primary operating",
    }),
});

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const session = await requireFirmSession();

    const client = await db.query.clientOrgs.findFirst({
      where: and(eq(clientOrgs.id, id), eq(clientOrgs.firmId, session.firmId)),
      columns: { id: true },
    });
    if (!client) {
      return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
    }

    const body = await request.json();
    const result = profileSchema.safeParse(body);
    if (!result.success) {
      return NextResponse.json(
        { error: "Invalid input", details: result.error.flatten() },
        { status: 400 },
      );
    }

    const d = result.data;
    await db
      .insert(clientProfiles)
      .values({
        clientOrgId: id,
        legalStructure: d.legalStructure,
        businessType: d.businessType,
        industry: d.industry,
        description: d.description,
        gstRegistrationType: d.gstRegistrationType,
        primaryTransactionMode: d.primaryTransactionMode,
        invoiceSoftware: d.invoiceSoftware,
        hasInterCompanyTransactions: d.hasInterCompanyTransactions,
        bankAccounts: d.bankAccounts,
      })
      .onConflictDoUpdate({
        target: clientProfiles.clientOrgId,
        set: {
          legalStructure: d.legalStructure,
          businessType: d.businessType,
          industry: d.industry,
          description: d.description,
          gstRegistrationType: d.gstRegistrationType,
          primaryTransactionMode: d.primaryTransactionMode,
          invoiceSoftware: d.invoiceSoftware,
          hasInterCompanyTransactions: d.hasInterCompanyTransactions,
          bankAccounts: d.bankAccounts,
          updatedAt: new Date(),
        },
      });

    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
    }
    throw e;
  }
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const session = await requireFirmSession();

    const client = await db.query.clientOrgs.findFirst({
      where: and(eq(clientOrgs.id, id), eq(clientOrgs.firmId, session.firmId)),
      columns: { id: true },
    });
    if (!client) {
      return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
    }

    const profile = await db.query.clientProfiles.findFirst({
      where: eq(clientProfiles.clientOrgId, id),
    });

    return NextResponse.json({ profile: profile ?? null });
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
    }
    throw e;
  }
}
