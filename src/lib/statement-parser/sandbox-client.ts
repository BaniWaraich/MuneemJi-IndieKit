const SANDBOX_URL = process.env.PYTHON_SANDBOX_URL ?? "http://localhost:8080";
const PARSER_SECRET = process.env.PARSER_SECRET ?? "";
const PAGES_TIMEOUT_MS = 60_000;

export class SandboxError extends Error {
  constructor(
    message: string,
    public readonly exitCode: number | null,
    public readonly stderr: string,
  ) {
    super(message);
    this.name = "SandboxError";
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
  path: "/extract-pages",
  body: Record<string, string>,
  timeoutMs: number,
): Promise<SandboxResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${SANDBOX_URL}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${PARSER_SECRET}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const payload = (await res.json().catch(() => ({}))) as
      | SandboxResponse
      | SandboxErrorResponse;
    if (!res.ok) {
      const err = payload as SandboxErrorResponse;
      throw new SandboxError(
        `sandbox ${path} returned ${res.status}: ${err.error ?? "unknown"}`,
        null,
        "",
      );
    }
    return payload as SandboxResponse;
  } catch (err: unknown) {
    if (err instanceof SandboxError) throw err;
    if ((err as Error).name === "AbortError") {
      throw new SandboxError(
        `sandbox ${path} timed out after ${timeoutMs}ms`,
        null,
        "",
      );
    }
    throw new SandboxError(
      `sandbox ${path} fetch failed: ${(err as Error).message}`,
      null,
      "",
    );
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Extract every page of a PDF using the baked-in extract-pages.py. Returns
 * the raw JSON string the script emitted: { pages: [{page, method, ...}] }.
 * No LLM-generated code is accepted by this endpoint.
 */
export async function extractPdfPages(pdfBuffer: Buffer): Promise<string> {
  const { stdout, stderr, exitCode } = await callSandbox(
    "/extract-pages",
    { pdfBase64: pdfBuffer.toString("base64") },
    PAGES_TIMEOUT_MS,
  );
  if (exitCode !== 0) {
    throw new SandboxError(
      `extract-pages.py exited ${exitCode}: ${stderr.slice(-1000)}`,
      exitCode,
      stderr,
    );
  }
  return stdout.trim();
}
