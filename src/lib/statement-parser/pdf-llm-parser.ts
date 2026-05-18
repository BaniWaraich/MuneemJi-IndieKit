import OpenAI from "openai";
import { z } from "zod";
import { extractCodeBlock } from "./extract-code-block";
import type { CsvLlmResult, CsvLlmTransaction } from "./csv-llm-parser";

const MODEL = "gpt-4o-mini";
const LLM_TIMEOUT_MS = 180_000;
const PAGE_CONCURRENCY = 4;

export class PdfLlmParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PdfLlmParseError";
  }
}

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

const pageRowSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD"),
  description: z.string(),
  debit: z.number().nullable(),
  credit: z.number().nullable(),
  balance: z.number().nullable(),
});

type PageRow = z.infer<typeof pageRowSchema>;

const pageResultSchema = z.object({
  currency: z.string().length(3).nullable(),
  transactions: z.array(pageRowSchema),
});

const pagesInputSchema = z.object({
  pages: z.array(z.object({ page: z.number(), text: z.string() })),
});

let _openai: OpenAI | undefined;
const getOpenAI = () =>
  (_openai ??= new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    maxRetries: 0,
  }));

/**
 * Parse a bank-statement PDF by passing each page's raw pdfplumber text
 * to gpt-4o-mini independently, then merging the per-page transaction
 * arrays. Returns the same shape as `parseCsvWithLlm` so downstream code
 * is identical.
 *
 * Per-page chunking avoids long-context attention degradation that
 * caused gpt-4o-mini to drop middle rows on long tables, and keeps each
 * call well inside the 180s timeout even for large statements.
 */
export async function parsePdfWithLlm(
  rawPagesJson: string,
): Promise<CsvLlmResult> {
  const parsedInput = pagesInputSchema.safeParse(JSON.parse(rawPagesJson));
  if (!parsedInput.success) {
    throw new PdfLlmParseError(
      `pdfplumber output did not match expected shape: ${parsedInput.error.message}`,
    );
  }
  const pages = parsedInput.data.pages;

  console.info(
    `pdf-llm-parser: extracting ${pages.length} page(s) with ${MODEL} (concurrency=${PAGE_CONCURRENCY})`,
  );

  const startedAt = Date.now();
  const results: Array<{
    currency: string | null;
    transactions: PageRow[];
  }> = new Array(pages.length);
  let nextIdx = 0;
  const workers = Array.from(
    { length: Math.min(PAGE_CONCURRENCY, pages.length) },
    async () => {
      while (true) {
        const i = nextIdx++;
        if (i >= pages.length) return;
        results[i] = await extractPageWithRetry(pages[i].page, pages[i].text);
      }
    },
  );
  await Promise.all(workers);

  console.info(
    `pdf-llm-parser: all pages extracted in ${Date.now() - startedAt}ms`,
  );

  const merged: PageRow[] = results.flatMap((r) => r.transactions);
  const currency = results.find((r) => r.currency)?.currency ?? "INR";

  if (merged.length === 0) {
    throw new PdfLlmParseError("no transactions extracted from any page");
  }

  const row0 = merged[0];
  const row0HasDebit = row0.debit != null;
  const row0HasCredit = row0.credit != null;
  if (row0HasDebit === row0HasCredit) {
    throw new PdfLlmParseError(
      "merged row 0: exactly one of debit/credit must be non-null",
    );
  }
  if (!merged.some((r) => r.balance != null)) {
    throw new PdfLlmParseError(
      "no row has a printed balance — cannot anchor running balance",
    );
  }

  const transactions: CsvLlmTransaction[] = forwardFillBalances(merged);

  applyBalanceDeltaDirectionOverride(transactions);

  const first = transactions[0];
  const last = transactions[transactions.length - 1];
  const opening_balance =
    first.balance - (first.credit ?? 0) + (first.debit ?? 0);
  const closing_balance = last.balance;

  return {
    currency,
    opening_balance,
    closing_balance,
    transactions,
  };
}

async function extractPageWithRetry(
  pageNum: number,
  pageText: string,
): Promise<{ currency: string | null; transactions: PageRow[] }> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      return await extractPage(pageNum, pageText);
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
): Promise<{ currency: string | null; transactions: PageRow[] }> {
  const controller = new AbortController();
  const hardTimer = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);

  const startedAt = Date.now();
  let res;
  try {
    res = await getOpenAI().chat.completions.create(
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

  // Per-row debit/credit consistency is NOT enforced here. The merged
  // balance-delta override recomputes (debit, credit) from balance
  // deltas for every row except merged-row 0, so an ambiguous row in
  // the middle of the table is harmless. Merged-row 0 is checked
  // post-merge in parsePdfWithLlm.
  return result.data;
}

// Forward-fill missing balances using LLM-reported debit/credit movement.
// Some banks (notably BoI and other European statements) leave the
// running-balance cell blank on intra-day rows and only print it on the
// end-of-day row. The LLM returns null for those cells. We anchor on the
// first row's balance (required non-null upstream), then for each
// subsequent row:
//   - if balance is null, compute prev.balance + credit - debit
//   - if balance is non-null, reconcile against the computed value and
//     trust the printed number on mismatch (printed numbers are ground
//     truth; LLM debit/credit direction may be wrong and the
//     balance-delta override will repair it next).
function forwardFillBalances(rows: PageRow[]): CsvLlmTransaction[] {
  const anchorIdx = rows.findIndex((r) => r.balance != null);
  if (anchorIdx < 0) {
    throw new PdfLlmParseError(
      "no row has a printed balance — cannot anchor running balance",
    );
  }
  const balances = new Array<number>(rows.length);
  balances[anchorIdx] = rows[anchorIdx].balance as number;

  // Walk backward from the anchor: each earlier row's balance is the
  // later row's balance minus the later row's net movement.
  for (let i = anchorIdx - 1; i >= 0; i--) {
    const next = rows[i + 1];
    const nextMovement = (next.credit ?? 0) - (next.debit ?? 0);
    balances[i] = balances[i + 1] - nextMovement;
  }

  // Walk forward from the anchor: each later row's balance is the prior
  // row's balance plus this row's net movement, reconciled when printed.
  for (let i = anchorIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    const movement = (row.credit ?? 0) - (row.debit ?? 0);
    const computed = balances[i - 1] + movement;
    if (row.balance != null && Math.abs(row.balance - computed) > 0.01) {
      console.warn(
        `pdf-llm-parser: row ${i} balance reconcile mismatch — printed=${row.balance}, computed=${computed.toFixed(2)} (using printed)`,
      );
      balances[i] = row.balance;
    } else {
      balances[i] = row.balance ?? computed;
    }
  }

  return rows.map((r, i) => ({ ...r, balance: balances[i] }));
}

// Deterministic override: per-row debit/credit direction is derived from
// the balance delta across consecutive rows. The LLM mis-classifies
// debits as credits (and vice versa) when amounts sit in adjacent
// columns, but the balance column is a single number per row and reads
// accurately. For rows i > 0 we set (debit, credit) so running-balance
// arithmetic is satisfied by construction, and use |delta| as the
// amount. Row 0's direction is the only thing we still take from the
// LLM. Significant amount disagreements are logged, not thrown.
function applyBalanceDeltaDirectionOverride(txs: CsvLlmTransaction[]): void {
  for (let i = 1; i < txs.length; i++) {
    const delta = txs[i].balance - txs[i - 1].balance;
    const llmMagnitude = (txs[i].credit ?? 0) + (txs[i].debit ?? 0);
    const derivedMagnitude = Math.abs(delta);
    if (Math.abs(derivedMagnitude - llmMagnitude) > 0.01) {
      console.warn(
        `pdf-llm-parser: row ${i} amount disagreement — llm=${llmMagnitude}, balance-delta=${derivedMagnitude.toFixed(2)} (using delta)`,
      );
    }
    if (delta >= 0) {
      txs[i].credit = derivedMagnitude;
      txs[i].debit = null;
    } else {
      txs[i].debit = derivedMagnitude;
      txs[i].credit = null;
    }
  }
}
