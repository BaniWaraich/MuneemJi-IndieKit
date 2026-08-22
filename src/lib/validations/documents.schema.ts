import { z } from "zod";
import { MAX_DOCUMENT_BYTES } from "@/lib/muneem-storage/document-upload";

export const createDocumentSchema = z.object({
  filename: z.string().min(1).max(255),
  contentType: z.string().min(1).max(127),
  fileSizeBytes: z.number().int().positive().max(MAX_DOCUMENT_BYTES),
});

export const confirmDocumentSchema = z.object({
  documentId: z.string().uuid(),
});
