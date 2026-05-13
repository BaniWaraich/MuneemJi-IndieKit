import { NextResponse } from "next/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { HeadObjectCommand } from "@aws-sdk/client-s3";
import { db } from "@/db";
import { bankStatements } from "@/db/schema/muneem";
import {
  requireFirmOrOwnerForClient,
  UnauthorizedError,
  ForbiddenError,
} from "@/lib/auth/tenant";
import { inngest } from "@/lib/inngest/client";
import { s3Client, s3Bucket } from "@/lib/muneem-storage/s3";

const schema = z.object({ statementId: z.string().uuid() });

// 25 MB per-file cap, enforced via S3 HEAD here (not at F03). See F03 §7.
const MAX_STATEMENT_BYTES = 25 * 1024 * 1024;

const SKIP_VIRUS_SCAN = process.env.SKIP_VIRUS_SCAN === "true";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    await requireFirmOrOwnerForClient(id);

    const body = await request.json();
    const result = schema.safeParse(body);
    if (!result.success) {
      return NextResponse.json(
        { error: "Invalid input", details: result.error.flatten() },
        { status: 400 },
      );
    }

    const { statementId } = result.data;

    const statement = await db.query.bankStatements.findFirst({
      where: and(
        eq(bankStatements.id, statementId),
        eq(bankStatements.clientOrgId, id),
      ),
      columns: { id: true, scanStatus: true, status: true, s3Key: true },
    });

    if (!statement) {
      return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
    }

    if (statement.status !== "processing") {
      return NextResponse.json({ error: "ALREADY_PROCESSED" }, { status: 409 });
    }

    // Per-file size cap via S3 HEAD. Object must exist (client has PUT-ed by now).
    let contentLength: number | undefined;
    try {
      const head = await s3Client.send(
        new HeadObjectCommand({ Bucket: s3Bucket, Key: statement.s3Key }),
      );
      contentLength = head.ContentLength;
    } catch {
      return NextResponse.json({ error: "UPLOAD_NOT_FOUND" }, { status: 404 });
    }

    if (typeof contentLength !== "number") {
      return NextResponse.json({ error: "UPLOAD_NOT_FOUND" }, { status: 404 });
    }

    if (contentLength > MAX_STATEMENT_BYTES) {
      return NextResponse.json(
        {
          error: "FILE_TOO_LARGE",
          maxBytes: MAX_STATEMENT_BYTES,
          actualBytes: contentLength,
        },
        { status: 413 },
      );
    }

    // Hand off to F03. F03 owns scan_status transitions and the post-scan
    // `muneem/statement.cleared` emit. In dev SKIP_VIRUS_SCAN=true, F03's
    // orchestrator short-circuits to clean immediately.
    await inngest.send({
      name: "muneem/statement.received",
      data: { statementId },
    });

    return NextResponse.json({ queued: true, skipScan: SKIP_VIRUS_SCAN });
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
