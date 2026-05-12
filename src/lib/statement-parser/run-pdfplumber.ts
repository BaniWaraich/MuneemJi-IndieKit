import { runInSandbox, SandboxError } from './sandbox-client';
import type { ExtractionResult } from './types';

export { SandboxError as PdfplumberError };

/**
 * Run a pdfplumber Python script against a PDF buffer inside the sandbox
 * container. The script never touches the worker's filesystem or environment.
 */
export async function runPdfplumberScript(
  scriptCode: string,
  pdfBuffer: Buffer,
): Promise<ExtractionResult> {
  return runInSandbox(scriptCode, pdfBuffer);
}
