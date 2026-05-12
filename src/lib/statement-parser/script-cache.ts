import { createHash } from 'crypto';
import { eq, and, sql } from 'drizzle-orm';
import Anthropic from '@anthropic-ai/sdk';
import { db } from '@/db';
import { bankParserScripts } from '@/db/schema/muneem';
import { extractCodeBlock } from './extract-code-block';

const SCRIPT_GENERATION_MODEL = 'claude-opus-4-6';

const SCRIPT_GENERATION_PROMPT = `You are an expert Python developer specialising in PDF data extraction.
I am providing the raw text content of a bank statement PDF.
Your task is to write a complete, standalone Python script using pdfplumber
that extracts every transaction from this bank's statement format.

The script must:
1. Accept a single argument: the path to the PDF file
2. Print a JSON object to stdout with keys: "transactions", "opening_balance", "closing_balance", "currency"
3. Each transaction object in the "transactions" array:
   {
     "date": "YYYY-MM-DD",
     "description": string,   // raw text exactly as it appears — do not modify
     "debit": number | null,  // money out — positive number, null if not a debit row
     "credit": number | null, // money in — positive number, null if not a credit row
     "balance": number        // running balance after this transaction
   }
4. Handle multi-line transaction descriptions correctly:
   - A row with no date and no debit/credit value is a continuation of the previous row
   - Append its description text to the previous transaction's description
5. Skip header rows and footer rows (totals, page numbers, bank branding)
6. Handle page breaks correctly — the column header repeats on each page; skip it each time
7. Use column x-coordinate ranges to assign values to columns — do NOT rely on fixed y-coordinates
8. Sample at least 3 pages of the PDF before committing to column boundaries
9. Print ONLY the JSON object to stdout — no logging, no progress messages, no markdown

The script must be fully deterministic. It must not:
- Access the network (no sockets, no urllib/requests/http, no DNS)
- Read the system clock or environment variables (no os.environ, no datetime.now, no time.time)
- Read or write any file outside the PDF path provided as argv[1]
- Import subprocess, ctypes, socket, urllib, http, requests, os (except os.path), sys (except sys.argv / sys.stdout / sys.stderr), or any package that wraps these
- Execute shell commands

Also extract from the statement header:
   "opening_balance": number,
   "closing_balance": number,
   "currency": string  // ISO 4217

Return the complete Python script only. No explanation. No markdown fences.`;

// Singleton SDK client — avoids re-creating HTTP agents per call and picks
// ANTHROPIC_API_KEY from env once at module load.
const anthropic = new Anthropic();

export async function lookupScript(
  firmId: string,
  bankIdentifier: string,
): Promise<typeof bankParserScripts.$inferSelect | null> {
  const result = await db.query.bankParserScripts.findFirst({
    where: and(
      eq(bankParserScripts.firmId, firmId),
      eq(bankParserScripts.bankIdentifier, bankIdentifier),
      eq(bankParserScripts.isActive, true),
    ),
  });
  return result ?? null;
}

export async function generateScript(
  rawHeaderText: string,
  signal?: AbortSignal,
): Promise<string> {
  const res = await anthropic.messages.create(
    {
      model: SCRIPT_GENERATION_MODEL,
      max_tokens: 16384,
      system: SCRIPT_GENERATION_PROMPT,
      messages: [
        {
          role: 'user',
          content: `Here is the raw text from the first 2 pages of the bank statement PDF:\n\n<<<\n${rawHeaderText}\n>>>\n\nWrite the complete Python pdfplumber extraction script.`,
        },
      ],
    },
    { timeout: 120_000, signal },
  );

  const textBlock = res.content.find((b) => b.type === 'text');
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('Claude returned no text block for script generation');
  }

  return extractCodeBlock(textBlock.text);
}

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf-8').digest('hex');
}

/**
 * Atomic insert-or-lookup keyed by (firm_id, bank_identifier) WHERE is_active.
 * If a concurrent job inserted first, the ON CONFLICT silently does nothing
 * and we re-read the winner. Both callers end up with the same script row.
 */
export async function storeScript(params: {
  firmId: string;
  bankIdentifier: string;
  bankName: string;
  country: string;
  scriptCode: string;
  headerText?: string;
}): Promise<string> {
  const contentHash = sha256(params.scriptCode);
  const headerTextHash = params.headerText ? sha256(params.headerText) : null;

  await db
    .insert(bankParserScripts)
    .values({
      firmId: params.firmId,
      bankIdentifier: params.bankIdentifier,
      bankName: params.bankName,
      country: params.country,
      scriptCode: params.scriptCode,
      contentHash,
      headerTextHash,
      lastValidatedAt: new Date(),
    })
    .onConflictDoNothing({
      target: [bankParserScripts.firmId, bankParserScripts.bankIdentifier],
      where: sql`is_active = true`,
    });

  const existing = await lookupScript(params.firmId, params.bankIdentifier);
  if (!existing) {
    throw new Error(
      `storeScript failed to find active row for firm=${params.firmId} bank=${params.bankIdentifier} after insert`,
    );
  }
  return existing.id;
}

export async function deactivateScript(scriptId: string): Promise<void> {
  await db
    .update(bankParserScripts)
    .set({ isActive: false, updatedAt: new Date() })
    .where(eq(bankParserScripts.id, scriptId));
}
