/**
 * D02: Statement Format Extraction — Inngest function.
 * Replaces workers/statement.worker.ts from the original BullMQ architecture.
 *
 * Event: "muneem/statement.uploaded" (D01 confirm route emits after S3 PUT)
 * Payload: { statementId: string }
 *
 * On completion, sends "muneem/statement.extracted" to trigger D03.
 */

import { and, eq, notInArray } from "drizzle-orm";
import { inngest } from "@/lib/inngest/client";
import { db } from "@/db";
import {
  bankStatements,
  clientOrgs,
  statementParseLog,
} from "@/db/schema/muneem";
import { downloadToBuffer } from "@/lib/muneem-storage/download";
import {
  extractPdfPages,
  EncryptedPdfError,
  WrongPdfPasswordError,
} from "@/lib/statement-parser/sandbox-client";
import { parseCsvWithLlm } from "@/lib/statement-parser/csv-llm-parser";
import { parsePdfWithLlm } from "@/lib/statement-parser/pdf-llm-parser";
import {
  validateBalance,
  validateRunningBalances,
  assertSupportedCurrency,
} from "@/lib/statement-parser/validate-balance";
import {
  renderMarkdownKv,
  computeExtractionConfidence,
  type ExtractionMethod,
} from "@/lib/statement-parser/render-markdown-kv";
import type {
  ExtractionResult,
  BankIdentification,
} from "@/lib/statement-parser/types";

type LogCtx = {
  runId?: string;
  statementId?: string;
  firmId?: string;
  clientOrgId?: string;
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

function isPdfBuffer(buf: Buffer): boolean {
  if (buf.length < 5) return false;
  return buf.slice(0, 5).toString("ascii") === "%PDF-";
}

/**
 * Locate a date (in any common bank-statement format) within the raw
 * pdfplumber page JSON and return ~30 lines of context centred on the
 * first match. Used only for diagnostics — best-effort, not exact.
 */
function sliceRawAroundDate(rawPagesJson: string, isoDate: string): string {
  try {
    const parsed = JSON.parse(rawPagesJson) as {
      pages: { page: number; text: string }[];
    };
    const [y, m, d] = isoDate.split("-");
    const candidates = [
      `${d}/${m}/${y.slice(2)}`,
      `${d}/${m}/${y}`,
      `${d}-${m}-${y}`,
      `${d}-${m}-${y.slice(2)}`,
    ];
    const fullText = parsed.pages
      .map((p) => `===== PAGE ${p.page} =====\n${p.text}`)
      .join("\n");
    const lines = fullText.split("\n");
    for (const needle of candidates) {
      const hitIdx = lines.findIndex((line) => line.includes(needle));
      if (hitIdx >= 0) {
        const start = Math.max(0, hitIdx - 5);
        const end = Math.min(lines.length, hitIdx + 25);
        return lines.slice(start, end).join("\n");
      }
    }
    return "no match for any candidate date format";
  } catch (err) {
    return `sliceRawAroundDate failed: ${(err as Error).message}`;
  }
}

function balanceErrorMessage(
  balance: ReturnType<typeof validateBalance>,
  running: ReturnType<typeof validateRunningBalances>,
): string {
  const parts: string[] = [];
  if (!balance.pass)
    parts.push(`endpoint mismatch, computed=${balance.computedClosing}`);
  if (!running.pass)
    parts.push(
      `running-balance mismatch at row ${running.firstMismatchIndex}: expected=${running.expected}, got=${running.got}`,
    );
  return parts.length ? parts.join("; ") : "unknown";
}

async function resolveFirmId(clientOrgId: string): Promise<string> {
  const org = await db.query.clientOrgs.findFirst({
    where: eq(clientOrgs.id, clientOrgId),
    columns: { firmId: true },
  });
  if (!org) throw new Error(`clientOrg ${clientOrgId} not found`);
  return org.firmId;
}

type ParseLogParams = {
  firmId: string;
  statementId: string;
  parserScriptId: string | null;
  parseMethod: "pdfplumber_cached" | "pdfplumber_new" | "csv_direct";
  balanceCheckPass: boolean;
  transactionsFound: number;
  openingBalance: bigint | null;
  closingBalance: bigint | null;
  computedClosing: bigint | null;
  errorMessage: string | null;
};

async function safeWriteParseLog(
  params: ParseLogParams,
  ctx: LogCtx,
): Promise<void> {
  try {
    await db.insert(statementParseLog).values(params);
  } catch (err) {
    log("error", "statement-extract: parse-log write failed", ctx, {
      err: (err as Error).message,
    });
  }
}

async function writePhase1Markdown(
  statement: typeof bankStatements.$inferSelect,
  ctx: LogCtx,
  input: {
    bank: BankIdentification | null;
    currency: string;
    openingBalance: number;
    closingBalance: number;
    transactions: ExtractionResult["transactions"];
    extractionMethod: ExtractionMethod;
    extractionConfidence: number;
  },
  sendEvent: (event: { name: string; data: object }) => Promise<void>,
): Promise<void> {
  const { markdown, periodStart, periodEnd } = renderMarkdownKv({
    bank: input.bank,
    currency: input.currency,
    openingBalance: input.openingBalance,
    closingBalance: input.closingBalance,
    transactions: input.transactions,
    extractionMethod: input.extractionMethod,
    extractionConfidence: input.extractionConfidence,
    accountHolder: null,
    accountNumberLast4: null,
  });

  const isEmpty = input.transactions.length === 0;
  const nextStatus: "phase1_complete" | "empty" = isEmpty
    ? "empty"
    : "phase1_complete";

  await db
    .update(bankStatements)
    .set({
      status: nextStatus,
      errorMessage: null,
      phase1Markdown: markdown,
      periodStart: periodStart ?? statement.periodStart,
      periodEnd: periodEnd ?? statement.periodEnd,
      currency: input.currency,
    })
    .where(eq(bankStatements.id, statement.id));

  if (!isEmpty) {
    await sendEvent({
      name: "muneem/statement.extracted",
      data: { statementId: statement.id },
    });
  }

  log("info", "statement-extract: phase1 complete", ctx, {
    rows: input.transactions.length,
    status: nextStatus,
    extractionMethod: input.extractionMethod,
  });
}

export const statementExtract = inngest.createFunction(
  {
    id: "muneem-statement-extract",
    name: "Muneem: D02 Statement Format Extraction",
    concurrency: { limit: 2 },
    retries: 3,
    triggers: [{ event: "muneem/statement.uploaded" }],
    // Safety net: if all retries are exhausted — including a serverless
    // timeout-kill that bypasses the in-handler try/catch — mark the statement
    // failed so it surfaces instead of silently sitting at 'processing'.
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
              notInArray(bankStatements.status, [
                "phase1_complete",
                "parsed",
                "empty",
                // Locked-PDF states are not failures — never let onFailure
                // overwrite them with `failed`.
                "password_required",
                "unlocking",
              ]),
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
    event: { id: string; data: { statementId: string; password?: string } };
    step: { run: <T>(id: string, fn: () => Promise<T>) => Promise<T> };
    logger: { info: (msg: string, ctx?: object) => void };
  }) => {
    const { statementId, password } = event.data as {
      statementId: string;
      password?: string;
    };

    await step.run("extract-statement", async () => {
      const statement = await db.query.bankStatements.findFirst({
        where: eq(bankStatements.id, statementId),
      });
      if (!statement) throw new Error(`Statement ${statementId} not found`);

      // Idempotency: process only fresh uploads (`processing`) and unlock
      // retries (`unlocking`, set by the unlock route when re-firing this
      // event with a password). Any other status means D02 already ran or is
      // awaiting user input — skip.
      if (
        statement.status !== "processing" &&
        statement.status !== "unlocking"
      ) {
        logger.info("statement-extract: skipping non-processing statement", {
          statementId,
          status: statement.status,
        });
        return;
      }

      const firmId = await resolveFirmId(statement.clientOrgId);
      const ctx: LogCtx = {
        runId: event.id,
        statementId: statement.id,
        firmId,
        clientOrgId: statement.clientOrgId,
      };

      log("info", "statement-extract: start", ctx, {
        filename: statement.filename,
      });

      const fileBuffer = await downloadToBuffer(statement.s3Key);

      const sendEvent = async (e: { name: string; data: object }) => {
        await inngest.send(e);
      };

      try {
        if (isPdfBuffer(fileBuffer)) {
          await handlePdf(statement, firmId, fileBuffer, ctx, sendEvent, password);
        } else if (statement.filename.toLowerCase().endsWith(".csv")) {
          await handleCsv(statement, firmId, fileBuffer, ctx, sendEvent);
        } else {
          throw new Error(
            "file does not start with %PDF- magic bytes and is not .csv",
          );
        }
      } catch (err) {
        // Locked-PDF signals are NOT failures: park the statement in
        // `password_required` and return normally so Inngest does not retry
        // and onFailure does not mark it `failed`. The password (if any) is
        // never logged or persisted.
        if (
          err instanceof EncryptedPdfError ||
          err instanceof WrongPdfPasswordError
        ) {
          const wrong = err instanceof WrongPdfPasswordError;
          await db
            .update(bankStatements)
            .set({
              status: "password_required",
              errorMessage: wrong
                ? "The password you entered is incorrect. Please try again."
                : null,
            })
            .where(eq(bankStatements.id, statement.id));
          log("info", "statement-extract: awaiting PDF password", ctx, {
            wrongPassword: wrong,
          });
          return;
        }

        const message = (
          err instanceof Error ? err.message : String(err)
        ).slice(0, 500);
        await db
          .update(bankStatements)
          .set({ status: "failed", errorMessage: message })
          .where(eq(bankStatements.id, statement.id));
        log("error", "statement-extract: marked failed", ctx, {
          error: message,
        });
        throw err;
      }
    });
  },
);

async function handleCsv(
  statement: typeof bankStatements.$inferSelect,
  firmId: string,
  fileBuffer: Buffer,
  ctx: LogCtx,
  sendEvent: (e: { name: string; data: object }) => Promise<void>,
): Promise<void> {
  const csvText = fileBuffer.toString("utf-8");
  const result = await parseCsvWithLlm(csvText);

  const currency = (
    result.currency ||
    statement.currency ||
    "INR"
  ).toUpperCase();
  assertSupportedCurrency(currency);
  if (statement.currency && currency !== statement.currency.toUpperCase()) {
    throw new Error(
      `extracted currency ${currency} does not match declared ${statement.currency}`,
    );
  }

  const balanceResult = validateBalance({
    openingBalance: result.opening_balance,
    closingBalance: result.closing_balance,
    rows: result.transactions,
  });
  const runningBalances = validateRunningBalances({
    rows: result.transactions,
  });
  const balancePass = balanceResult.pass && runningBalances.pass;

  await safeWriteParseLog(
    {
      firmId,
      statementId: statement.id,
      parserScriptId: null,
      parseMethod: "csv_direct",
      balanceCheckPass: balancePass,
      transactionsFound: result.transactions.length,
      openingBalance: BigInt(Math.round(result.opening_balance * 100)),
      closingBalance: BigInt(Math.round(result.closing_balance * 100)),
      computedClosing: balanceResult.computedClosing,
      errorMessage: balancePass
        ? null
        : balanceErrorMessage(balanceResult, runningBalances),
    },
    ctx,
  );

  if (!balancePass) {
    throw new Error(
      `Balance validation failed for CSV statement ${statement.id}: ${balanceErrorMessage(balanceResult, runningBalances)}`,
    );
  }

  const extractionConfidence = computeExtractionConfidence({
    path: "csv_llm",
    bankIdentified: false,
  });

  await writePhase1Markdown(
    statement,
    ctx,
    {
      bank: null,
      currency,
      openingBalance: result.opening_balance,
      closingBalance: result.closing_balance,
      transactions: result.transactions,
      extractionMethod: "csv_llm" as ExtractionMethod,
      extractionConfidence,
    },
    sendEvent,
  );
}

async function handlePdf(
  statement: typeof bankStatements.$inferSelect,
  firmId: string,
  pdfBuffer: Buffer,
  ctx: LogCtx,
  sendEvent: (e: { name: string; data: object }) => Promise<void>,
  password?: string,
): Promise<void> {
  // password (when present) unlocks encrypted PDFs. extractPdfPages throws
  // EncryptedPdfError / WrongPdfPasswordError, caught by the orchestrator above.
  const rawPagesJson = await extractPdfPages(pdfBuffer, password);
  const result = await parsePdfWithLlm(rawPagesJson);

  const currency = (
    result.currency ||
    statement.currency ||
    "INR"
  ).toUpperCase();
  assertSupportedCurrency(currency);
  if (statement.currency && currency !== statement.currency.toUpperCase()) {
    throw new Error(
      `extracted currency ${currency} does not match declared ${statement.currency}`,
    );
  }

  const balanceResult = validateBalance({
    openingBalance: result.opening_balance,
    closingBalance: result.closing_balance,
    rows: result.transactions,
  });
  const runningBalances = validateRunningBalances({
    rows: result.transactions,
  });
  const isEmpty = result.transactions.length === 0;
  const balancePass = balanceResult.pass && runningBalances.pass && !isEmpty;

  const mismatchIdx = runningBalances.firstMismatchIndex;
  const windowStart = mismatchIdx != null ? Math.max(0, mismatchIdx - 2) : 0;
  const windowEnd =
    mismatchIdx != null
      ? Math.min(result.transactions.length, mismatchIdx + 3)
      : 0;
  const rowsAroundMismatch =
    mismatchIdx != null
      ? result.transactions.slice(windowStart, windowEnd).map((r, i) => ({
          idx: windowStart + i,
          ...r,
        }))
      : [];

  // Best-effort: find the raw PDF page(s) that mention the dates in the
  // window so the operator can eyeball raw vs parsed. We don't have an
  // exact row→page map (LLM mediates), so we slice the raw text around
  // the first matching date occurrence.
  const rawPagesAroundMismatch =
    mismatchIdx != null && rowsAroundMismatch.length > 0
      ? sliceRawAroundDate(rawPagesJson, rowsAroundMismatch[0].date)
      : "";

  const diagnosticPayload = balancePass
    ? null
    : JSON.stringify({
        reason: isEmpty
          ? "empty"
          : balanceErrorMessage(balanceResult, runningBalances),
        opening_balance: result.opening_balance,
        closing_balance: result.closing_balance,
        computed_minor: balanceResult.computedClosing.toString(),
        tx_count: result.transactions.length,
        first_three: result.transactions.slice(0, 3),
        last_three: result.transactions.slice(-3),
        mismatch_idx: mismatchIdx,
        llm_rows_around_mismatch: rowsAroundMismatch,
        raw_text_around_mismatch: rawPagesAroundMismatch,
      });

  await safeWriteParseLog(
    {
      firmId,
      statementId: statement.id,
      parserScriptId: null,
      parseMethod: "pdfplumber_new",
      balanceCheckPass: balancePass,
      transactionsFound: result.transactions.length,
      openingBalance: BigInt(Math.round(result.opening_balance * 100)),
      closingBalance: BigInt(Math.round(result.closing_balance * 100)),
      computedClosing: balanceResult.computedClosing,
      // No truncation — error_message is `text`. The raw + parsed
      // side-by-side is the whole point of this diagnostic.
      errorMessage: balancePass ? null : diagnosticPayload,
    },
    ctx,
  );

  if (!balancePass) {
    throw new Error(
      `PDF extraction failed for statement ${statement.id}: ${
        isEmpty
          ? "zero transactions"
          : balanceErrorMessage(balanceResult, runningBalances)
      }`,
    );
  }

  const extractionConfidence = computeExtractionConfidence({
    path: "pdfplumber_new_first_try",
    bankIdentified: false,
  });

  await writePhase1Markdown(
    statement,
    ctx,
    {
      bank: null,
      currency,
      openingBalance: result.opening_balance,
      closingBalance: result.closing_balance,
      transactions: result.transactions,
      extractionMethod: "pdfplumber_new",
      extractionConfidence,
    },
    sendEvent,
  );
}
