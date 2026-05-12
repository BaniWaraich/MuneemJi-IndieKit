import { NextResponse } from "next/server";
import { z } from "zod";
import crypto from "crypto";
import { count, desc, eq, sum } from "drizzle-orm";
import { db } from "@/db";
import { bankStatements, clientOrgs } from "@/db/schema/muneem";
import {
  requireFirmOrOwnerForClient,
  UnauthorizedError,
  ForbiddenError,
} from "@/lib/auth/tenant";
import { presignPut } from "@/lib/muneem-storage/presign";

const MAX_STATEMENTS_PER_CLIENT = 50;
const MAX_STORAGE_BYTES_PER_FIRM = 500 * 1024 * 1024; // 500 MB

const schema = z.object({
  filename: z.string().min(1).max(255),
  contentType: z.string().min(1).max(127),
  fileSizeBytes: z
    .number()
    .int()
    .positive()
    .max(25 * 1024 * 1024), // 25 MB hard limit
});

// SKIP_VIRUS_SCAN skips ClamAV and marks uploads clean on ingest. Safe in dev
// and on Vercel preview deployments; catastrophic on the live production
// deployment — hard-fail if someone sets it there. Gate on VERCEL_ENV (not
// NODE_ENV) because Vercel forces NODE_ENV=production for every build,
// including previews.
if (
  process.env.VERCEL_ENV === "production" &&
  process.env.SKIP_VIRUS_SCAN === "true"
) {
  throw new Error(
    "SKIP_VIRUS_SCAN=true is forbidden on the production deployment",
  );
}
const SKIP_VIRUS_SCAN = process.env.SKIP_VIRUS_SCAN === "true";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const access = await requireFirmOrOwnerForClient(id);

    const body = await request.json();
    const result = schema.safeParse(body);
    if (!result.success) {
      return NextResponse.json(
        { error: "Invalid input", details: result.error.flatten() },
        { status: 400 },
      );
    }

    // Resolve firm ID for storage cap check.
    const clientOrg = await db.query.clientOrgs.findFirst({
      where: eq(clientOrgs.id, id),
      columns: { firmId: true },
    });
    if (!clientOrg) {
      return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
    }

    // Check per-client statement count cap.
    const [countRow] = await db
      .select({ n: count() })
      .from(bankStatements)
      .where(eq(bankStatements.clientOrgId, id));
    if ((countRow?.n ?? 0) >= MAX_STATEMENTS_PER_CLIENT) {
      return NextResponse.json(
        {
          error: "STORAGE_LIMIT_EXCEEDED",
          detail: "Client has reached the 50-statement limit.",
        },
        { status: 402 },
      );
    }

    // Check per-firm storage bytes cap by joining through clientOrgs.
    const firmClients = await db
      .select({ id: clientOrgs.id })
      .from(clientOrgs)
      .where(eq(clientOrgs.firmId, clientOrg.firmId));
    const firmClientIds = firmClients.map((c) => c.id);

    let firmStorageBytes = BigInt(0);
    if (firmClientIds.length > 0) {
      // Sum file sizes across all the firm's clients.
      for (const cid of firmClientIds) {
        const [sizeRow] = await db
          .select({ total: sum(bankStatements.fileSizeBytes) })
          .from(bankStatements)
          .where(eq(bankStatements.clientOrgId, cid));
        if (sizeRow?.total) {
          firmStorageBytes += BigInt(sizeRow.total);
        }
      }
    }
    if (
      firmStorageBytes + BigInt(result.data.fileSizeBytes) >
      BigInt(MAX_STORAGE_BYTES_PER_FIRM)
    ) {
      return NextResponse.json(
        {
          error: "STORAGE_LIMIT_EXCEEDED",
          detail: "Firm has reached the 500 MB storage limit.",
        },
        { status: 402 },
      );
    }

    const s3Key = `statements/${id}/${Date.now()}-${crypto.randomBytes(8).toString("hex")}-${result.data.filename}`;
    const uploadUrl = await presignPut(s3Key, result.data.contentType, 900);

    const [row] = await db
      .insert(bankStatements)
      .values({
        clientOrgId: id,
        uploadedByUser: access.kind === "firm" ? access.session.userId : null,
        uploadedByClient:
          access.kind === "owner" ? access.session.ownerId : null,
        s3Key,
        filename: result.data.filename,
        fileSizeBytes: BigInt(result.data.fileSizeBytes),
        currency: "INR",
        status: "processing",
        scanStatus: SKIP_VIRUS_SCAN ? "clean" : "pending",
      })
      .returning({ id: bankStatements.id });

    return NextResponse.json(
      { statementId: row.id, uploadUrl, s3Key },
      { status: 200 },
    );
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
    }
    if (e instanceof ForbiddenError) {
      return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
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
    await requireFirmOrOwnerForClient(id);

    const rows = await db
      .select({
        id: bankStatements.id,
        filename: bankStatements.filename,
        status: bankStatements.status,
        periodStart: bankStatements.periodStart,
        periodEnd: bankStatements.periodEnd,
        currency: bankStatements.currency,
        createdAt: bankStatements.createdAt,
      })
      .from(bankStatements)
      .where(eq(bankStatements.clientOrgId, id))
      .orderBy(desc(bankStatements.createdAt));

    return NextResponse.json({ statements: rows });
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
    }
    if (e instanceof ForbiddenError) {
      return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
    }
    throw e;
  }
}
