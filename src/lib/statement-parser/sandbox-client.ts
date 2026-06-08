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

/**
 * The PDF is encrypted and no password was supplied. The caller (D02 Inngest
 * function) catches this to transition the statement to `password_required`.
 * Never carries the attempted password.
 */
export class EncryptedPdfError extends Error {
  constructor() {
    super("PDF is encrypted and requires a password");
    this.name = "EncryptedPdfError";
  }
}

/**
 * A password was supplied but it did not unlock the PDF. The caller transitions
 * the statement back to `password_required` with a user-facing retry message.
 * Never carries the attempted password.
 */
export class WrongPdfPasswordError extends Error {
  constructor() {
    super("The supplied PDF password is incorrect");
    this.name = "WrongPdfPasswordError";
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
  requiresPassword?: boolean;
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
      // 422 encrypted-PDF signal. Map to typed errors so the Inngest function
      // can branch without parsing strings. The stable discriminator is the
      // `error` value ("encrypted" / "wrong_password"); `requiresPassword` is a
      // redundant flag kept as an additional accepted signal so a version-skewed
      // sandbox (one that omits it) still routes correctly instead of falling
      // through to a generic failure. Never log or attach the password here — it
      // is not present in the response body.
      if (
        res.status === 422 &&
        (err.error === "wrong_password" ||
          err.error === "encrypted" ||
          err.requiresPassword)
      ) {
        if (err.error === "wrong_password") throw new WrongPdfPasswordError();
        throw new EncryptedPdfError();
      }
      throw new SandboxError(
        `sandbox ${path} returned ${res.status}: ${err.error ?? "unknown"}`,
        null,
        "",
      );
    }
    return payload as SandboxResponse;
  } catch (err: unknown) {
    if (
      err instanceof SandboxError ||
      err instanceof EncryptedPdfError ||
      err instanceof WrongPdfPasswordError
    ) {
      throw err;
    }
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
 *
 * @param password Optional password for encrypted PDFs. Passed in the request
 *   body and forwarded to pdfplumber inside the sandbox. It is never persisted
 *   nor included in any thrown error. If the PDF is encrypted and this is
 *   omitted, `EncryptedPdfError` is thrown; if it is wrong, `WrongPdfPasswordError`.
 */
export async function extractPdfPages(
  pdfBuffer: Buffer,
  password?: string,
): Promise<string> {
  const body: Record<string, string> = {
    pdfBase64: pdfBuffer.toString("base64"),
  };
  if (password) body.password = password;

  const { stdout, stderr, exitCode } = await callSandbox(
    "/extract-pages",
    body,
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
