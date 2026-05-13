/**
 * F03: scan.retry handler. Triggered by the scan-callback route when the AV
 * pipeline returned status='error' and we haven't yet hit MAX_ATTEMPTS.
 *
 *   Event:   "muneem/scan.retry"
 *   Payload: { rowTable, rowId, s3Key, attempt }
 *
 * Backoff is configured per-attempt (30s, then 5m) via Inngest's `step.sleep`.
 * On wake we re-trigger the AV pipeline. The actual Lambda re-invocation is
 * infra-owned (the F03 spec leaves the exact mechanism to AWS — e.g. an
 * S3 object-tag bump or a manual SQS message). For now this handler:
 *
 *   1. Sleeps for the backoff window.
 *   2. Updates scan_attempts (already incremented by the orchestrator on the
 *      first pass; the callback uses the snapshot at callback time, so we
 *      don't re-increment here).
 *   3. Logs a "retry queued" scan_log row.
 *
 * When the AV-pipeline re-trigger mechanism lands, replace the no-op TODO
 * with the actual side effect (e.g. SQS send or S3 tag).
 */

import { inngest } from "@/lib/inngest/client";
import { db } from "@/db";
import { scanLog } from "@/db/schema/muneem";

const BACKOFF_PER_ATTEMPT = ["30s", "5m"] as const;

export const scanRetry = inngest.createFunction(
  {
    id: "muneem-scan-retry",
    name: "Muneem: F03 Scan Retry",
    concurrency: { limit: 5 },
    retries: 0,
    triggers: [{ event: "muneem/scan.retry" }],
  },
  async ({
    event,
    step,
    logger,
  }: {
    event: {
      id: string;
      data: {
        rowTable: string;
        rowId: string;
        s3Key: string;
        attempt: number;
      };
    };
    step: {
      run: <T>(id: string, fn: () => Promise<T>) => Promise<T>;
      sleep: (id: string, duration: string) => Promise<void>;
    };
    logger: { info: (msg: string, ctx?: object) => void };
  }) => {
    const { rowTable, rowId, s3Key, attempt } = event.data;

    // attempt is the count AT THE TIME of the failing callback (0-indexed
    // into the backoff schedule).
    const backoffIndex = Math.min(attempt - 1, BACKOFF_PER_ATTEMPT.length - 1);
    const backoff = BACKOFF_PER_ATTEMPT[Math.max(0, backoffIndex)];

    await step.sleep("retry-backoff", backoff);

    await step.run("log-retry", async () => {
      await db.insert(scanLog).values({
        s3Key,
        attempt: attempt + 1,
        result: "ignored",
        reason: `retry_queued:${backoff}`,
        providerRef: null,
      });
    });

    // TODO: infra wiring — re-invoke the AV Lambda for s3Key. Owned by the
    // AWS-side of F03 (Lambda + ClamAV). Until that lands, the retry is a
    // no-op and the file will sit in 'scanning' until a callback eventually
    // arrives or oncall intervenes.
    logger.info("scan-retry: backoff elapsed, awaiting re-trigger", {
      rowTable,
      rowId,
      s3Key,
      attempt: attempt + 1,
    });

    // Reference inngest to avoid an unused-import lint warning until the
    // re-trigger send is added above.
    void inngest;
  },
);
