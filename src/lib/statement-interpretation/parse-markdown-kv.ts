export class InvalidPhase1MarkdownError extends Error {
  constructor(detail: string) {
    super(`invalid phase1 markdown: ${detail}`);
    this.name = 'InvalidPhase1MarkdownError';
  }
}

export type Phase1Frontmatter = {
  account_holder: string | null;
  account_number_last4: string | null;
  bank_name: string | null;
  bank_identifier: string | null;
  country: string | null;
  period_start: string | null;
  period_end: string | null;
  opening_balance_minor: bigint;
  closing_balance_minor: bigint;
  currency: string;
  transaction_count: number;
  extraction_method: string;
  extraction_confidence: number;
};

export type Phase1Transaction = {
  transaction_index: number;
  date: string;
  description: string;
  debit_minor: bigint;
  credit_minor: bigint;
  balance_minor: bigint;
};

export type Phase1Document = {
  frontmatter: Phase1Frontmatter;
  transactions: Phase1Transaction[];
};

const FRONTMATTER_DELIM = '---';
const TX_HEADER_RE = /^## Transaction (\d+)$/;
const KV_RE = /^- ([a-z_]+):\s?(.*)$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function parsePhase1Markdown(md: string): Phase1Document {
  if (!md || typeof md !== 'string') {
    throw new InvalidPhase1MarkdownError('empty or non-string input');
  }
  const lines = md.split('\n');

  if (lines[0]?.trim() !== FRONTMATTER_DELIM) {
    throw new InvalidPhase1MarkdownError('missing opening frontmatter delimiter');
  }
  let i = 1;
  const fmLines: string[] = [];
  while (i < lines.length && lines[i].trim() !== FRONTMATTER_DELIM) {
    fmLines.push(lines[i]);
    i++;
  }
  if (i >= lines.length) {
    throw new InvalidPhase1MarkdownError('missing closing frontmatter delimiter');
  }
  i++;

  const frontmatter = parseFrontmatter(fmLines);
  const transactions = parseTransactionBlocks(lines.slice(i));

  if (transactions.length !== frontmatter.transaction_count) {
    throw new InvalidPhase1MarkdownError(
      `frontmatter transaction_count ${frontmatter.transaction_count} ≠ block count ${transactions.length}`,
    );
  }
  return { frontmatter, transactions };
}

function parseFrontmatter(lines: string[]): Phase1Frontmatter {
  const map = new Map<string, string>();
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (line.length === 0) continue;
    const idx = line.indexOf(':');
    if (idx < 0) {
      throw new InvalidPhase1MarkdownError(`frontmatter line missing colon: ${line}`);
    }
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    map.set(key, value);
  }

  return {
    account_holder: nullableString(map.get('account_holder')),
    account_number_last4: nullableString(map.get('account_number_last4')),
    bank_name: nullableString(map.get('bank_name')),
    bank_identifier: nullableString(map.get('bank_identifier')),
    country: nullableString(map.get('country')),
    period_start: nullableString(map.get('period_start')),
    period_end: nullableString(map.get('period_end')),
    opening_balance_minor: requireBigint(map, 'opening_balance_minor'),
    closing_balance_minor: requireBigint(map, 'closing_balance_minor'),
    currency: requireString(map, 'currency'),
    transaction_count: requireInt(map, 'transaction_count'),
    extraction_method: requireString(map, 'extraction_method'),
    extraction_confidence: requireFloat(map, 'extraction_confidence'),
  };
}

function parseTransactionBlocks(lines: string[]): Phase1Transaction[] {
  const out: Phase1Transaction[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i].trim();
    if (line.length === 0) {
      i++;
      continue;
    }
    const m = line.match(TX_HEADER_RE);
    if (!m) {
      throw new InvalidPhase1MarkdownError(`unexpected line outside transaction block: ${line}`);
    }
    const index = Number(m[1]);
    i++;

    const fields = new Map<string, string>();
    while (i < lines.length && lines[i].trim().startsWith('- ')) {
      const f = lines[i].match(KV_RE);
      if (!f) {
        throw new InvalidPhase1MarkdownError(`malformed transaction line: ${lines[i]}`);
      }
      fields.set(f[1], f[2]);
      i++;
    }

    const date = fields.get('date');
    if (!date || !DATE_RE.test(date)) {
      throw new InvalidPhase1MarkdownError(`transaction ${index}: invalid date '${date}'`);
    }
    const description = fields.get('description');
    if (description == null) {
      throw new InvalidPhase1MarkdownError(`transaction ${index}: missing description`);
    }
    const debit_minor = requireBigintField(fields, 'debit_minor', index);
    const credit_minor = requireBigintField(fields, 'credit_minor', index);
    const balance_minor = requireBigintField(fields, 'balance_minor', index);

    if (debit_minor !== 0n && credit_minor !== 0n) {
      throw new InvalidPhase1MarkdownError(
        `transaction ${index}: both debit_minor and credit_minor non-zero`,
      );
    }

    out.push({
      transaction_index: index,
      date,
      description,
      debit_minor,
      credit_minor,
      balance_minor,
    });
  }
  return out;
}

function nullableString(v: string | undefined): string | null {
  if (v == null) return null;
  if (v === 'null') return null;
  if (v.startsWith('"') && v.endsWith('"')) {
    try {
      return JSON.parse(v) as string;
    } catch {
      return v.slice(1, -1);
    }
  }
  return v;
}

function requireString(map: Map<string, string>, key: string): string {
  const v = map.get(key);
  if (v == null || v === 'null') {
    throw new InvalidPhase1MarkdownError(`frontmatter missing required key: ${key}`);
  }
  return nullableString(v) ?? '';
}

function requireBigint(map: Map<string, string>, key: string): bigint {
  const v = map.get(key);
  if (v == null) throw new InvalidPhase1MarkdownError(`frontmatter missing: ${key}`);
  try {
    return BigInt(v);
  } catch {
    throw new InvalidPhase1MarkdownError(`frontmatter ${key}: '${v}' not an integer`);
  }
}

function requireInt(map: Map<string, string>, key: string): number {
  const v = map.get(key);
  if (v == null) throw new InvalidPhase1MarkdownError(`frontmatter missing: ${key}`);
  const n = Number(v);
  if (!Number.isInteger(n)) {
    throw new InvalidPhase1MarkdownError(`frontmatter ${key}: '${v}' not an integer`);
  }
  return n;
}

function requireFloat(map: Map<string, string>, key: string): number {
  const v = map.get(key);
  if (v == null) throw new InvalidPhase1MarkdownError(`frontmatter missing: ${key}`);
  const n = Number(v);
  if (Number.isNaN(n)) {
    throw new InvalidPhase1MarkdownError(`frontmatter ${key}: '${v}' not a number`);
  }
  return n;
}

function requireBigintField(fields: Map<string, string>, key: string, txIndex: number): bigint {
  const v = fields.get(key);
  if (v == null) {
    throw new InvalidPhase1MarkdownError(`transaction ${txIndex}: missing ${key}`);
  }
  try {
    return BigInt(v);
  } catch {
    throw new InvalidPhase1MarkdownError(`transaction ${txIndex}: ${key}='${v}' not integer`);
  }
}
