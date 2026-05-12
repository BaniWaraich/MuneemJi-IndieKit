/**
 * D02: Statement Format Extraction — Inngest function.
 * Replaces workers/statement.worker.ts from the original BullMQ architecture.
 *
 * Event: "muneem/statement.uploaded"
 * Payload: { statementId: string }
 *
 * On completion, sends "muneem/statement.extracted" to trigger D03.
 */

import { eq } from "drizzle-orm";
import { inngest } from "@/lib/inngest/client";
import { db } from "@/db";
import {
  bankStatements,
  clientOrgs,
  statementParseLog,
} from "@/db/schema/muneem";
import { downloadToBuffer } from "@/lib/muneem-storage/download";
import { identifyBank } from "@/lib/statement-parser/identify-bank";
import {
  lookupScript,
  generateScript,
  storeScript,
  deactivateScript,
} from "@/lib/statement-parser/script-cache";
import { runPdfplumberScript } from "@/lib/statement-parser/run-pdfplumber";
import { extractHeaderText } from "@/lib/statement-parser/sandbox-client";
import { parseCsvWithLlm } from "@/lib/statement-parser/csv-llm-parser";
import {
  validateBalance,
  validateRunningBalances,
  assertSupportedCurrency,
} from "@/lib/statement-parser/validate-balance";
import { checkAndIncrementScriptGenQuota } from "@/lib/statement-parser/rate-limit";
import {
  renderMarkdownKv,
  computeExtractionConfidence,
  KvIntegrityError,
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

function isPdfBuffer(buf: Buffer): boolean {
  if (buf.length < 5) return false;
  return buf.slice(0, 5).toString("ascii") === "%PDF-";
}

function balanceErrorMessage(
  balance: ReturnType<typeof validateBalance>,
  running: ReturnType<typeof validateRunningBalances>
): string {
  if (!balance.pass)
    return `endpoint mismatch, computed=${balance.computedClosing}`;
  if (!running.pass)
    return `running-balance mismatch at row ${running.firstMismatchIndex}: expected=${running.expected}, got=${running.got}`;
  return "unknown";
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
  ctx: LogCtx
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
  sendEvent: (event: { name: string; data: object }) => Promise<void>
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
  },
  async ({ event, step, logger }: { event: { id: string; data: { statementId: string } }; step: { run: <T>(id: string, fn: () => Promise<T>) => Promise<T> }; logger: { info: (msg: string, ctx?: object) => void } }) => {
    const { statementId } = event.data as { statementId: string };

    await step.run("extract-statement", async () => {
      const statement = await db.query.bankStatements.findFirst({
        where: eq(bankStatements.id, statementId),
      });
      if (!statement) throw new Error(`Statement ${statementId} not found`);

      // Idempotency: skip if already past D02
      if (statement.status !== "processing") {
        logger.info("statement-extract: skipping non-processing statement", {
          statementId,
          status: statement.status,
        });
        return;
      }

      // CLAUDE.md rule #4: scan before process
      if (statement.scanStatus !== "clean") {
        throw new Error(
          `refusing to process statement with scan_status='${statement.scanStatus}' (must be 'clean')`
        );
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

      if (isPdfBuffer(fileBuffer)) {
        await handlePdf(statement, firmId, fileBuffer, ctx, sendEvent);
      } else if (statement.filename.toLowerCase().endsWith(".csv")) {
        await handleCsv(statement, firmId, fileBuffer, ctx, sendEvent);
      } else {
        throw new Error(
          "file does not start with %PDF- magic bytes and is not .csv"
        );
      }
    });
  }
);

async function handleCsv(
  statement: typeof bankStatements.$inferSelect,
  firmId: string,
  fileBuffer: Buffer,
  ctx: LogCtx,
  sendEvent: (e: { name: string; data: object }) => Promise<void>
): Promise<void> {
  const csvText = fileBuffer.toString("utf-8");
  const result = await parseCsvWithLlm(csvText);

  const currency = (result.currency || statement.currency || "INR").toUpperCase();
  assertSupportedCurrency(currency);
  if (statement.currency && currency !== statement.currency.toUpperCase()) {
    throw new Error(
      `extracted currency ${currency} does not match declared ${statement.currency}`
    );
  }

  const balanceResult = validateBalance({
    openingBalance: result.opening_balance,
    closingBalance: result.closing_balance,
    rows: result.transactions,
  });
  const runningBalances = validateRunningBalances({ rows: result.transactions });
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
    ctx
  );

  if (!balancePass) {
    throw new Error(
      `Balance validation failed for CSV statement ${statement.id}: ${balanceErrorMessage(balanceResult, runningBalances)}`
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
    sendEvent
  );
}

async function handlePdf(
  statement: typeof bankStatements.$inferSelect,
  firmId: string,
  pdfBuffer: Buffer,
  ctx: LogCtx,
  sendEvent: (e: { name: string; data: object }) => Promise<void>
): Promise<void> {
  const bankId = await identifyBank(pdfBuffer);

  let scriptCode: string;
  let scriptId: string | null = null;
  let isFromCache = false;

  if (bankId) {
    const cached = await lookupScript(firmId, bankId.bankIdentifier);
    if (cached) {
      scriptCode = cached.scriptCode;
      scriptId = cached.id;
      isFromCache = true;
    } else {
      await checkAndIncrementScriptGenQuota(firmId);
      scriptCode = await generateScript(bankId.rawHeaderText);
    }
  } else {
    const rawHeaderText = (await extractHeaderText(pdfBuffer)).trim();
    await checkAndIncrementScriptGenQuota(firmId);
    scriptCode = await generateScript(rawHeaderText);
  }

  let extraction: ExtractionResult;
  try {
    extraction = await runPdfplumberScript(scriptCode, pdfBuffer);
  } catch (err) {
    await safeWriteParseLog(
      {
        firmId,
        statementId: statement.id,
        parserScriptId: scriptId,
        parseMethod: isFromCache ? "pdfplumber_cached" : "pdfplumber_new",
        balanceCheckPass: false,
        transactionsFound: 0,
        openingBalance: null,
        closingBalance: null,
        computedClosing: null,
        errorMessage: `Script execution failed: ${(err as Error).message}`.slice(0, 500),
      },
      ctx
    );
    throw err;
  }

  const balanceResult = validateBalance({
    openingBalance: extraction.opening_balance,
    closingBalance: extraction.closing_balance,
    rows: extraction.transactions,
  });
  const runningBalances = validateRunningBalances({ rows: extraction.transactions });
  const balancePass = balanceResult.pass && runningBalances.pass;

  if (!balancePass && isFromCache) {
    await deactivateScript(scriptId!);
    const rawHeaderText = bankId?.rawHeaderText ?? "";
    await checkAndIncrementScriptGenQuota(firmId);
    const newScriptCode = await generateScript(rawHeaderText);

    let retryExtraction: ExtractionResult;
    try {
      retryExtraction = await runPdfplumberScript(newScriptCode, pdfBuffer);
    } catch (retryErr) {
      await safeWriteParseLog(
        {
          firmId,
          statementId: statement.id,
          parserScriptId: null,
          parseMethod: "pdfplumber_new",
          balanceCheckPass: false,
          transactionsFound: 0,
          openingBalance: null,
          closingBalance: null,
          computedClosing: null,
          errorMessage: `Retry script execution failed: ${(retryErr as Error).message}`.slice(0, 500),
        },
        ctx
      );
      throw retryErr;
    }

    const retryBalance = validateBalance({
      openingBalance: retryExtraction.opening_balance,
      closingBalance: retryExtraction.closing_balance,
      rows: retryExtraction.transactions,
    });
    const retryRunning = validateRunningBalances({ rows: retryExtraction.transactions });
    const retryPass = retryBalance.pass && retryRunning.pass;

    await safeWriteParseLog(
      {
        firmId,
        statementId: statement.id,
        parserScriptId: null,
        parseMethod: "pdfplumber_new",
        balanceCheckPass: retryPass,
        transactionsFound: retryExtraction.transactions.length,
        openingBalance: BigInt(Math.round(retryExtraction.opening_balance * 100)),
        closingBalance: BigInt(Math.round(retryExtraction.closing_balance * 100)),
        computedClosing: retryBalance.computedClosing,
        errorMessage: retryPass
          ? null
          : balanceErrorMessage(retryBalance, retryRunning),
      },
      ctx
    );

    if (!retryPass) {
      throw new Error(
        `Balance validation failed on retry for statement ${statement.id}: ${balanceErrorMessage(retryBalance, retryRunning)}. No further retries.`
      );
    }

    if (bankId) {
      await storeScript({
        firmId,
        bankIdentifier: bankId.bankIdentifier,
        bankName: bankId.bankName,
        country: bankId.country,
        scriptCode: newScriptCode,
        headerText: bankId.rawHeaderText,
      });
    }

    const extractionConfidence = computeExtractionConfidence({
      path: "pdfplumber_regen",
      bankIdentified: bankId !== null,
    });
    await writePhase1Markdown(
      statement,
      ctx,
      {
        bank: bankId,
        currency: (retryExtraction.currency || statement.currency || "INR").toUpperCase(),
        openingBalance: retryExtraction.opening_balance,
        closingBalance: retryExtraction.closing_balance,
        transactions: retryExtraction.transactions,
        extractionMethod: "pdfplumber_new",
        extractionConfidence,
      },
      sendEvent
    );
    return;
  }

  await safeWriteParseLog(
    {
      firmId,
      statementId: statement.id,
      parserScriptId: scriptId,
      parseMethod: isFromCache ? "pdfplumber_cached" : "pdfplumber_new",
      balanceCheckPass: balancePass,
      transactionsFound: extraction.transactions.length,
      openingBalance: BigInt(Math.round(extraction.opening_balance * 100)),
      closingBalance: BigInt(Math.round(extraction.closing_balance * 100)),
      computedClosing: balanceResult.computedClosing,
      errorMessage: balancePass
        ? null
        : balanceErrorMessage(balanceResult, runningBalances),
    },
    ctx
  );

  if (!balancePass) {
    throw new Error(
      `Balance validation failed for statement ${statement.id}: ${balanceErrorMessage(balanceResult, runningBalances)}`
    );
  }

  if (!isFromCache && bankId) {
    await storeScript({
      firmId,
      bankIdentifier: bankId.bankIdentifier,
      bankName: bankId.bankName,
      country: bankId.country,
      scriptCode,
      headerText: bankId.rawHeaderText,
    });
  }

  const path = isFromCache ? "pdfplumber_cached" : "pdfplumber_new_first_try";
  const extractionConfidence = computeExtractionConfidence({
    path,
    bankIdentified: bankId !== null,
  });

  const currency = (extraction.currency || statement.currency || "INR").toUpperCase();
  assertSupportedCurrency(currency);
  if (statement.currency && currency !== statement.currency.toUpperCase()) {
    throw new Error(
      `extracted currency ${currency} does not match declared ${statement.currency}`
    );
  }

  await writePhase1Markdown(
    statement,
    ctx,
    {
      bank: bankId,
      currency,
      openingBalance: extraction.opening_balance,
      closingBalance: extraction.closing_balance,
      transactions: extraction.transactions,
      extractionMethod: isFromCache ? "pdfplumber_cached" : "pdfplumber_new",
      extractionConfidence,
    },
    sendEvent
  );
}
