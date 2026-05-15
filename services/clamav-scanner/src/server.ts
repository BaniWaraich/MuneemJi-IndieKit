import express from "express";
import pino from "pino";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { statSync } from "node:fs";
import { env } from "./env";
import { clamdPing, scanS3Object } from "./scanner";
import { postCallback } from "./callback";

const log = pino({ name: "clamav-scanner" });
const app = express();
app.use(express.json({ limit: "16kb" }));

const scanReqSchema = z.object({
  s3Key: z.string().min(1),
  scanId: z.string().min(1),
  attempt: z.number().int().positive().optional(),
  callbackUrl: z.string().url().optional(),
});

function requireBearer(req: express.Request, res: express.Response): boolean {
  const auth = req.header("authorization") ?? "";
  const expected = `Bearer ${env.SCANNER_INBOUND_SECRET}`;
  if (auth !== expected) {
    res.status(401).json({ error: "unauthorized" });
    return false;
  }
  return true;
}

app.get("/healthz", (_req, res) => {
  res.json({ ok: true });
});

app.get("/readyz", async (_req, res) => {
  const clamdOk = await clamdPing();
  let dbFreshMs = Number.POSITIVE_INFINITY;
  try {
    const st = statSync("/var/lib/clamav/daily.cvd");
    dbFreshMs = Date.now() - st.mtimeMs;
  } catch {
    try {
      const st = statSync("/var/lib/clamav/daily.cld");
      dbFreshMs = Date.now() - st.mtimeMs;
    } catch {
      /* no DB on disk yet */
    }
  }
  const dbFreshOk = dbFreshMs < 24 * 60 * 60 * 1000;
  const ready = clamdOk && dbFreshOk;
  res.status(ready ? 200 : 503).json({
    ready,
    clamd: clamdOk,
    signatureDbFreshHours: Number.isFinite(dbFreshMs)
      ? Math.round(dbFreshMs / 3_600_000)
      : null,
  });
});

app.post("/scan", async (req, res) => {
  if (!requireBearer(req, res)) return;

  const parsed = scanReqSchema.safeParse(req.body);
  if (!parsed.success) {
    return res
      .status(400)
      .json({ error: "bad_request", details: parsed.error.flatten() });
  }
  const { s3Key, scanId } = parsed.data;
  const providerRef = `railway-${randomUUID()}`;

  // Ack immediately; do the scan + callback asynchronously.
  res.status(202).json({ accepted: true, providerRef });

  setImmediate(async () => {
    log.info({ s3Key, scanId, providerRef }, "scan: started");
    try {
      const result = await scanS3Object(s3Key, providerRef);
      log.info({ s3Key, scanId, status: result.status }, "scan: complete");
      await postCallback({ s3Key, scanId, result });
    } catch (err) {
      log.error({ err, s3Key, scanId }, "scan: callback failed");
      // Best-effort error callback so Vercel can retry / mark error.
      try {
        await postCallback({
          s3Key,
          scanId,
          result: {
            status: "error",
            reason: `scanner_internal: ${(err as Error).message}`,
            providerRef,
          },
        });
      } catch (cbErr) {
        log.error({ err: cbErr }, "scan: error-callback also failed");
      }
    }
  });
});

app.listen(env.PORT, () => {
  log.info({ port: env.PORT }, "clamav-scanner listening");
});
