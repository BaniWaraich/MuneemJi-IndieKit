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

  const timestamp = Math.floor(Date.now() / 1000).toString();
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
