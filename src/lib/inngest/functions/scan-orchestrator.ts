/**
 * F03: File Upload & Virus Scan — scan orchestrator.
 *
 * Event: "muneem/statement.received"  (emitted by D01 confirm route)
 * Payload: { statementId: string }
 *
 * Responsibilities:
 *   - Transition scan_status: pending -> scanning, increment scan_attempts.
 *   - Append a row to scan_log.
 *   - In dev with SKIP_VIRUS_SCAN=true: short-circuit to 'clean' and emit
 *     "muneem/statement.cleared" so the pipeline runs without ClamAV.
 *   - In prod: POST { s3Key, scanId, callbackUrl } to the Railway scanner at
 *     $SCANNER_URL/scan with Authorization: Bearer $SCANNER_INBOUND_SECRET.
 *     The verdict arrives asynchronously at /api/v1/internal/scan-callback.
 *
 * Module-load assertion: SKIP_VIRUS_SCAN=true must NEVER reach production.
 * Mirrors the guard at the presign route; F03 spec §7 centralises it here.
 */

import { eq } from "drizzle-orm";
import { inngest } from "@/lib/inngest/client";
import { db } from "@/db";
import { bankStatements, scanLog } from "@/db/schema/muneem";

const SKIP_VIRUS_SCAN = process.env.SKIP_VIRUS_SCAN === "true";

if (SKIP_VIRUS_SCAN && process.env.VERCEL_ENV === "production") {
  throw new Error(
    "SKIP_VIRUS_SCAN=true is forbidden when VERCEL_ENV=production (F03 §7)",
  );
}

export const scanOrchestrator = inngest.createFunction(
  {
    id: "muneem-scan-orchestrator",
    name: "Muneem: F03 Scan Orchestrator",
    concurrency: { limit: 5 },
    retries: 3,
    triggers: [{ event: "muneem/statement.received" }],
  },
  async ({
    event,
    step,
    logger,
  }: {
    event: { id: string; data: { statementId: string } };
    step: { run: <T>(id: string, fn: () => Promise<T>) => Promise<T> };
    logger: { info: (msg: string, ctx?: object) => void };
  }) => {
    const { statementId } = event.data;

    const transition = await step.run("transition-to-scanning", async () => {
      const statement = await db.query.bankStatements.findFirst({
        where: eq(bankStatements.id, statementId),
        columns: {
          id: true,
          s3Key: true,
          scanStatus: true,
          scanAttempts: true,
        },
      });
      if (!statement) {
        throw new Error(`statement ${statementId} not found`);
      }

      // Idempotency: only act if scan_status is in {pending, scanning}.
      // Terminal states (clean / infected / error) are immutable here; the
      // callback's idempotency guard handles late retries the same way.
      if (
        statement.scanStatus !== "pending" &&
        statement.scanStatus !== "scanning"
      ) {
        logger.info("scan-orchestrator: terminal state, no-op", {
          statementId,
          scanStatus: statement.scanStatus,
        });
        return {
          skip: true as const,
          s3Key: statement.s3Key,
          attempt: statement.scanAttempts,
        };
      }

      const nextAttempt = statement.scanAttempts + 1;
      await db
        .update(bankStatements)
        .set({ scanStatus: "scanning", scanAttempts: nextAttempt })
        .where(eq(bankStatements.id, statementId));

      await db.insert(scanLog).values({
        s3Key: statement.s3Key,
        attempt: nextAttempt,
        result: "ignored",
        reason: "transition_to_scanning",
        providerRef: null,
      });

      return {
        skip: false as const,
        s3Key: statement.s3Key,
        attempt: nextAttempt,
      };
    });

    if (transition.skip) return;

    // Dev path: no AV pipeline. Flip straight to clean and emit downstream.
    // In prod this branch is unreachable (guard at module load).
    if (SKIP_VIRUS_SCAN) {
      await step.run("dev-skip-mark-clean", async () => {
        await db
          .update(bankStatements)
          .set({ scanStatus: "clean" })
          .where(eq(bankStatements.id, statementId));

        await db.insert(scanLog).values({
          s3Key: transition.s3Key,
          attempt: transition.attempt,
          result: "clean",
          reason: "SKIP_VIRUS_SCAN",
          providerRef: "dev-skip",
        });
      });

      await step.run("dev-emit-cleared", async () => {
        await inngest.send({
          name: "muneem/statement.cleared",
          data: { statementId },
        });
      });

      logger.info("scan-orchestrator: dev-skip cleared", { statementId });
      return;
    }

    // Prod: dispatch to the Railway scanner. The verdict arrives later at
    // /api/v1/internal/scan-callback, which drives the next transition.
    const scannerUrl = process.env.SCANNER_URL;
    const scannerInboundSecret = process.env.SCANNER_INBOUND_SECRET;
    const scanCallbackUrl = process.env.SCAN_CALLBACK_URL;
    if (!scannerUrl || !scannerInboundSecret || !scanCallbackUrl) {
      throw new Error(
        "SCANNER_URL, SCANNER_INBOUND_SECRET, SCAN_CALLBACK_URL must be set (F03 Railway scanner)",
      );
    }

    await step.run("dispatch-to-railway-scanner", async () => {
      const res = await fetch(`${scannerUrl.replace(/\/$/, "")}/scan`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${scannerInboundSecret}`,
        },
        body: JSON.stringify({
          s3Key: transition.s3Key,
          scanId: `${statementId}:${transition.attempt}`,
          attempt: transition.attempt,
          callbackUrl: scanCallbackUrl,
        }),
      });
      if (!res.ok) {
        // Surface a retriable error so Inngest's function-level retries kick in.
        const body = await res.text().catch(() => "");
        throw new Error(
          `Railway scanner dispatch failed: ${res.status} ${body.slice(0, 200)}`,
        );
      }
    });

    logger.info("scan-orchestrator: dispatched to Railway scanner", {
      statementId,
      attempt: transition.attempt,
    });
  },
);
