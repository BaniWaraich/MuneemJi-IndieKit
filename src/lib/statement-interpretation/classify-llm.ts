import OpenAI from 'openai';
import { z } from 'zod';
import { extractCodeBlock } from '../statement-parser/extract-code-block';
import type { Phase1Transaction } from './parse-markdown-kv';

const MODEL = 'gpt-4o-mini';
const LLM_TIMEOUT_MS = 120_000;

export const LLM_CATEGORIES = [
  'vendor_payment',
  'customer_receipt',
  'salary',
  'bank_charge',
  'inter_account_transfer',
  'loan_emi',
  'owner_drawing',
  'tax_payment',
  'unknown',
] as const;

export type LlmCategory = (typeof LLM_CATEGORIES)[number];

const llmRowSchema = z.object({
  transaction_index: z.number().int().positive(),
  needs_invoice: z.boolean(),
  category: z.enum(LLM_CATEGORIES),
  reasoning: z.string().min(1),
  confidence: z.number().min(0).max(1),
});

const llmArraySchema = z.array(llmRowSchema);

export type LlmClassification = z.infer<typeof llmRowSchema>;

const SYSTEM_PROMPT_TEMPLATE = `You are a CA reviewing bank transactions for a client whose business you know
well. The client's business context is provided below. Use it to reason about
each transaction with the same judgement you would apply to a long-standing
client whose patterns you have learned.

{CLIENT_CONTEXT}

INSTRUCTIONS
You will receive a list of transactions in Markdown KV format. These are the
transactions that did NOT match any rule and need your judgement.

For each transaction, return a JSON object:
{
  "transaction_index": int,         // exactly the integer N from the "## Transaction N" header
  "needs_invoice": boolean,
  "category": one of [
    "vendor_payment", "customer_receipt", "salary", "bank_charge",
    "inter_account_transfer", "loan_emi", "owner_drawing",
    "tax_payment", "unknown"
  ],
  "reasoning": string,              // one sentence, plain language, no jargon
  "confidence": number               // 0.0 to 1.0
}

Return a JSON array only. No prose, no markdown fences. Order does not matter
but every input transaction_index must appear exactly once in the output.

Rules:
- needs_invoice=true: vendor payments, supplier purchases, professional services,
  utilities, rent, subscriptions, retail purchases, anything where a third-party
  invoice is reasonably expected to exist.
- needs_invoice=false: salary/payroll runs, bank charges and fees, inter-account
  transfers, loan EMIs, tax payments, returned credits, opening balance entries,
  customer receipts, owner drawings.
- When uncertain on needs_invoice, default to true — it is better to request an
  invoice that is not needed than to miss one that is.
- For category="unknown", the reasoning must explain specifically why the
  transaction is ambiguous (e.g., "Description is opaque IMPS reference with no
  identifiable counterparty").
- The client's industry, GST registration, and transaction mode should anchor
  your reasoning. A cash-heavy retail business has different cash flow norms
  than a digital-first consultancy. A composition-scheme dealer cannot claim
  ITC, so the urgency around capturing GST invoices is different.
- If the client has inter-company transactions flagged, treat large NEFT/RTGS
  transfers to unidentified parties as "possible related-party transfer — verify"
  rather than a definite vendor payment.`;

const openai = new OpenAI();

export class LlmCallError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LlmCallError';
  }
}

export class LlmSchemaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LlmSchemaError';
  }
}

export type ClassifyResult =
  | { mode: 'llm'; classifications: Map<number, LlmClassification> }
  | { mode: 'fallback' };

/**
 * Two attempts. On first failure (network/schema/index-set mismatch), retry.
 * On second failure, return mode='fallback' — the caller (D03 worker) applies
 * §7.4 per-row defaults. This function never throws on LLM unavailability;
 * that is policy per spec §7.4.
 */
export async function classifyResidueWithLlm(
  unmatched: Phase1Transaction[],
  clientContextBlock: string,
  signal?: AbortSignal,
): Promise<ClassifyResult> {
  if (unmatched.length === 0) {
    return { mode: 'llm', classifications: new Map() };
  }

  const systemPrompt = SYSTEM_PROMPT_TEMPLATE.replace('{CLIENT_CONTEXT}', clientContextBlock);
  const userMessage = buildUserMessage(unmatched);
  const expectedIndices = new Set(unmatched.map((t) => t.transaction_index));

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const parsed = await callLlm(systemPrompt, userMessage, signal);
      assertIndexSetMatches(parsed, expectedIndices);
      const classifications = new Map<number, LlmClassification>();
      for (const row of parsed) classifications.set(row.transaction_index, row);
      return { mode: 'llm', classifications };
    } catch (err) {
      if (attempt === 0) {
        console.warn('classify-llm: attempt 1 failed, retrying:', err);
        continue;
      }
      console.error('classify-llm: both attempts failed, falling back:', err);
    }
  }

  return { mode: 'fallback' };
}

function buildUserMessage(unmatched: Phase1Transaction[]): string {
  const blocks = unmatched
    .map((tx) =>
      [
        `## Transaction ${tx.transaction_index}`,
        `- date: ${tx.date}`,
        `- description: ${tx.description}`,
        `- debit_minor: ${tx.debit_minor.toString()}`,
        `- credit_minor: ${tx.credit_minor.toString()}`,
        `- balance_minor: ${tx.balance_minor.toString()}`,
      ].join('\n'),
    )
    .join('\n\n');
  return `Classify these ${unmatched.length} transactions:\n\n${blocks}`;
}

async function callLlm(
  systemPrompt: string,
  userMessage: string,
  signal: AbortSignal | undefined,
): Promise<LlmClassification[]> {
  let res;
  try {
    res = await openai.chat.completions.create(
      {
        model: MODEL,
        temperature: 0,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
      },
      { timeout: LLM_TIMEOUT_MS, signal },
    );
  } catch (err) {
    throw new LlmCallError((err as Error).message);
  }

  const raw = res.choices[0]?.message?.content?.trim();
  if (!raw) throw new LlmCallError('GPT-4o mini returned empty response');

  let parsed: unknown;
  try {
    parsed = JSON.parse(extractCodeBlock(raw));
  } catch (err) {
    throw new LlmSchemaError(`malformed JSON: ${(err as Error).message}`);
  }

  const result = llmArraySchema.safeParse(parsed);
  if (!result.success) {
    throw new LlmSchemaError(`schema mismatch: ${result.error.message}`);
  }
  return result.data;
}

function assertIndexSetMatches(rows: LlmClassification[], expected: Set<number>): void {
  const got = new Set(rows.map((r) => r.transaction_index));
  if (got.size !== expected.size) {
    throw new LlmSchemaError(`expected ${expected.size} rows, got ${got.size}`);
  }
  for (const idx of expected) {
    if (!got.has(idx)) {
      throw new LlmSchemaError(`expected transaction_index ${idx} missing from response`);
    }
  }
}
