import { createHmac } from "node:crypto";
import { env } from "./env";
import type { ScanResult } from "./scanner";

export async function postCallback(args: {
  s3Key: string;
  scanId: string;
  result: ScanResult;
}): Promise<void> {
  const body = JSON.stringify({
    s3Key: args.s3Key,
    scanId: args.scanId,
    status: args.result.status,
    reason: args.result.reason ?? undefined,
    scanProviderRef: args.result.providerRef,
  });

  // Vercel verifyScanCallback (src/lib/storage/scan-hmac.ts) parses the
  // timestamp with Date.parse and rejects anything outside ±5 min skew.
  // Must be ISO 8601 / RFC3339 UTC — unix seconds parse to NaN and 401.
  const timestamp = new Date().toISOString();
  const signature = createHmac("sha256", env.SCAN_CALLBACK_SECRET)
    .update(`${timestamp}.${body}`)
    .digest("hex");

  const res = await fetch(env.SCAN_CALLBACK_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-muneem-scan-timestamp": timestamp,
      "x-muneem-scan-sig": signature,
    },
    body,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`callback failed: ${res.status} ${text.slice(0, 200)}`);
  }
}
