/**
 * D02: Statement Format Extraction — Inngest function.
 *
 * Event: "muneem/statement.uploaded" (D01 confirm route emits after S3 PUT)
 * Payload: { statementId: string, password?: string }
 *
 * PDF path is split into steps so scanned-page GPT-4o vision stays under the
 * Vercel Hobby ~60s cap. CSV path is a single step.
 *
 * On completion, sends "muneem/statement.extracted" to trigger D03.
 */

import { and, eq, notInArray } from "drizzle-orm";
import { NonRetriableError } from "inngest";
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
  renderPdfPage,
  EncryptedPdfError,
  WrongPdfPasswordError,
} from "@/lib/statement-parser/sandbox-client";
import { parseCsvWithLlm } from "@/lib/statement-parser/csv-llm-parser";
import { parseTextPagesWithLlm } from "@/lib/statement-parser/pdf-llm-parser";
import { extractScannedPageWithVision } from "@/lib/statement-parser/pdf-vision-parser";
import {
  parseExtractedPages,
  scannedPageNumbers,
  salvagePageNumbers,
  assertVisionPageCap,
  VisionPageCapError,
} from "@/lib/statement-parser/extracted-pages";
import {
  combinePageResults,
  mergePdfPageResults,
  PdfMergeError,
} from "@/lib/statement-parser/pdf-page-merge";
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
import type { NumberedPageResult } from "@/lib/statement-parser/page-schema";

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

type D02ParseMethod =
  | "pdfplumber_cached"
  | "pdfplumber_new"
  | "pdf_vision"
  | "csv_direct";

type ParseLogParams = {
  firmId: string;
  statementId: string;
  parserScriptId: string | null;
  parseMethod: D02ParseMethod;
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
  sendEvent?: (event: { name: string; data: object }) => Promise<void>,
): Promise<"phase1_complete" | "empty"> {
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

  if (!isEmpty && sendEvent) {
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
  return nextStatus;
}

export const statementExtract = inngest.createFunction(
  {
    id: "muneem-statement-extract",
    name: "Muneem: D02 Statement Format Extraction",
    concurrency: { limit: 2 },
    retries: 3,
    triggers: [{ event: "muneem/statement.uploaded" }],
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
    step: {
      run: <T>(id: string, fn: () => Promise<T>) => Promise<T>;
      sendEvent: (
        id: string,
        payload: { name: string; data: object },
      ) => Promise<unknown>;
    };
    logger: { info: (msg: string, ctx?: object) => void };
  }) => {
    const { statementId, password } = event.data as {
      statementId: string;
      password?: string;
    };

    const prep = await step.run("load-statement", async () => {
      const statement = await db.query.bankStatements.findFirst({
        where: eq(bankStatements.id, statementId),
      });
      if (!statement) throw new Error(`Statement ${statementId} not found`);

      if (
        statement.status !== "processing" &&
        statement.status !== "unlocking"
      ) {
        logger.info("statement-extract: skipping non-processing statement", {
          statementId,
          status: statement.status,
        });
        return { skip: true as const };
      }

      const firmId = await resolveFirmId(statement.clientOrgId);
      const fileBuffer = await downloadToBuffer(statement.s3Key);
      const fileKind = isPdfBuffer(fileBuffer)
        ? ("pdf" as const)
        : statement.filename.toLowerCase().endsWith(".csv")
          ? ("csv" as const)
          : ("unknown" as const);

      if (fileKind === "unknown") {
        await db
          .update(bankStatements)
          .set({
            status: "failed",
            errorMessage:
              "file does not start with %PDF- magic bytes and is not .csv",
          })
          .where(eq(bankStatements.id, statement.id));
        throw new NonRetriableError(
          "file does not start with %PDF- magic bytes and is not .csv",
        );
      }

      log(
        "info",
        "statement-extract: start",
        {
          runId: event.id,
          statementId: statement.id,
          firmId,
          clientOrgId: statement.clientOrgId,
        },
        { filename: statement.filename, fileKind },
      );

      return {
        skip: false as const,
        fileKind,
        statementId: statement.id,
        firmId,
        clientOrgId: statement.clientOrgId,
        s3Key: statement.s3Key,
        filename: statement.filename,
      };
    });

    if (prep.skip) return;

    const ctx: LogCtx = {
      runId: event.id,
      statementId: prep.statementId,
      firmId: prep.firmId,
      clientOrgId: prep.clientOrgId,
    };

    if (prep.fileKind === "csv") {
      await step.run("extract-csv", async () => {
        const statement = await db.query.bankStatements.findFirst({
          where: eq(bankStatements.id, prep.statementId),
        });
        if (!statement)
          throw new Error(`Statement ${prep.statementId} not found`);
        const fileBuffer = await downloadToBuffer(prep.s3Key);
        await handleCsv(statement, prep.firmId, fileBuffer, ctx, async (e) => {
          await inngest.send(e);
        });
      });
      return;
    }

    const extracted = await step.run("extract-pages", async () => {
      const buf = await downloadToBuffer(prep.s3Key);
      try {
        const raw = await extractPdfPages(buf, password);
        return {
          status: "ok" as const,
          pages: parseExtractedPages(raw),
          rawPagesJson: raw,
        };
      } catch (err) {
        if (err instanceof EncryptedPdfError) {
          return { status: "encrypted" as const };
        }
        if (err instanceof WrongPdfPasswordError) {
          return { status: "wrong_password" as const };
        }
        throw err;
      }
    });

    if (extracted.status !== "ok") {
      await step.run("mark-password-required", async () => {
        const wrong = extracted.status === "wrong_password";
        await db
          .update(bankStatements)
          .set({
            status: "password_required",
            errorMessage: wrong
              ? "The password you entered is incorrect. Please try again."
              : null,
          })
          .where(eq(bankStatements.id, prep.statementId));
        log("info", "statement-extract: awaiting PDF password", ctx, {
          wrongPassword: wrong,
        });
      });
      return;
    }

    try {
      assertVisionPageCap(scannedPageNumbers(extracted.pages).length);
    } catch (err) {
      if (err instanceof VisionPageCapError) {
        await step.run("mark-vision-cap-initial", async () => {
          await db
            .update(bankStatements)
            .set({ status: "failed", errorMessage: err.message.slice(0, 500) })
            .where(eq(bankStatements.id, prep.statementId));
        });
        throw new NonRetriableError(err.message);
      }
      throw err;
    }

    const textPages = await step.run("parse-text-pages", async () =>
      parseTextPagesWithLlm(extracted.pages),
    );

    const txCountByPage = new Map(
      textPages.map((p) => [p.page, p.transactions.length]),
    );
    const visionNums = [
      ...new Set([
        ...scannedPageNumbers(extracted.pages),
        ...salvagePageNumbers(extracted.pages, txCountByPage),
      ]),
    ].sort((a, b) => a - b);

    try {
      assertVisionPageCap(visionNums.length);
    } catch (err) {
      if (err instanceof VisionPageCapError) {
        await step.run("mark-vision-cap-salvage", async () => {
          await db
            .update(bankStatements)
            .set({ status: "failed", errorMessage: err.message.slice(0, 500) })
            .where(eq(bankStatements.id, prep.statementId));
        });
        throw new NonRetriableError(err.message);
      }
      throw err;
    }

    const visionPages: NumberedPageResult[] = [];
    for (const n of visionNums) {
      const one = await step.run(`vision-page-${n}`, async () => {
        const buf = await downloadToBuffer(prep.s3Key);
        const rendered = await renderPdfPage(buf, n, password);
        const parsed = await extractScannedPageWithVision(
          n,
          rendered.jpegBase64,
        );
        return {
          page: n,
          currency: parsed.currency,
          transactions: parsed.transactions,
        };
      });
      visionPages.push(one);
    }

    const usedVision = visionNums.length > 0;
    const finalized = await step.run("finalize-pdf", async () =>
      finalizePdf({
        statementId: prep.statementId,
        firmId: prep.firmId,
        ctx,
        textPages,
        visionPages,
        usedVision,
        rawPagesJson: extracted.rawPagesJson,
      }),
    );

    if (finalized.emit) {
      await step.sendEvent("emit-extracted", {
        name: "muneem/statement.extracted",
        data: { statementId: prep.statementId },
      });
    }
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

async function finalizePdf(input: {
  statementId: string;
  firmId: string;
  ctx: LogCtx;
  textPages: NumberedPageResult[];
  visionPages: NumberedPageResult[];
  usedVision: boolean;
  rawPagesJson: string;
}): Promise<{ emit: boolean }> {
  const statement = await db.query.bankStatements.findFirst({
    where: eq(bankStatements.id, input.statementId),
  });
  if (!statement) throw new Error(`Statement ${input.statementId} not found`);

  const combined = combinePageResults(input.textPages, input.visionPages);
  let result;
  try {
    result = mergePdfPageResults(combined);
  } catch (err) {
    const message =
      err instanceof PdfMergeError ? err.message : (err as Error).message;
    await safeWriteParseLog(
      {
        firmId: input.firmId,
        statementId: statement.id,
        parserScriptId: null,
        parseMethod: input.usedVision ? "pdf_vision" : "pdfplumber_new",
        balanceCheckPass: false,
        transactionsFound: 0,
        openingBalance: null,
        closingBalance: null,
        computedClosing: null,
        errorMessage: JSON.stringify({ reason: "empty", message }),
      },
      input.ctx,
    );
    await db
      .update(bankStatements)
      .set({ status: "failed", errorMessage: message.slice(0, 500) })
      .where(eq(bankStatements.id, statement.id));
    throw new NonRetriableError(
      `PDF extraction failed for statement ${statement.id}: ${message}`,
    );
  }

  const currency = (
    result.currency ||
    statement.currency ||
    "INR"
  ).toUpperCase();
  try {
    assertSupportedCurrency(currency);
  } catch (err) {
    throw new NonRetriableError((err as Error).message);
  }
  if (statement.currency && currency !== statement.currency.toUpperCase()) {
    throw new NonRetriableError(
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

  const rawPagesAroundMismatch =
    mismatchIdx != null && rowsAroundMismatch.length > 0
      ? sliceRawAroundDate(input.rawPagesJson, rowsAroundMismatch[0].date)
      : "";

  const parseMethod: D02ParseMethod = input.usedVision
    ? "pdf_vision"
    : "pdfplumber_new";
  const extractionMethod: ExtractionMethod = input.usedVision
    ? "pdf_vision"
    : "pdfplumber_new";

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
        used_vision: input.usedVision,
        vision_pages: input.visionPages.map((p) => p.page),
      });

  await safeWriteParseLog(
    {
      firmId: input.firmId,
      statementId: statement.id,
      parserScriptId: null,
      parseMethod,
      balanceCheckPass: balancePass,
      transactionsFound: result.transactions.length,
      openingBalance: BigInt(Math.round(result.opening_balance * 100)),
      closingBalance: BigInt(Math.round(result.closing_balance * 100)),
      computedClosing: balanceResult.computedClosing,
      errorMessage: balancePass ? null : diagnosticPayload,
    },
    input.ctx,
  );

  if (!balancePass) {
    const message = isEmpty
      ? "zero transactions"
      : balanceErrorMessage(balanceResult, runningBalances);
    await db
      .update(bankStatements)
      .set({
        status: "failed",
        errorMessage:
          `PDF extraction failed for statement ${statement.id}: ${message}`.slice(
            0,
            500,
          ),
      })
      .where(eq(bankStatements.id, statement.id));
    throw new NonRetriableError(
      `PDF extraction failed for statement ${statement.id}: ${message}`,
    );
  }

  const extractionConfidence = computeExtractionConfidence({
    path: input.usedVision ? "pdf_vision" : "pdfplumber_new_first_try",
    bankIdentified: false,
  });

  const status = await writePhase1Markdown(statement, input.ctx, {
    bank: null,
    currency,
    openingBalance: result.opening_balance,
    closingBalance: result.closing_balance,
    transactions: result.transactions,
    extractionMethod,
    extractionConfidence,
  });

  return { emit: status === "phase1_complete" };
}
