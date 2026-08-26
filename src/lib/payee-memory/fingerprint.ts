import { createHash } from "node:crypto";

const CHANNEL_PREFIX = /^(UPI|IMPS|NEFT|RTGS|NACH|ACH|FT|TPT|MMT)[-/:\s]+/;
const APP_TOKENS = new Set(["PAYTM", "PHONEPE", "GPAY", "GOOGLEPAY", "BHIM"]);
const NOISE_TOKENS = new Set([
  "TO",
  "FROM",
  "BY",
  "VIA",
  "PAYMENT",
  "TRANSFER",
  "TRF",
  "P2M",
  "P2P",
  "CR",
  "DR",
  "INR",
  "PAY",
]);

function isRefToken(token: string): boolean {
  const alnum = token.replace(/[^A-Z0-9]/g, "");
  if (!alnum) return true;
  if (/^\d{3,}$/.test(alnum)) return true;
  const digits = (alnum.match(/\d/g) ?? []).length;
  return digits > alnum.length * 0.6 && alnum.length >= 4;
}

/** Normalised cluster id. Same counterparty (noise aside) → same key. */
export function fingerprintPayee(description: string): string {
  let s = description.toUpperCase().replace(/\s+/g, " ").trim();
  for (let i = 0; i < 4; i++) {
    const next = s.replace(CHANNEL_PREFIX, "");
    if (next === s) break;
    s = next.trim();
  }

  if (s.includes("@")) {
    const local = s.split("@")[0] ?? s;
    const before = local.replace(/[^A-Z0-9 /:-]/g, " ").trim();
    s = before || s;
  }

  const parts = s
    .split(/[/:,\-_|]+/)
    .map((p) => p.trim())
    .filter((p) => p && !isRefToken(p.replace(/\s/g, "")));

  const tokens = parts
    .join(" ")
    .split(/\s+/)
    .map((t) => t.replace(/[^A-Z0-9]/g, ""))
    .filter((t) => t.length > 1 && !APP_TOKENS.has(t) && !NOISE_TOKENS.has(t));

  const key = tokens.join(" ").trim();
  if (!key) {
    return `raw:${createHash("sha256").update(description).digest("hex").slice(0, 16)}`;
  }
  return key;
}

export function titleCasePayee(payeeKey: string): string {
  if (payeeKey.startsWith("raw:")) return "Unknown payee";
  return payeeKey
    .toLowerCase()
    .split(" ")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
