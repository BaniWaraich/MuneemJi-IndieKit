/**
 * D03: Statement Interpretation — Inngest function.
 * Replaces workers/interpret.worker.ts from the original BullMQ architecture.
 *
 * Event: "muneem/statement.extracted"
 * Payload: { statementId: string }
 */

import { eq } from "drizzle-orm";
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
  InvalidPhase1MarkdownError,
  type Phase1Document,
  type Phase1Transaction,
} from "@/lib/statement-interpretation/parse-markdown-kv";
import {
  runRulePrefilter,
  type RuleMatch,
} from "@/lib/statement-interpretation/rule-prefilter";
import { buildClientContextBlock } from "@/lib/statement-interpretation/build-context";
import {
  classifyResidueWithLlm,
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
  extra?: object
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
  extractionConfidence: number
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
  extractionConfidence: number
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
      llm.confidence * extractionConfidence
    ),
    matched_known_vendor_name: null,
    matched_active_loan_lender: null,
    match_status: deriveMatchStatus(llm.category as Category, method),
  };
}

function rowFromFallback(
  tx: Phase1Transaction,
  extractionConfidence: number
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
  fallback: boolean;
  extractionConfidence: number;
}): InterpretedRow[] {
  const out: InterpretedRow[] = [];
  for (const tx of input.doc.transactions) {
    const ruled = input.ruleMatches.get(tx.transaction_index);
    if (ruled) {
      out.push(rowFromRule(tx, ruled, input.extractionConfidence));
      continue;
    }
    if (input.fallback) {
      out.push(rowFromFallback(tx, input.extractionConfidence));
      continue;
    }
    const llm = input.llmClassifications.get(tx.transaction_index);
    if (!llm) {
      throw new Error(
        `LLM classification missing for transaction_index ${tx.transaction_index}`
      );
    }
    out.push(rowFromLlm(tx, llm, input.extractionConfidence));
  }
  return out;
}

export const statementInterpret = inngest.createFunction(
  {
    id: "muneem-statement-interpret",
    name: "Muneem: D03 Statement Interpretation",
    concurrency: { limit: 2 },
    retries: 3,
    triggers: [{ event: "muneem/statement.extracted" }],
  },
  async ({ event, step, logger }: { event: { id: string; data: { statementId: string } }; step: { run: <T>(id: string, fn: () => Promise<T>) => Promise<T> }; logger: { info: (msg: string, ctx?: object) => void } }) => {
    const { statementId } = event.data as { statementId: string };

    await step.run("interpret-statement", async () => {
      const statement = await db.query.bankStatements.findFirst({
        where: eq(bankStatements.id, statementId),
      });
      if (!statement) throw new Error(`Statement ${statementId} not found`);

      // Idempotency / phase gate
      if (statement.status !== "phase1_complete") {
        logger.info(
          "statement-interpret: skipping non-phase1_complete statement",
          { statementId, status: statement.status }
        );
        return;
      }

      if (!statement.phase1Markdown) {
        throw new InvalidPhase1MarkdownError(
          "phase1_markdown is null on phase1_complete row"
        );
      }

      const org = await db.query.clientOrgs.findFirst({
        where: eq(clientOrgs.id, statement.clientOrgId),
        columns: { firmId: true },
      });
      if (!org)
        throw new Error(`clientOrg ${statement.clientOrgId} not found`);

      const ctx: LogCtx = {
        runId: event.id,
        statementId,
        clientOrgId: statement.clientOrgId,
        firmId: org.firmId,
      };
      log("info", "statement-interpret: start", ctx);

      const profile = await db.query.clientProfiles.findFirst({
        where: eq(clientProfiles.clientOrgId, statement.clientOrgId),
      });
      if (!profile) {
        throw new Error(
          `client_profiles row missing for client_org ${statement.clientOrgId}`
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

      let llmClassifications = new Map<number, LlmClassification>();
      let normalisationMode: "llm" | "fallback" | "skipped" = "skipped";
      if (ruleResult.unmatched.length > 0) {
        const contextBlock = buildClientContextBlock(profile, knowledge);
        const classifyResult = await classifyResidueWithLlm(
          ruleResult.unmatched,
          contextBlock
        );
        if (classifyResult.mode === "llm") {
          llmClassifications = classifyResult.classifications;
          normalisationMode = "llm";
        } else {
          normalisationMode = "fallback";
        }
      }

      const extractionConfidence = doc.frontmatter.extraction_confidence;
      const rows = buildInterpretedRows({
        doc,
        ruleMatches: ruleResult.matches,
        llmClassifications,
        fallback: normalisationMode === "fallback",
        extractionConfidence,
      });

      assertIntegrity({ doc, rowsToInsert: rows });

      const parseMethod = await readD02ParseMethod(statementId);
      const normalisedSumMinor = computeNormalisedSumMinor(rows);

      await insertInterpretedRows({
        statementId,
        clientOrgId: statement.clientOrgId,
        firmId: org.firmId,
        currency: doc.frontmatter.currency,
        rows,
        normalisationMode,
        normalisedRowCount: rows.length,
        normalisedSumMinor,
        parseMethod,
      });

      // Emit event for future D06 match worker (PLANNED)
      await inngest.send({
        name: "muneem/interpretation.complete",
        data: {
          clientOrgId: statement.clientOrgId,
          statementId,
          trigger: "d03_complete",
        },
      });

      log("info", "statement-interpret: complete", ctx, {
        rows: rows.length,
        rule_hits: ruleResult.matches.size,
        llm_residue: ruleResult.unmatched.length,
        normalisation_mode: normalisationMode,
      });
    });
  }
);
