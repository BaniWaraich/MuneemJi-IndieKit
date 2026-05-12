/**
 * Script-generation rate limiter backed by PostgreSQL (statement_parse_log).
 * Replaces the original Redis-based implementation — no Redis needed with Inngest.
 */
import { and, eq, gte, count } from "drizzle-orm";
import { db } from "@/db";
import { statementParseLog } from "@/db/schema/muneem";

export class RateLimitExceededError extends Error {
  constructor(
    public readonly scope: "firm" | "global",
    public readonly used: number,
    public readonly cap: number
  ) {
    super(
      `script generation rate limit exceeded (${scope}): ${used}/${cap} for today`
    );
    this.name = "RateLimitExceededError";
  }
}

const FIRM_DAILY_CAP = Number(process.env.SCRIPT_GEN_FIRM_DAILY_CAP ?? 3);
const GLOBAL_DAILY_CAP = Number(process.env.SCRIPT_GEN_GLOBAL_DAILY_CAP ?? 20);

function startOfTodayUTC(): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

export async function checkAndIncrementScriptGenQuota(
  firmId: string
): Promise<void> {
  const todayStart = startOfTodayUTC();

  // Count new-script parse attempts for this firm today (pdfplumber_new = script was generated)
  const [firmRow] = await db
    .select({ n: count() })
    .from(statementParseLog)
    .where(
      and(
        eq(statementParseLog.firmId, firmId),
        eq(statementParseLog.parseMethod, "pdfplumber_new"),
        gte(statementParseLog.createdAt, todayStart)
      )
    );

  const firmCount = Number(firmRow?.n ?? 0) + 1; // +1 for the in-progress attempt
  if (firmCount > FIRM_DAILY_CAP) {
    throw new RateLimitExceededError("firm", firmCount, FIRM_DAILY_CAP);
  }

  const [globalRow] = await db
    .select({ n: count() })
    .from(statementParseLog)
    .where(
      and(
        eq(statementParseLog.parseMethod, "pdfplumber_new"),
        gte(statementParseLog.createdAt, todayStart)
      )
    );

  const globalCount = Number(globalRow?.n ?? 0) + 1;
  if (globalCount > GLOBAL_DAILY_CAP) {
    throw new RateLimitExceededError("global", globalCount, GLOBAL_DAILY_CAP);
  }
}
