import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import clamd from "clamdjs";
import type { Readable } from "node:stream";
import { env } from "./env";

const s3 = new S3Client({ region: env.AWS_REGION });
const scanner = clamd.createScanner(env.CLAMD_HOST, env.CLAMD_PORT);

export type ScanResult =
  | { status: "clean"; reason: null; providerRef: string }
  | { status: "infected"; reason: string; providerRef: string }
  | { status: "error"; reason: string; providerRef: string };

export async function scanS3Object(
  s3Key: string,
  providerRef: string,
): Promise<ScanResult> {
  let body: Readable;
  try {
    const obj = await s3.send(
      new GetObjectCommand({ Bucket: env.S3_UPLOADS_BUCKET, Key: s3Key }),
    );
    body = obj.Body as Readable;
  } catch (err) {
    return {
      status: "error",
      reason: `s3_get_failed: ${(err as Error).message}`,
      providerRef,
    };
  }

  try {
    // clamdjs INSTREAM: no disk landing. Throws on transport errors; returns
    // a verdict string otherwise.
    const verdict = await scanner.scanStream(body, env.SCAN_TIMEOUT_MS);
    if (clamd.isCleanReply(verdict)) {
      return { status: "clean", reason: null, providerRef };
    }
    return {
      status: "infected",
      reason: verdict.trim(),
      providerRef,
    };
  } catch (err) {
    return {
      status: "error",
      reason: `clamd_failed: ${(err as Error).message}`,
      providerRef,
    };
  }
}

export async function clamdPing(): Promise<boolean> {
  try {
    return await clamd.ping(env.CLAMD_HOST, env.CLAMD_PORT, 5_000);
  } catch {
    return false;
  }
}
