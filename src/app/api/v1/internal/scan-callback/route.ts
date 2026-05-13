/**
 * F03: AV scan callback. Invoked by the ClamAV Lambda after a verdict is
 * available. HMAC-signed; the signature + timestamp are verified BEFORE any
 * DB I/O.
 *
 * Flow:
 *   1. Verify HMAC + freshness. 401 on failure.
 *   2. Resolve the owning bank_statements row from s3Key. 404 if unknown.
 *   3. Idempotency guard: only act if scan_status ∈ {pending, scanning}.
 *      Otherwise write an 'ignored' scan_log row and 409.
 *   4. Apply the transition for the given status:
 *        - clean   -> scan_status=clean; emit muneem/statement.cleared
 *        - infected-> quarantine S3 object; scan_status=infected; update
 *                     s3_key + quarantined_at; emit muneem/scan.infected
 *        - error   -> if attempt < 3, emit muneem/scan.retry; else
 *                     scan_status=error, emit muneem/statement.scan.failed.
 *                     No quarantine on error.
 *   5. Always write a scan_log row capturing this callback.
 */

import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { bankStatements, scanLog } from "@/db/schema/muneem";
import { inngest } from "@/lib/inngest/client";
import { verifyScanCallback } from "@/lib/storage/scan-hmac";
import { quarantineS3Object } from "@/lib/storage/quarantine";

export const dynamic = "force-dynamic";

const MAX_ATTEMPTS = 3;

const bodySchema = z.object({
  s3Key: z.string().min(1),
  status: z.enum(["clean", "infected", "error"]),
  reason: z.string().max(500).optional(),
  scanProviderRef: z.string().min(1),
});

export async function POST(request: Request) {
  // 1. HMAC verify — done from raw body BEFORE parsing JSON.
  const rawBody = await request.text();
  const verdict = verifyScanCallback({
    rawBody,
    signature: request.headers.get("x-muneem-scan-sig"),
    timestamp: request.headers.get("x-muneem-scan-timestamp"),
  });
  if (!verdict.ok) {
    return NextResponse.json(
      { error: "UNAUTHORIZED", reason: verdict.reason },
      { status: 401 },
    );
  }

  // Parse JSON only after HMAC passes.
  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "BAD_JSON" }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(parsedBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "BAD_BODY", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const { s3Key, status, reason, scanProviderRef } = parsed.data;

  // 2. Resolve owning row. Today only bank_statements; future tables (invoices,
  // bo_docs) will join here.
  const statement = await db.query.bankStatements.findFirst({
    where: eq(bankStatements.s3Key, s3Key),
    columns: {
      id: true,
      s3Key: true,
      scanStatus: true,
      scanAttempts: true,
    },
  });

  if (!statement) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }

  // 3. Idempotency guard.
  if (
    statement.scanStatus !== "pending" &&
    statement.scanStatus !== "scanning"
  ) {
    await db.insert(scanLog).values({
      s3Key,
      attempt: statement.scanAttempts,
      result: "ignored",
      reason: `terminal_state:${statement.scanStatus}`,
      providerRef: scanProviderRef,
    });
    return NextResponse.json(
      { error: "TERMINAL_STATE", scanStatus: statement.scanStatus },
      { status: 409 },
    );
  }

  // 4. Apply transition.
  if (status === "clean") {
    await db
      .update(bankStatements)
      .set({ scanStatus: "clean" })
      .where(eq(bankStatements.id, statement.id));

    await db.insert(scanLog).values({
      s3Key,
      attempt: statement.scanAttempts,
      result: "clean",
      reason: reason ?? null,
      providerRef: scanProviderRef,
    });

    await inngest.send({
      name: "muneem/statement.cleared",
      data: { statementId: statement.id },
    });

    return NextResponse.json({ ok: true });
  }

  if (status === "infected") {
    let quarantineKey = statement.s3Key;
    try {
      quarantineKey = await quarantineS3Object(statement.s3Key);
    } catch (err) {
      // Quarantine failed — keep going so the row is marked infected even
      // if the object move failed. Forensic cleanup is handled by the S3
      // lifecycle backstop. F03 §10 S3_QUARANTINE_FAILED.
      await db.insert(scanLog).values({
        s3Key,
        attempt: statement.scanAttempts,
        result: "error",
        reason: `quarantine_failed:${(err as Error).message}`.slice(0, 500),
        providerRef: scanProviderRef,
      });
    }

    await db
      .update(bankStatements)
      .set({
        scanStatus: "infected",
        s3Key: quarantineKey,
        quarantinedAt: new Date(),
      })
      .where(eq(bankStatements.id, statement.id));

    await db.insert(scanLog).values({
      s3Key,
      attempt: statement.scanAttempts,
      result: "infected",
      reason: reason ?? null,
      providerRef: scanProviderRef,
    });

    await inngest.send({
      name: "muneem/scan.infected",
      data: {
        rowTable: "bank_statements",
        rowId: statement.id,
        s3Key,
        reason: reason ?? null,
      },
    });

    return NextResponse.json({ ok: true });
  }

  // status === 'error'
  await db.insert(scanLog).values({
    s3Key,
    attempt: statement.scanAttempts,
    result: "error",
    reason: reason ?? null,
    providerRef: scanProviderRef,
  });

  if (statement.scanAttempts < MAX_ATTEMPTS) {
    await inngest.send({
      name: "muneem/scan.retry",
      data: {
        rowTable: "bank_statements",
        rowId: statement.id,
        s3Key,
        attempt: statement.scanAttempts,
      },
    });
    // Keep scan_status as 'scanning' while retries are in flight.
    return NextResponse.json({ ok: true, retried: true });
  }

  // Terminal error.
  await db
    .update(bankStatements)
    .set({ scanStatus: "error" })
    .where(eq(bankStatements.id, statement.id));

  await inngest.send({
    name: "muneem/statement.scan.failed",
    data: {
      rowTable: "bank_statements",
      rowId: statement.id,
      s3Key,
      attempts: statement.scanAttempts,
      lastReason: reason ?? null,
    },
  });

  return NextResponse.json({ ok: true, terminal: true });
}
