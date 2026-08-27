"""Python sandbox HTTP service.

Executes baked-in scripts against an uploaded bank-statement PDF, isolated
from the Node worker process:
- Non-root UID 1500, read-only rootfs, tmpfs /work, dropped capabilities.
- env={} passed to the subprocess so no secrets leak into executed code.
- No LLM-generated code is ever accepted — only the baked-in scripts run.

Hosted on Google Cloud Run (publicly reachable), so every request must carry
`Authorization: Bearer <PARSER_SECRET>`. /healthz is the only exempt route.

Endpoints:
- POST /extract-pages — text + scanned/text/blank classification per page
- POST /render-page — JPEG raster of a single page for GPT-4o vision
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

# 25 MB decoded PDF (D01 cap) * 4/3 base64 + JSON wrapper ≈ 36 MB.
MAX_PDF_BYTES = 25 * 1024 * 1024
MAX_BODY_BYTES = 36 * 1024 * 1024

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = MAX_BODY_BYTES

PYTHON_BIN = sys.executable
WORK_ROOT = "/work"
PAGES_SCRIPT = "/app/extract-pages.py"
RENDER_SCRIPT = "/app/render_page.py"
PAGES_TIMEOUT_S = 45
RENDER_TIMEOUT_S = 20

PARSER_SECRET = os.environ.get("PARSER_SECRET")
if not PARSER_SECRET:
    sys.exit("PARSER_SECRET is not set — refusing to start unauthenticated")


def _log(job_id: str, status: str, duration_ms: int, **extra) -> None:
    """Structured one-line log. Never includes PDF bytes, JPEG, or passwords."""
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


def _password_from_body(body: dict) -> str | None:
    raw_password = body.get("password")
    if isinstance(raw_password, str) and raw_password:
        return raw_password
    return None


def _run_pdf_script(
    *,
    script: str,
    extra_args: list[str],
    timeout_s: int,
    job_id: str,
    pdf_b64: str,
    password: str | None,
    log_ok: str,
):
    started = time.monotonic()
    try:
        pdf_bytes = _decode_pdf(pdf_b64)
    except ValueError as exc:
        _log(job_id, "rejected", int((time.monotonic() - started) * 1000))
        return jsonify({"error": str(exc)}), 400

    workdir = tempfile.mkdtemp(prefix="pages-", dir=WORK_ROOT)
    pdf_path = Path(workdir) / "input.pdf"
    try:
        pdf_path.write_bytes(pdf_bytes)
        cmd = [PYTHON_BIN, script, str(pdf_path), *extra_args]
        if password is not None:
            cmd.append(password)
        try:
            result = _run(cmd, cwd=workdir, timeout=timeout_s)
        except subprocess.TimeoutExpired:
            _log(job_id, "timeout", int((time.monotonic() - started) * 1000))
            return jsonify({"error": "timeout", "timeoutSeconds": timeout_s}), 504

        exit_code = result["exitCode"]
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
            log_ok if exit_code == 0 else "error",
            int((time.monotonic() - started) * 1000),
            exitCode=exit_code,
        )
        return jsonify(result)
    finally:
        try:
            pdf_path.unlink()
        except OSError:
            pass
        try:
            os.rmdir(workdir)
        except OSError:
            pass


@app.before_request
def _require_bearer():
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
    """Run extract-pages.py — text + kind/signals. No images in the payload."""
    body = request.get_json(silent=True) or {}
    job_id = str(body.get("jobId") or uuid.uuid4().hex[:12])
    return _run_pdf_script(
        script=PAGES_SCRIPT,
        extra_args=[],
        timeout_s=PAGES_TIMEOUT_S,
        job_id=job_id,
        pdf_b64=body.get("pdfBase64"),
        password=_password_from_body(body),
        log_ok="ok",
    )


@app.post("/render-page")
def render_page():
    """Rasterize one page to JPEG. Request field `page` is 1-based."""
    body = request.get_json(silent=True) or {}
    job_id = str(body.get("jobId") or uuid.uuid4().hex[:12])
    raw_page = body.get("page")
    try:
        page_number = int(raw_page)
    except (TypeError, ValueError):
        return jsonify({"error": "page must be a positive integer"}), 400
    if page_number < 1:
        return jsonify({"error": "page must be a positive integer"}), 400
    return _run_pdf_script(
        script=RENDER_SCRIPT,
        extra_args=[str(page_number)],
        timeout_s=RENDER_TIMEOUT_S,
        job_id=job_id,
        pdf_b64=body.get("pdfBase64"),
        password=_password_from_body(body),
        log_ok="render_ok",
    )


@app.errorhandler(413)
def too_large(_err):
    return jsonify({"error": "request body exceeds 36 MB"}), 413


if __name__ == "__main__":
    Path(WORK_ROOT).mkdir(parents=True, exist_ok=True)
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 8080)))
