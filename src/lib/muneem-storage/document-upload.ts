import crypto from "crypto";

/** Per-file hard limit for invoices/receipts (decimal 25 MB, per D04). */
export const MAX_DOCUMENT_BYTES = 25_000_000;

export const ALLOWED_DOCUMENT_CONTENT_TYPES = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/heic",
  "image/heif",
  "application/octet-stream",
] as const;

export type AllowedDocumentContentType =
  (typeof ALLOWED_DOCUMENT_CONTENT_TYPES)[number];

export function isAllowedDocumentContentType(
  contentType: string,
): contentType is AllowedDocumentContentType {
  return (ALLOWED_DOCUMENT_CONTENT_TYPES as readonly string[]).includes(
    contentType,
  );
}

export function fileTypeFromContentType(contentType: string): "pdf" | "image" {
  return contentType === "application/pdf" ? "pdf" : "image";
}

/** Basename only, no path separators, filename segment capped at 180 chars. */
export function sanitiseFilename(filename: string): string {
  const basename =
    filename.replace(/\\/g, "/").split("/").pop()?.replace(/\0/g, "").trim() ||
    "file";
  return basename.slice(0, 180) || "file";
}

export function documentS3Key(clientOrgId: string, filename: string): string {
  const sanitised = sanitiseFilename(filename);
  const stamp = Date.now();
  const rand = crypto.randomBytes(8).toString("hex");
  return `documents/${clientOrgId}/${stamp}-${rand}-${sanitised}`;
}
