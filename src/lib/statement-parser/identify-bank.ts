import { extractHeaderText } from './sandbox-client';
import type { BankIdentification } from './types';

/**
 * Bank identification patterns. Each entry: [regex, bank code, human-readable
 * name, ISO country]. Matches are scored by global match count in the header
 * window; the winner must beat the runner-up by MIN_MARGIN.
 */
const BANK_PATTERNS: [RegExp, string, string, string][] = [
  [/HDFC\s*Bank/gi, 'HDFC', 'HDFC Bank', 'IN'],
  [/State\s*Bank\s*of\s*India|(?<!\w)SBI(?!\w)/gi, 'SBI', 'State Bank of India', 'IN'],
  [/ICICI\s*Bank/gi, 'ICICI', 'ICICI Bank', 'IN'],
  [/Axis\s*Bank/gi, 'AXIS', 'Axis Bank', 'IN'],
  [/Kotak\s*Mahindra/gi, 'KOTAK', 'Kotak Mahindra Bank', 'IN'],
  [/Punjab\s*National\s*Bank|(?<!\w)PNB(?!\w)/gi, 'PNB', 'Punjab National Bank', 'IN'],
  [/Bank\s*of\s*Baroda/gi, 'BOB', 'Bank of Baroda', 'IN'],
  [/Canara\s*Bank/gi, 'CANARA', 'Canara Bank', 'IN'],
  [/Union\s*Bank\s*of\s*India/gi, 'UNION', 'Union Bank of India', 'IN'],
  [/IndusInd\s*Bank/gi, 'INDUSIND', 'IndusInd Bank', 'IN'],
  [/Yes\s*Bank/gi, 'YES', 'Yes Bank', 'IN'],
  [/Federal\s*Bank/gi, 'FEDERAL', 'Federal Bank', 'IN'],
  [/IDBI\s*Bank/gi, 'IDBI', 'IDBI Bank', 'IN'],
  [/Indian\s*Overseas\s*Bank/gi, 'IOB', 'Indian Overseas Bank', 'IN'],
  [/Royal\s*Bank\s*of\s*Canada|(?<!\w)RBC(?!\w)/gi, 'RBC', 'Royal Bank of Canada', 'CA'],
  [/TD\s*Canada\s*Trust/gi, 'TD', 'TD Canada Trust', 'CA'],
  [/Bank\s*of\s*Ireland/gi, 'BOI', 'Bank of Ireland', 'IE'],
  [/Allied\s*Irish\s*Banks|(?<!\w)AIB(?!\w)/gi, 'AIB', 'Allied Irish Banks', 'IE'],
];

const HEADER_WINDOW_BYTES = 2048;
const MIN_MARGIN = 2;

export async function identifyBank(pdfBuffer: Buffer): Promise<BankIdentification | null> {
  const rawHeaderText = (await extractHeaderText(pdfBuffer)).trim();
  if (!rawHeaderText) return null;

  // Top-of-statement window only. Bank names repeat in watermarks / footers;
  // scoring the whole text lets a stray mention of a competitor bank win.
  const window = rawHeaderText.slice(0, HEADER_WINDOW_BYTES);

  const scores: { code: string; name: string; country: string; count: number }[] = [];
  for (const [pattern, code, bankName, country] of BANK_PATTERNS) {
    const matches = window.match(pattern);
    const count = matches ? matches.length : 0;
    if (count > 0) scores.push({ code, name: bankName, country, count });
  }

  if (scores.length === 0) return null;
  scores.sort((a, b) => b.count - a.count);
  const top = scores[0];
  const runnerUp = scores[1];
  if (runnerUp && top.count - runnerUp.count < MIN_MARGIN) return null;

  return {
    bankIdentifier: `${top.code}_${top.country}`,
    bankName: top.name,
    country: top.country,
    rawHeaderText,
  };
}
