/**
 * D03: Statement Interpretation — Inngest function.
 * Replaces workers/interpret.worker.ts from the original BullMQ architecture.
 *
 * Event: "muneem/statement.extracted"
 * Payload: { statementId: string }
 */

import { and, eq, ne } from "drizzle-orm";
import { NonRetriableError } from "inngest";
import { inngest } from "@/lib/inngest/client";
import { db } from "@/db";
import {
  bankStatements,
  clientOrgs,
  clientProfiles,
  clientKnowledge,
} from "@/db/schema/muneem";
import {
  parsePhase1Markdown,
  type Phase1Document,
  type Phase1Transaction,
} from "@/lib/statement-interpretation/parse-markdown-kv";
import {
  runRulePrefilter,
  type RuleMatch,
} from "@/lib/statement-interpretation/rule-prefilter";
import { buildClientContextBlock } from "@/lib/statement-interpretation/build-context";
import {
  classifyChunk,
  chunkArray,
  CHUNK_SIZE,
  type ClassifyInputTx,
  type LlmClassification,
} from "@/lib/statement-interpretation/classify-llm";
import {
  assertIntegrity,
  computeNormalisedSumMinor,
} from "@/lib/statement-interpretation/integrity-checks";
import {
  insertInterpretedRows,
  readD02ParseMethod,
  deriveMatchStatus,
  type Category,
  type InterpretationMethod,
  type InterpretedRow,
} from "@/lib/statement-interpretation/insert-transactions";

type LogCtx = {
  runId?: string;
  statementId?: string;
  clientOrgId?: string;
  firmId?: string;
};

function log(
  level: "info" | "warn" | "error",
  msg: string,
  ctx: LogCtx,
  extra?: object,
) {
  const line = JSON.stringify({
    level,
    msg,
    ts: new Date().toISOString(),
    ...ctx,
    ...(extra ?? {}),
  });
  if (level === "error") console.error(line);
  else console.log(line);
}

function confidenceToString(v: number): string {
  if (Number.isNaN(v)) return "0.00";
  const clamped = Math.max(0, Math.min(1, v));
  return clamped.toFixed(2);
}

function amountMinorOf(tx: Phase1Transaction): bigint {
  return tx.credit_minor - tx.debit_minor;
}

function rowFromRule(
  tx: Phase1Transaction,
  rule: RuleMatch,
  extractionConfidence: number,
): InterpretedRow {
  return {
    transaction_index: tx.transaction_index,
    date: tx.date,
    description: tx.description,
    amount_minor: amountMinorOf(tx),
    needs_invoice: rule.needs_invoice,
    category: rule.category,
    reasoning: rule.reasoning,
    interpretation_method: rule.method,
    interpretation_confidence: confidenceToString(1.0 * extractionConfidence),
    matched_known_vendor_name: rule.matched_known_vendor_name,
    matched_active_loan_lender: rule.matched_active_loan_lender,
    match_status: deriveMatchStatus(rule.category, rule.method),
  };
}

function rowFromLlm(
  tx: Phase1Transaction,
  llm: LlmClassification,
  extractionConfidence: number,
): InterpretedRow {
  const method: InterpretationMethod = "llm";
  return {
    transaction_index: tx.transaction_index,
    date: tx.date,
    description: tx.description,
    amount_minor: amountMinorOf(tx),
    needs_invoice: llm.needs_invoice,
    category: llm.category as Category,
    reasoning: llm.reasoning,
    interpretation_method: method,
    interpretation_confidence: confidenceToString(
      llm.confidence * extractionConfidence,
    ),
    matched_known_vendor_name: null,
    matched_active_loan_lender: null,
    match_status: deriveMatchStatus(llm.category as Category, method),
  };
}

function rowFromFallback(
  tx: Phase1Transaction,
  extractionConfidence: number,
): InterpretedRow {
  const method: InterpretationMethod = "llm_fallback";
  const category: Category = "unknown";
  return {
    transaction_index: tx.transaction_index,
    date: tx.date,
    description: tx.description,
    amount_minor: amountMinorOf(tx),
    needs_invoice: tx.debit_minor > 0n,
    category,
    reasoning: "LLM unavailable — fallback rule applied",
    interpretation_method: method,
    interpretation_confidence: confidenceToString(0.3 * extractionConfidence),
    matched_known_vendor_name: null,
    matched_active_loan_lender: null,
    match_status: deriveMatchStatus(category, method),
  };
}

function buildInterpretedRows(input: {
  doc: Phase1Document;
  ruleMatches: Map<number, RuleMatch>;
  llmClassifications: Map<number, LlmClassification>;
  extractionConfidence: number;
}): InterpretedRow[] {
  const out: InterpretedRow[] = [];
  for (const tx of input.doc.transactions) {
    const ruled = input.ruleMatches.get(tx.transaction_index);
    if (ruled) {
      out.push(rowFromRule(tx, ruled, input.extractionConfidence));
      continue;
    }
    const llm = input.llmClassifications.get(tx.transaction_index);
    if (llm) {
      out.push(rowFromLlm(tx, llm, input.extractionConfidence));
      continue;
    }
    // No rule and no LLM classification → its chunk was skipped or its
    // classify-chunk step exhausted retries. Degrade to per-row fallback
    // rather than failing the whole statement.
    out.push(rowFromFallback(tx, input.extractionConfidence));
  }
  return out;
}

/** Shared load: profile + knowledge + parsed doc + rule prefilter for a row. */
async function loadProfileAndPrefilter(
  statement: typeof bankStatements.$inferSelect,
) {
  if (!statement.phase1Markdown) {
    throw new NonRetriableError(
      "phase1_markdown is null on phase1_complete row",
    );
  }
  const org = await db.query.clientOrgs.findFirst({
    where: eq(clientOrgs.id, statement.clientOrgId),
    columns: { firmId: true },
  });
  if (!org)
    throw new NonRetriableError(`clientOrg ${statement.clientOrgId} not found`);

  const profile = await db.query.clientProfiles.findFirst({
    where: eq(clientProfiles.clientOrgId, statement.clientOrgId),
  });
  if (!profile) {
    throw new NonRetriableError(
      `client_profiles row missing for client_org ${statement.clientOrgId}`,
    );
  }

  const knowledge =
    (await db.query.clientKnowledge.findFirst({
      where: eq(clientKnowledge.clientOrgId, statement.clientOrgId),
    })) ?? null;

  const doc = parsePhase1Markdown(statement.phase1Markdown);
  const ownAccountLast4 =
    profile.bankAccounts.find((a) => a.is_primary_operating)
      ?.account_number_last4 ?? null;

  const ruleResult = runRulePrefilter(doc.transactions, {
    ownAccountLast4,
    bankAccounts: profile.bankAccounts,
    knownVendors: knowledge?.knownVendors ?? [],
    knownCustomers: knowledge?.knownCustomers ?? [],
    activeLoans: knowledge?.activeLoans ?? [],
    ownerDrawingsPattern: knowledge?.ownerDrawingsPattern ?? null,
  });

  return { firmId: org.firmId, profile, knowledge, doc, ruleResult };
}

function toClassifyInput(tx: Phase1Transaction): ClassifyInputTx {
  return {
    transaction_index: tx.transaction_index,
    date: tx.date,
    description: tx.description,
    debit_minor: tx.debit_minor.toString(),
    credit_minor: tx.credit_minor.toString(),
    balance_minor: tx.balance_minor.toString(),
  };
}

export const statementInterpret = inngest.createFunction(
  {
    id: "muneem-statement-interpret",
    name: "Muneem: D03 Statement Interpretation",
    concurrency: { limit: 2 },
    retries: 3,
    triggers: [{ event: "muneem/statement.extracted" }],
    // When all retries are exhausted (including a serverless timeout-kill that
    // bypasses any in-handler try/catch), surface the failure on the statement
    // instead of leaving it silently stuck at phase1_complete.
    onFailure: async ({
      error,
      event,
      step,
    }: {
      error: Error;
      event: { data: { statementId: string } };
      step: { run: <T>(id: string, fn: () => Promise<T>) => Promise<T> };
    }) => {
      const { statementId } = event.data;
      await step.run("mark-failed", async () => {
        await db
          .update(bankStatements)
          .set({
            status: "failed",
            errorMessage: String(error?.message ?? error).slice(0, 500),
          })
          .where(
            and(
              eq(bankStatements.id, statementId),
              ne(bankStatements.status, "parsed"),
            ),
          );
      });
    },
  },
  async ({
    event,
    step,
    logger,
  }: {
    event: { id: string; data: { statementId: string } };
    step: {
      run: <T>(id: string, fn: () => Promise<T>) => Promise<T>;
      sendEvent: (
        id: string,
        payload: { name: string; data: object },
      ) => Promise<unknown>;
    };
    logger: { info: (msg: string, ctx?: object) => void };
  }) => {
    const { statementId } = event.data as { statementId: string };

    // Step 1 — load, prefilter, and build LLM-input chunks. Returns only
    // JSON-safe data (no BigInt) so it survives the step boundary.
    const prep = await step.run("prepare", async () => {
      const statement = await db.query.bankStatements.findFirst({
        where: eq(bankStatements.id, statementId),
      });
      if (!statement)
        throw new NonRetriableError(`Statement ${statementId} not found`);

      // Idempotency / phase gate: only run from phase1_complete.
      if (statement.status !== "phase1_complete") {
        logger.info(
          "statement-interpret: skipping non-phase1_complete statement",
          { statementId, status: statement.status },
        );
        return { skip: true as const };
      }

      const { firmId, profile, knowledge, ruleResult } =
        await loadProfileAndPrefilter(statement);

      const hasResidue = ruleResult.unmatched.length > 0;
      const contextBlock = hasResidue
        ? buildClientContextBlock(profile, knowledge)
        : "";
      const chunks = chunkArray(
        ruleResult.unmatched.map(toClassifyInput),
        CHUNK_SIZE,
      );

      log(
        "info",
        "statement-interpret: prepared",
        {
          runId: event.id,
          statementId,
          clientOrgId: statement.clientOrgId,
          firmId,
        },
        {
          rule_hits: ruleResult.matches.size,
          llm_residue: ruleResult.unmatched.length,
          chunks: chunks.length,
        },
      );

      return {
        skip: false as const,
        clientOrgId: statement.clientOrgId,
        contextBlock,
        chunks,
      };
    });

    if (prep.skip) return;

    // Step 2 — classify each chunk in its own step (each gets a fresh
    // serverless time budget). A chunk that exhausts its step-retries degrades
    // to per-row fallback rather than failing the whole statement.
    const llmClassifications: LlmClassification[] = [];
    for (let i = 0; i < prep.chunks.length; i++) {
      const chunk = prep.chunks[i];
      try {
        const res = await step.run(`classify-chunk-${i}`, () =>
          classifyChunk(chunk, prep.contextBlock),
        );
        llmClassifications.push(...res);
      } catch (err) {
        logger.info("statement-interpret: chunk fell back to defaults", {
          statementId,
          chunk: i,
          error: (err as Error).message,
        });
      }
    }

    // Step 3 — re-derive rows deterministically and commit (sets 'parsed').
    // Re-reads + re-parses so no BigInt rows cross the step boundary.
    await step.run("finalize", async () => {
      const statement = await db.query.bankStatements.findFirst({
        where: eq(bankStatements.id, statementId),
      });
      if (!statement)
        throw new NonRetriableError(`Statement ${statementId} not found`);
      // Idempotency: a prior attempt may already have committed.
      if (statement.status !== "phase1_complete") {
        logger.info(
          "statement-interpret: finalize skip (already past phase1)",
          { statementId, status: statement.status },
        );
        return;
      }

      const { firmId, doc, ruleResult } =
        await loadProfileAndPrefilter(statement);

      const llmMap = new Map<number, LlmClassification>(
        llmClassifications.map((c) => [c.transaction_index, c]),
      );
      const rows = buildInterpretedRows({
        doc,
        ruleMatches: ruleResult.matches,
        llmClassifications: llmMap,
        extractionConfidence: doc.frontmatter.extraction_confidence,
      });

      assertIntegrity({ doc, rowsToInsert: rows });

      const unmatchedCount = ruleResult.unmatched.length;
      const normalisationMode: "llm" | "fallback" | "skipped" =
        unmatchedCount === 0
          ? "skipped"
          : llmMap.size >= unmatchedCount
            ? "llm"
            : "fallback";

      const parseMethod = await readD02ParseMethod(statementId);
      const normalisedSumMinor = computeNormalisedSumMinor(rows);

      await insertInterpretedRows({
        statementId,
        clientOrgId: statement.clientOrgId,
        firmId,
        currency: doc.frontmatter.currency,
        rows,
        normalisationMode,
        normalisedRowCount: rows.length,
        normalisedSumMinor,
        parseMethod,
      });

      log(
        "info",
        "statement-interpret: complete",
        {
          runId: event.id,
          statementId,
          clientOrgId: statement.clientOrgId,
          firmId,
        },
        {
          rows: rows.length,
          rule_hits: ruleResult.matches.size,
          llm_residue: unmatchedCount,
          normalisation_mode: normalisationMode,
        },
      );
    });

    // Step 4 — emit downstream event durably (D06 match worker, PLANNED).
    await step.sendEvent("emit-interpretation-complete", {
      name: "muneem/interpretation.complete",
      data: {
        clientOrgId: prep.clientOrgId,
        statementId,
        trigger: "d03_complete",
      },
    });
  },
);
