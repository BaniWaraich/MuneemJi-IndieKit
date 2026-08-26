const CHANNEL = /\b(UPI|IMPS|NEFT|RTGS)\b/i;
const CORP = new Set([
  "PVT",
  "LTD",
  "LLP",
  "LLC",
  "INC",
  "PRIVATE",
  "LIMITED",
  "SERVICES",
  "SOLUTIONS",
  "TECHNOLOGIES",
  "ENTERPRISES",
]);

/** Person-name IMPS/UPI/NEFT cluster — not a known merchant. */
export function isPersonNameTransfer(
  originalDescription: string,
  payeeKey: string,
  isMerchant: boolean,
): boolean {
  if (isMerchant) return false;
  if (!CHANNEL.test(originalDescription)) return false;
  if (payeeKey.startsWith("raw:")) return false;
  const words = payeeKey
    .split(/\s+/)
    .filter((w) => /^[A-Z]+$/.test(w) && w.length >= 2);
  if (words.length < 2 || words.length > 4) return false;
  if (words.some((w) => CORP.has(w))) return false;
  return true;
}
