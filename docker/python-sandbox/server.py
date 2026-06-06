"""Python sandbox HTTP service.

Executes the baked-in extract-pages.py against an uploaded bank-statement PDF,
isolated from the Node worker process:
- Non-root UID 1500, read-only rootfs, tmpfs /work, dropped capabilities.
- env={} passed to the subprocess so no secrets leak into executed code.
- No LLM-generated code is ever accepted — only the baked-in script runs.

Hosted on Google Cloud Run (publicly reachable), so every request must carry
`Authorization: Bearer <PARSER_SECRET>`. /healthz is the only exempt route.
"""
import base64
import binascii
import json
import os
import subprocess
import sys
import tempfile
import time
import uuid
from pathlib import Path

from flask import Flask, jsonify, request

app = Flask(__name__)
# HTTP-layer reject: bodies (base64 PDF) larger than 10 MB never reach a handler.
app.config["MAX_CONTENT_LENGTH"] = 10 * 1024 * 1024

PYTHON_BIN = sys.executable
WORK_ROOT = "/work"
PAGES_SCRIPT = "/app/extract-pages.py"
MAX_PDF_BYTES = 10 * 1024 * 1024
PAGES_TIMEOUT_S = 30

# Required shared secret. Read once at startup; a missing value is fatal so the
# service can never come up unauthenticated.
PARSER_SECRET = os.environ.get("PARSER_SECRET")
if not PARSER_SECRET:
    sys.exit("PARSER_SECRET is not set — refusing to start unauthenticated")


def _log(job_id: str, status: str, duration_ms: int, **extra) -> None:
    """Structured one-line log. Never includes PDF bytes or extracted text."""
    print(
        json.dumps(
            {"jobId": job_id, "status": status, "durationMs": duration_ms, **extra}
        ),
        flush=True,
    )


def _decode_pdf(pdf_b64: str) -> bytes:
    if not isinstance(pdf_b64, str) or not pdf_b64:
        raise ValueError("pdfBase64 must be a non-empty string")
    try:
        raw = base64.b64decode(pdf_b64, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise ValueError(f"pdfBase64 is not valid base64: {exc}") from exc
    if len(raw) > MAX_PDF_BYTES:
        raise ValueError(f"pdf exceeds {MAX_PDF_BYTES} bytes")
    if not raw.startswith(b"%PDF-"):
        raise ValueError("pdf does not start with %PDF- magic bytes")
    return raw


def _run(cmd: list[str], cwd: str, timeout: int) -> dict:
    completed = subprocess.run(
        cmd,
        cwd=cwd,
        env={},
        capture_output=True,
        timeout=timeout,
        check=False,
    )
    return {
        "stdout": completed.stdout.decode("utf-8", errors="replace"),
        "stderr": completed.stderr.decode("utf-8", errors="replace"),
        "exitCode": completed.returncode,
    }


@app.before_request
def _require_bearer():
    """Gate every route except the health check behind the shared secret."""
    if request.path == "/healthz":
        return None
    header = request.headers.get("Authorization", "")
    expected = f"Bearer {PARSER_SECRET}"
    if header != expected:
        return jsonify({"error": "unauthorized"}), 401
    return None


@app.get("/healthz")
def healthz():
    return jsonify({"ok": True})


@app.post("/extract-pages")
def extract_pages():
    """Run the baked-in extract-pages.py — no LLM code accepted.

    Optional request field "password" unlocks an encrypted PDF. The password
    is passed straight to the subprocess as argv[2] and is NEVER written to a
    log line (see _log, which only ever receives jobId/status/timing/exitCode).
    """
    started = time.monotonic()
    body = request.get_json(silent=True) or {}
    job_id = str(body.get("jobId") or uuid.uuid4().hex[:12])
    pdf_b64 = body.get("pdfBase64")
    # Optional. Coerce to str so a non-string never reaches the CLI; empty /
    # missing means "no password supplied" (extract-pages.py exit 2 path).
    raw_password = body.get("password")
    password = raw_password if isinstance(raw_password, str) and raw_password else None
    try:
        pdf_bytes = _decode_pdf(pdf_b64)
    except ValueError as exc:
        _log(job_id, "rejected", int((time.monotonic() - started) * 1000))
        return jsonify({"error": str(exc)}), 400

    workdir = tempfile.mkdtemp(prefix="pages-", dir=WORK_ROOT)
    pdf_path = Path(workdir) / "input.pdf"
    try:
        pdf_path.write_bytes(pdf_bytes)
        cmd = [PYTHON_BIN, PAGES_SCRIPT, str(pdf_path)]
        if password is not None:
            cmd.append(password)
        try:
            result = _run(
                cmd,
                cwd=workdir,
                timeout=PAGES_TIMEOUT_S,
            )
        except subprocess.TimeoutExpired:
            _log(job_id, "timeout", int((time.monotonic() - started) * 1000))
            return jsonify({"error": "timeout", "timeoutSeconds": PAGES_TIMEOUT_S}), 504

        exit_code = result["exitCode"]

        # Encryption signals from extract-pages.py. The password never appears
        # in this log line or the response body.
        if exit_code == 2:
            _log(job_id, "encrypted", int((time.monotonic() - started) * 1000))
            return jsonify({"error": "encrypted", "requiresPassword": True}), 422
        if exit_code == 3:
            _log(job_id, "wrong_password", int((time.monotonic() - started) * 1000))
            return (
                jsonify({"error": "wrong_password", "requiresPassword": True}),
                422,
            )

        _log(
            job_id,
            "ok" if exit_code == 0 else "error",
            int((time.monotonic() - started) * 1000),
            exitCode=exit_code,
        )
        return jsonify(result)
    finally:
        # Stateless: the PDF never outlives the parse.
        try:
            pdf_path.unlink()
        except OSError:
            pass
        try:
            os.rmdir(workdir)
        except OSError:
            pass


@app.errorhandler(413)
def too_large(_err):
    return jsonify({"error": "request body exceeds 10 MB"}), 413


if __name__ == "__main__":
    Path(WORK_ROOT).mkdir(parents=True, exist_ok=True)
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 8080)))
