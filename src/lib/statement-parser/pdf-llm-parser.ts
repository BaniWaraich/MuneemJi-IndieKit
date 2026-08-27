import OpenAI from "openai";
import { extractCodeBlock } from "./extract-code-block";
import { parseExtractedPages } from "./extracted-pages";
import type { CsvLlmResult } from "./csv-llm-parser";
import { mergePdfPageResults, PdfMergeError } from "./pdf-page-merge";
import {
  pageResultSchema,
  type ExtractedPage,
  type NumberedPageResult,
  type PageResult,
} from "./page-schema";

const MODEL = "gpt-4o-mini";
const LLM_TIMEOUT_MS = 180_000;
const PAGE_CONCURRENCY = 4;

export class PdfLlmParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PdfLlmParseError";
  }
}

export { MODEL as PDF_TEXT_MODEL };

const PDF_PAGE_PROMPT = `You are a bookkeeping assistant. The user will paste the raw text of ONE
page of a bank-statement PDF. The text was produced by pdfplumber with
layout preservation, so COLUMNS ARE SEPARATED BY WHITESPACE (multiple
spaces), not by commas. Use column position — vertical alignment of
values across rows — to tell narration from debit/credit/balance. NEVER
split a row on commas: commas appear inside narrations and inside
amounts as thousands separators (e.g. "1,00,000.00"). They are not
field separators.

This page may contain: header preamble, part of the transaction table,
or a footer summary block. Your job: extract every transaction row that
appears on THIS page, in the order they appear, and return a single
JSON object — no prose, no markdown fences.

Output shape (return exactly this object):
{
  "currency": "INR" | null,           // ISO 4217 if you can infer from this page; else null
  "transactions": [
    {
      "date": "YYYY-MM-DD",           // ISO 8601
      "description": string,          // narration as printed; merge wrapped continuation lines into the previous row's description
      "debit": number | null,         // major units; null if this row is a credit
      "credit": number | null,        // major units; null if this row is a debit
      "balance": number | null        // running closing balance for this row, major units; null if the PDF leaves the cell blank
    }
  ]
}

Rules:
- Return an empty transactions array if this page has no transaction rows (pure preamble or pure footer).
- Skip explicit "Opening Balance" / "B/F" / "Brought Forward" rows and footer summary blocks ("Statement Summary", "Total Withdrawals", etc.). These are not transactions.
- One output object per transaction row. Do not merge transaction rows.
- When a physical line has no date and no debit/credit/balance values — only narration text — it is a continuation of the previous transaction's narration. Append it to the previous transaction's description; do not emit it as a separate transaction.
- Exactly one of debit / credit is non-null per row. The other must be null. Never put 0 — use null.
- Preserve the original narration / description text exactly. Do not summarise, translate, or strip prefixes like UPI-, NEFT-, IMPS-.
- Date variations to tolerate: DD/MM/YY, DD/MM/YYYY, DD-MMM-YYYY, DD MMM YY, YYYY-MM-DD. Normalise output to YYYY-MM-DD.
- Amount cleaning: ignore currency symbols (₹, Rs, INR, $, €) and thousands-separator commas; strip trailing "Cr" / "Dr" markers ("Cr" → credit, "Dr" → debit). When no marker is present, infer from column position (e.g. a "Withdrawal Amt" column → debit; a "Deposit Amt" column → credit).
- currency: ISO 4217 — ₹/Rs/INR → "INR", €/EUR → "EUR", \\$/CAD/USD inferred from context. Return null if this page has no clear currency signal.
- balance: Some banks (notably European statements) print the running-balance cell only on certain rows — typically the end-of-day balance — leaving intra-day rows blank. When the cell is blank, emit "balance": null. Do NOT guess, do NOT carry the previous row's balance forward, do NOT copy the debit/credit amount into balance. When balance is null, debit/credit MUST still be filled with the correct movement — they are the only signal we have for that row.

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

export function setPdfLlmClientForTests(client: ChatClient | undefined): void {
  _openai = client;
}

/**
 * GPT-4o mini on `kind=text` pages only. Blank and scanned pages are skipped
 * (scanned pages go through the vision parser).
 */
export async function parseTextPagesWithLlm(
  pages: ExtractedPage[],
  client: ChatClient = getOpenAI(),
): Promise<NumberedPageResult[]> {
  const textPages = pages.filter((p) => p.kind === "text");
  if (textPages.length === 0) return [];

  console.info(
    `pdf-llm-parser: extracting ${textPages.length} text page(s) with ${MODEL} (concurrency=${PAGE_CONCURRENCY})`,
  );

  const startedAt = Date.now();
  const results: NumberedPageResult[] = new Array(textPages.length);
  let nextIdx = 0;
  const workers = Array.from(
    { length: Math.min(PAGE_CONCURRENCY, textPages.length) },
    async () => {
      while (true) {
        const i = nextIdx++;
        if (i >= textPages.length) return;
        const extracted = await extractPageWithRetry(
          textPages[i].page,
          textPages[i].text,
          client,
        );
        results[i] = { page: textPages[i].page, ...extracted };
      }
    },
  );
  await Promise.all(workers);

  console.info(
    `pdf-llm-parser: text pages extracted in ${Date.now() - startedAt}ms`,
  );
  return results;
}

/**
 * Parse a bank-statement PDF by passing each text page's pdfplumber output
 * to gpt-4o-mini, then merging. Scanned/blank pages in the payload are skipped.
 */
export async function parsePdfWithLlm(
  rawPagesJson: string,
): Promise<CsvLlmResult> {
  const pages = parseExtractedPages(rawPagesJson);
  const numbered = await parseTextPagesWithLlm(pages);
  try {
    return mergePdfPageResults(numbered);
  } catch (err) {
    throw new PdfLlmParseError(
      err instanceof PdfMergeError ? err.message : (err as Error).message,
    );
  }
}

async function extractPageWithRetry(
  pageNum: number,
  pageText: string,
  client: ChatClient,
): Promise<PageResult> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      return await extractPage(pageNum, pageText, client);
    } catch (err) {
      lastErr = err;
      if (attempt === 1) {
        console.warn(
          `pdf-llm-parser: page ${pageNum} attempt 1 failed, retrying:`,
          err,
        );
      }
    }
  }
  throw new PdfLlmParseError(
    `LLM PDF extraction failed for page ${pageNum} after 2 attempts: ${(lastErr as Error)?.message ?? "unknown error"}`,
  );
}

async function extractPage(
  pageNum: number,
  pageText: string,
  client: ChatClient,
): Promise<PageResult> {
  const controller = new AbortController();
  const hardTimer = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);

  const startedAt = Date.now();
  let res;
  try {
    res = await client.chat.completions.create(
      {
        model: MODEL,
        temperature: 0,
        messages: [
          { role: "system", content: PDF_PAGE_PROMPT },
          {
            role: "user",
            content: `Extract transactions from this page. Return the JSON object only.\n\n${pageText}`,
          },
        ],
      },
      { timeout: LLM_TIMEOUT_MS, signal: controller.signal },
    );
  } finally {
    clearTimeout(hardTimer);
  }
  console.info(
    `pdf-llm-parser: page ${pageNum} returned in ${Date.now() - startedAt}ms`,
  );

  const raw = res.choices[0]?.message?.content?.trim();
  if (!raw) throw new Error(`page ${pageNum}: empty LLM response`);

  const jsonStr = extractCodeBlock(raw);
  const parsed = JSON.parse(jsonStr);
  const result = pageResultSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`page ${pageNum} schema mismatch: ${result.error.message}`);
  }
  return result.data;
}
