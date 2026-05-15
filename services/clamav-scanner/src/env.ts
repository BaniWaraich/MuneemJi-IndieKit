import { z } from "zod";

const schema = z.object({
  PORT: z.coerce.number().int().positive().default(8080),

  // Inbound auth — Vercel → scanner
  SCANNER_INBOUND_SECRET: z.string().min(16),

  // Outbound callback — scanner → Vercel
  SCAN_CALLBACK_URL: z.string().url(),
  SCAN_CALLBACK_SECRET: z.string().min(16),

  // clamd
  CLAMD_HOST: z.string().default("127.0.0.1"),
  CLAMD_PORT: z.coerce.number().int().positive().default(3310),

  // S3
  AWS_REGION: z.string(),
  S3_UPLOADS_BUCKET: z.string(),

  // Limits
  MAX_SCAN_BYTES: z.coerce.number().int().positive().default(26_214_400), // 25 MiB
  SCAN_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),
});

export type Env = z.infer<typeof schema>;

export const env: Env = schema.parse(process.env);
