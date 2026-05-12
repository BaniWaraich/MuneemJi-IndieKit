import { NextResponse } from "next/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { clientOrgs, clientKnowledge } from "@/db/schema/muneem";
import { requireFirmSession, UnauthorizedError } from "@/lib/auth/tenant";

const paiseString = z
  .string()
  .regex(/^\d+$/, "Must be a non-negative integer (paise)");

const knowledgeSchema = z.object({
  knownVendors: z
    .array(
      z.object({
        name: z.string().min(1).max(100),
        description_patterns: z.array(z.string()).default([]),
        typical_amount_min_minor: paiseString.default("0"),
        typical_amount_max_minor: paiseString.default("0"),
        category: z.string().min(1).max(100),
        needs_invoice: z.boolean(),
        notes: z.string().max(300).optional(),
      }),
    )
    .default([]),
  knownCustomers: z
    .array(
      z.object({
        name: z.string().min(1).max(100),
        description_patterns: z.array(z.string()).default([]),
        typical_amount_min_minor: paiseString.default("0"),
        typical_amount_max_minor: paiseString.default("0"),
        notes: z.string().max(300).optional(),
      }),
    )
    .default([]),
  activeLoans: z
    .array(
      z.object({
        lender: z.string().min(1).max(100),
        description_pattern: z.string().min(1).max(200),
        approximate_amount_minor: paiseString,
        debit_day_of_month: z.number().int().min(1).max(31).nullable(),
        loan_type: z.enum(["term_loan", "vehicle", "equipment", "other"]),
        notes: z.string().max(300).optional(),
      }),
    )
    .default([]),
  seasonality: z
    .object({
      peak_months: z.array(z.number().int().min(1).max(12)),
      lean_months: z.array(z.number().int().min(1).max(12)),
      notes: z.string().max(300).optional(),
    })
    .nullable()
    .optional(),
  ownerDrawingsPattern: z
    .object({
      method: z.enum(["upi_transfer", "cash_withdrawal", "salary", "mixed"]),
      approximate_monthly_minor: paiseString,
      typical_description_pattern: z.string().max(200).optional(),
      notes: z.string().max(300).optional(),
    })
    .nullable()
    .optional(),
  cashDepositPattern: z
    .object({
      frequency: z.enum(["daily", "weekly", "fortnightly", "irregular"]),
      typical_amount_min_minor: paiseString,
      typical_amount_max_minor: paiseString,
      notes: z.string().max(300).optional(),
    })
    .nullable()
    .optional(),
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
    const result = knowledgeSchema.safeParse(body);
    if (!result.success) {
      return NextResponse.json(
        { error: "Invalid input", details: result.error.flatten() },
        { status: 400 },
      );
    }

    const d = result.data;
    await db
      .insert(clientKnowledge)
      .values({
        clientOrgId: id,
        knownVendors: d.knownVendors,
        knownCustomers: d.knownCustomers,
        activeLoans: d.activeLoans,
        seasonality: d.seasonality ?? null,
        ownerDrawingsPattern: d.ownerDrawingsPattern ?? null,
        cashDepositPattern: d.cashDepositPattern ?? null,
      })
      .onConflictDoUpdate({
        target: clientKnowledge.clientOrgId,
        set: {
          knownVendors: d.knownVendors,
          knownCustomers: d.knownCustomers,
          activeLoans: d.activeLoans,
          seasonality: d.seasonality ?? null,
          ownerDrawingsPattern: d.ownerDrawingsPattern ?? null,
          cashDepositPattern: d.cashDepositPattern ?? null,
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
