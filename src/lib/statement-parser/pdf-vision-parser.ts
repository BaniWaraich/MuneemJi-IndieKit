import OpenAI from "openai";
import { extractCodeBlock } from "./extract-code-block";
import { pageResultSchema, type PageResult } from "./page-schema";

export const PDF_VISION_MODEL = "gpt-4o";
const LLM_TIMEOUT_MS = 45_000;

export class PdfVisionParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PdfVisionParseError";
  }
}

const PDF_VISION_PROMPT = `You are a bookkeeping assistant. The user will attach a photograph / scan
of ONE page of a bank-statement PDF. Read the page visually — columns are
laid out spatially, not as commas. Use vertical alignment of values across
rows to tell narration from debit/credit/balance. NEVER split a row on
commas: commas appear inside narrations and inside amounts as thousands
separators (e.g. "1,00,000.00"). They are not field separators.

This page may contain: header preamble, part of the transaction table,
or a footer summary block. Your job: extract every transaction row that
appears on THIS page, in the order they appear, and return a single
JSON object — no prose, no markdown fences.

Output shape (return exactly this object):
{
  "currency": "INR" | null,
  "transactions": [
    {
      "date": "YYYY-MM-DD",
      "description": string,
      "debit": number | null,
      "credit": number | null,
      "balance": number | null
    }
  ]
}

Rules:
- Return an empty transactions array if this page has no transaction rows (pure preamble, pure footer, blank, or unreadable).
- Skip explicit "Opening Balance" / "B/F" / "Brought Forward" rows and footer summary blocks ("Statement Summary", "Total Withdrawals", etc.). These are not transactions.
- One output object per transaction row. Do not merge transaction rows.
- When a physical line has no date and no debit/credit/balance values — only narration text — it is a continuation of the previous transaction's narration. Append it to the previous transaction's description; do not emit it as a separate transaction.
- Exactly one of debit / credit is non-null per row. The other must be null. Never put 0 — use null.
- Preserve the original narration / description text exactly. Do not summarise, translate, or strip prefixes like UPI-, NEFT-, IMPS-.
- Date variations to tolerate: DD/MM/YY, DD/MM/YYYY, DD-MMM-YYYY, DD MMM YY, YYYY-MM-DD. Normalise output to YYYY-MM-DD.
- Amount cleaning: ignore currency symbols (₹, Rs, INR, $, €) and thousands-separator commas; strip trailing "Cr" / "Dr" markers ("Cr" → credit, "Dr" → debit). When no marker is present, infer from column position (e.g. a "Withdrawal Amt" column → debit; a "Deposit Amt" column → credit).
- currency: ISO 4217 — ₹/Rs/INR → "INR", €/EUR → "EUR", $/CAD/USD inferred from context. Return null if this page has no clear currency signal.
- balance: Some banks print the running-balance cell only on certain rows. When the cell is blank, emit "balance": null. Do NOT guess.

Return the JSON object only. No explanation. No markdown fences.`;

type ChatClient = {
  chat: {
    completions: {
      create: (
        body: unknown,
        opts?: { timeout?: number; signal?: AbortSignal },
      ) => Promise<{
        choices: Array<{ message?: { content?: string | null } | null }>;
      }>;
    };
  };
};

let _openai: ChatClient | undefined;
const getOpenAI = (): ChatClient =>
  (_openai ??= new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    maxRetries: 0,
  }) as ChatClient);

export function setPdfVisionClientForTests(
  client: ChatClient | undefined,
): void {
  _openai = client;
}

/**
 * Read one rasterized statement page with GPT-4o vision.
 * Caller must not persist `jpegBase64`.
 */
export async function extractScannedPageWithVision(
  pageNum: number,
  jpegBase64: string,
  client: ChatClient = getOpenAI(),
): Promise<PageResult> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      return await extractOnce(pageNum, jpegBase64, client);
    } catch (err) {
      lastErr = err;
      if (attempt === 1) {
        console.warn(
          `pdf-vision-parser: page ${pageNum} attempt 1 failed, retrying:`,
          err,
        );
      }
    }
  }
  throw new PdfVisionParseError(
    `GPT-4o vision failed for page ${pageNum} after 2 attempts: ${(lastErr as Error)?.message ?? "unknown error"}`,
  );
}

async function extractOnce(
  pageNum: number,
  jpegBase64: string,
  client: ChatClient,
): Promise<PageResult> {
  const controller = new AbortController();
  const hardTimer = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);
  const startedAt = Date.now();
  let res;
  try {
    res = await client.chat.completions.create(
      {
        model: PDF_VISION_MODEL,
        temperature: 0,
        messages: [
          { role: "system", content: PDF_VISION_PROMPT },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: `Extract transactions from this scanned statement page (page ${pageNum}). Return the JSON object only.`,
              },
              {
                type: "image_url",
                image_url: {
                  url: `data:image/jpeg;base64,${jpegBase64}`,
                  detail: "high",
                },
              },
            ],
          },
        ],
      },
      { timeout: LLM_TIMEOUT_MS, signal: controller.signal },
    );
  } finally {
    clearTimeout(hardTimer);
  }
  console.info(
    `pdf-vision-parser: page ${pageNum} returned in ${Date.now() - startedAt}ms`,
  );

  const raw = res.choices[0]?.message?.content?.trim();
  if (!raw) throw new Error(`page ${pageNum}: empty vision response`);

  const jsonStr = extractCodeBlock(raw);
  const parsed = JSON.parse(jsonStr);
  const result = pageResultSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`page ${pageNum} schema mismatch: ${result.error.message}`);
  }
  return result.data;
}
