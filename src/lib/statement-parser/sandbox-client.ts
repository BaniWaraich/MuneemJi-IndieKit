import { extractionResultSchema, type ExtractionResult } from './types';

const SANDBOX_URL = process.env.PYTHON_SANDBOX_URL ?? 'http://localhost:8085';
const EXTRACT_TIMEOUT_MS = 35_000;
const HEADER_TIMEOUT_MS = 20_000;

export class SandboxError extends Error {
  constructor(
    message: string,
    public readonly exitCode: number | null,
    public readonly stderr: string,
  ) {
    super(message);
    this.name = 'SandboxError';
  }
}

type SandboxResponse = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

type SandboxErrorResponse = {
  error: string;
  timeoutSeconds?: number;
};

async function callSandbox(
  path: '/extract' | '/extract-header',
  body: Record<string, string>,
  timeoutMs: number,
): Promise<SandboxResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${SANDBOX_URL}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const payload = (await res.json().catch(() => ({}))) as
      | SandboxResponse
      | SandboxErrorResponse;
    if (!res.ok) {
      const err = payload as SandboxErrorResponse;
      throw new SandboxError(
        `sandbox ${path} returned ${res.status}: ${err.error ?? 'unknown'}`,
        null,
        '',
      );
    }
    return payload as SandboxResponse;
  } catch (err: unknown) {
    if (err instanceof SandboxError) throw err;
    if ((err as Error).name === 'AbortError') {
      throw new SandboxError(`sandbox ${path} timed out after ${timeoutMs}ms`, null, '');
    }
    throw new SandboxError(`sandbox ${path} fetch failed: ${(err as Error).message}`, null, '');
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Run an LLM-generated pdfplumber script inside the sandbox container.
 * Validates stdout as extractionResultSchema. The worker (not this client)
 * is responsible for balance validation and normalisation.
 */
export async function runInSandbox(
  scriptCode: string,
  pdfBuffer: Buffer,
): Promise<ExtractionResult> {
  const { stdout, stderr, exitCode } = await callSandbox(
    '/extract',
    { scriptCode, pdfBase64: pdfBuffer.toString('base64') },
    EXTRACT_TIMEOUT_MS,
  );
  if (exitCode !== 0) {
    throw new SandboxError(`pdfplumber script exited ${exitCode}`, exitCode, stderr);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout.trim());
  } catch {
    throw new SandboxError(
      `pdfplumber stdout is not valid JSON: ${stdout.slice(0, 200)}`,
      exitCode,
      stderr,
    );
  }
  const result = extractionResultSchema.safeParse(parsed);
  if (!result.success) {
    throw new SandboxError(
      `pdfplumber output schema mismatch: ${result.error.message}`,
      exitCode,
      stderr,
    );
  }
  return result.data;
}

/**
 * Extract raw text from the first two pages of a PDF using the baked-in
 * extract-text.py. No LLM-generated code is accepted by this endpoint.
 */
export async function extractHeaderText(pdfBuffer: Buffer): Promise<string> {
  const { stdout, stderr, exitCode } = await callSandbox(
    '/extract-header',
    { pdfBase64: pdfBuffer.toString('base64') },
    HEADER_TIMEOUT_MS,
  );
  if (exitCode !== 0) {
    throw new SandboxError(`extract-text.py exited ${exitCode}`, exitCode, stderr);
  }
  return stdout.trim();
}
