import OpenAI from 'openai';
import { z } from 'zod';
import { extractCodeBlock } from './extract-code-block';

const MODEL = 'gpt-4o-mini';
const LLM_TIMEOUT_MS = 120_000;
const LARGE_CSV_WARN_THRESHOLD = 200_000;

export class CsvLlmParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CsvLlmParseError';
  }
}

const CSV_LLM_PROMPT = `You are a bookkeeping assistant. The user will paste the entire raw text of a
bank statement CSV. Bank CSVs often start with many lines of preamble (account
holder, address, branch, statement period, separator rows of asterisks, etc.)
before the actual transaction table. Your job is to find the transaction table,
extract every transaction row, and return a single JSON object — no prose, no
markdown fences.

Output shape (return exactly this object):
{
  "currency": "INR",                  // ISO 4217 inferred from the statement
  "opening_balance": number,          // major units (e.g. rupees, NOT paise)
  "closing_balance": number,          // major units
  "transactions": [
    {
      "date": "YYYY-MM-DD",           // ISO 8601, normalised
      "description": string,          // the narration column, preserved exactly
      "debit": number | null,         // major units; null if this row is a credit
      "credit": number | null,        // major units; null if this row is a debit
      "balance": number               // running closing balance for this row, major units
    }
  ]
}

Rules:
- Skip header preamble rows of any length until you find the transaction table.
- One output object per transaction row. Do not merge rows or insert opening/closing balance rows as transactions.
- Exactly one of debit / credit is non-null per row. The other must be null. Never put 0 — use null.
- Preserve the original narration / description text exactly. Do not summarise, translate, or strip prefixes like UPI-, NEFT-, IMPS-.
- opening_balance: the balance before any transaction. If the statement prints it explicitly ("Opening Balance", "B/F", "Brought Forward"), use that. Otherwise derive it from the first transaction's balance minus its movement.
- closing_balance: the balance after the last transaction (the last row's balance value).`;

const csvLlmRowSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD'),
  description: z.string(),
  debit: z.number().nullable(),
  credit: z.number().nullable(),
  balance: z.number(),
});

const csvLlmResultSchema = z.object({
  currency: z.string().length(3),
  opening_balance: z.number(),
  closing_balance: z.number(),
  transactions: z.array(csvLlmRowSchema),
});

export type CsvLlmTransaction = z.infer<typeof csvLlmRowSchema>;
export type CsvLlmResult = z.infer<typeof csvLlmResultSchema>;

const openai = new OpenAI();

/**
 * Parse a bank statement CSV by sending the raw text to GPT-4o mini in a
 * single call. The model extracts every transaction (skipping any preamble
 * of arbitrary length) and returns the D02-boundary fields only — no
 * `amount_minor`, no `needs_invoice` (those belong to D03).
 *
 * Two attempts. On second failure, throws CsvLlmParseError — there is no
 * rule-based fallback because the regex parser was retired. BullMQ retries
 * the whole job per its `attempts` config.
 */
export async function parseCsvWithLlm(
  csvText: string,
  signal?: AbortSignal,
): Promise<CsvLlmResult> {
  if (csvText.length > LARGE_CSV_WARN_THRESHOLD) {
    console.warn(
      `csv-llm-parser: large CSV (${csvText.length} chars) — single-call extraction may hit token limits`,
    );
  }

  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await callGpt4oMini(csvText, signal);
    } catch (err) {
      lastErr = err;
      if (attempt === 0) {
        console.warn('csv-llm-parser: attempt 1 failed, retrying:', err);
      }
    }
  }
  throw new CsvLlmParseError(
    `LLM CSV extraction failed after 2 attempts: ${(lastErr as Error)?.message ?? 'unknown error'}`,
  );
}

async function callGpt4oMini(csvText: string, signal?: AbortSignal): Promise<CsvLlmResult> {
  const res = await openai.chat.completions.create(
    {
      model: MODEL,
      temperature: 0,
      messages: [
        { role: 'system', content: CSV_LLM_PROMPT },
        {
          role: 'user',
          content: `Extract all transactions from this bank statement CSV. Return the JSON object only.\n\n${csvText}`,
        },
      ],
    },
    { timeout: LLM_TIMEOUT_MS, signal },
  );

  const raw = res.choices[0]?.message?.content?.trim();
  if (!raw) throw new Error('GPT-4o mini returned empty response');

  const jsonStr = extractCodeBlock(raw);
  const parsed = JSON.parse(jsonStr);
  const result = csvLlmResultSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`schema mismatch: ${result.error.message}`);
  }

  for (let i = 0; i < result.data.transactions.length; i++) {
    const row = result.data.transactions[i];
    const hasDebit = row.debit != null;
    const hasCredit = row.credit != null;
    if (hasDebit === hasCredit) {
      throw new Error(`row ${i}: exactly one of debit/credit must be non-null`);
    }
  }

  return result.data;
}
