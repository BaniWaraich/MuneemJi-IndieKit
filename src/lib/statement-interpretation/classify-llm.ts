import OpenAI from "openai";
import { z } from "zod";
import { extractCodeBlock } from "../statement-parser/extract-code-block";

const MODEL = "gpt-4o-mini";
// Bounded well under the Vercel serverless cap (Hobby kills at ~60s). One
// attempt per Inngest step invocation; Inngest step-retries cover transient
// failures, each with a fresh time budget. See classifyChunk.
const LLM_TIMEOUT_MS = 45_000;
// Transactions per LLM call. A ~20-row gpt-4o-mini call returns in a few
// seconds, so each classify-chunk step stays far under the serverless cap.
export const CHUNK_SIZE = 20;

export const LLM_CATEGORIES = [
  "vendor_payment",
  "customer_receipt",
  "salary",
  "bank_charge",
  "inter_account_transfer",
  "loan_emi",
  "owner_drawing",
  "tax_payment",
  "unknown",
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

let _openai: OpenAI | undefined;
const getOpenAI = () => (_openai ??= new OpenAI());

export class LlmCallError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LlmCallError";
  }
}

export class LlmSchemaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LlmSchemaError";
  }
}

/**
 * BigInt-free shape passed across Inngest step boundaries (step return values
 * must be JSON-serialisable; BigInt is not). The D03 `prepare` step maps
 * Phase1Transaction → ClassifyInputTx (amounts stringified) before chunking.
 */
export type ClassifyInputTx = {
  transaction_index: number;
  date: string;
  description: string;
  debit_minor: string;
  credit_minor: string;
  balance_minor: string;
};

/** Split into fixed-size chunks (one LLM call / Inngest step per chunk). */
export function chunkArray<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}

/**
 * Classify a single chunk with ONE bounded LLM call. Throws on failure
 * (network / malformed JSON / schema / index-set mismatch) so the caller's
 * Inngest step retries it with a fresh time budget; the D03 function wraps each
 * chunk step in try/catch to degrade to per-row fallback if it ultimately
 * fails. Never call this with more than ~CHUNK_SIZE transactions.
 */
export async function classifyChunk(
  chunk: ClassifyInputTx[],
  clientContextBlock: string,
  signal?: AbortSignal,
): Promise<LlmClassification[]> {
  if (chunk.length === 0) return [];
  const systemPrompt = SYSTEM_PROMPT_TEMPLATE.replace(
    "{CLIENT_CONTEXT}",
    clientContextBlock,
  );
  const userMessage = buildUserMessage(chunk);
  const expectedIndices = new Set(chunk.map((t) => t.transaction_index));
  const parsed = await callLlm(systemPrompt, userMessage, signal);
  assertIndexSetMatches(parsed, expectedIndices);
  return parsed;
}

function buildUserMessage(chunk: ClassifyInputTx[]): string {
  const blocks = chunk
    .map((tx) =>
      [
        `## Transaction ${tx.transaction_index}`,
        `- date: ${tx.date}`,
        `- description: ${tx.description}`,
        `- debit_minor: ${tx.debit_minor}`,
        `- credit_minor: ${tx.credit_minor}`,
        `- balance_minor: ${tx.balance_minor}`,
      ].join("\n"),
    )
    .join("\n\n");
  return `Classify these ${chunk.length} transactions:\n\n${blocks}`;
}

async function callLlm(
  systemPrompt: string,
  userMessage: string,
  signal: AbortSignal | undefined,
): Promise<LlmClassification[]> {
  let res;
  try {
    res = await getOpenAI().chat.completions.create(
      {
        model: MODEL,
        temperature: 0,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage },
        ],
      },
      { timeout: LLM_TIMEOUT_MS, signal },
    );
  } catch (err) {
    throw new LlmCallError((err as Error).message);
  }

  const raw = res.choices[0]?.message?.content?.trim();
  if (!raw) throw new LlmCallError("GPT-4o mini returned empty response");

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

function assertIndexSetMatches(
  rows: LlmClassification[],
  expected: Set<number>,
): void {
  const got = new Set(rows.map((r) => r.transaction_index));
  if (got.size !== expected.size) {
    throw new LlmSchemaError(`expected ${expected.size} rows, got ${got.size}`);
  }
  for (const idx of expected) {
    if (!got.has(idx)) {
      throw new LlmSchemaError(
        `expected transaction_index ${idx} missing from response`,
      );
    }
  }
}
