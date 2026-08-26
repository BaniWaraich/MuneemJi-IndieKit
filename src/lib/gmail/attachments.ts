import type { gmail_v1 } from "googleapis";

export type PdfAttachmentRef = {
  filename: string;
  attachmentId: string;
};

function walk(
  part: gmail_v1.Schema$MessagePart | undefined,
  out: PdfAttachmentRef[],
): void {
  if (!part) return;
  const mime = (part.mimeType ?? "").toLowerCase();
  const filename = part.filename || "invoice.pdf";
  const attachmentId = part.body?.attachmentId;
  if (
    attachmentId &&
    (mime === "application/pdf" || filename.toLowerCase().endsWith(".pdf"))
  ) {
    out.push({ filename, attachmentId });
  }
  for (const child of part.parts ?? []) walk(child, out);
}

export function findPdfAttachments(
  message: gmail_v1.Schema$Message,
): PdfAttachmentRef[] {
  const out: PdfAttachmentRef[] = [];
  walk(message.payload, out);
  return out;
}

export function gmailDay(isoDate: string, deltaDays: number): string {
  const d = new Date(`${isoDate}T12:00:00+05:30`);
  if (Number.isNaN(d.getTime())) {
    const fallback = new Date();
    fallback.setDate(fallback.getDate() + deltaDays);
    return formatGmailDay(fallback);
  }
  d.setDate(d.getDate() + deltaDays);
  return formatGmailDay(d);
}

function formatGmailDay(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}/${m}/${day}`;
}

export function buildGmailInvoiceQuery(input: {
  displayName: string;
  periodStart: string | null;
  periodEnd: string | null;
}): string {
  const quoted = input.displayName.replace(/"/g, "");
  const parts = [`has:attachment filename:pdf "${quoted}"`];
  if (input.periodStart) {
    parts.push(`after:${gmailDay(input.periodStart, -7)}`);
  }
  if (input.periodEnd) {
    parts.push(`before:${gmailDay(input.periodEnd, 8)}`);
  }
  return parts.join(" ");
}
