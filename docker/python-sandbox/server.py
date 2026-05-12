"""Python sandbox HTTP service.

Executes pdfplumber scripts in isolation from the Node worker process:
- Non-root UID 1500, read-only rootfs, tmpfs /work, dropped capabilities.
- env={} passed to every subprocess so no secrets leak into executed code.
- No outbound network (compose `internal: true` on sandbox-net).
"""
import base64
import binascii
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

from flask import Flask, jsonify, request

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 15 * 1024 * 1024  # 15 MB

PYTHON_BIN = sys.executable
WORK_ROOT = "/work"
HEADER_SCRIPT = "/app/extract-text.py"
MAX_PDF_BYTES = 12 * 1024 * 1024
DEFAULT_TIMEOUT_S = 30


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


@app.get("/healthz")
def healthz():
    return jsonify({"ok": True})


@app.post("/extract")
def extract():
    """Run an LLM-generated pdfplumber script against a PDF."""
    body = request.get_json(silent=True) or {}
    script_code = body.get("scriptCode")
    pdf_b64 = body.get("pdfBase64")
    if not isinstance(script_code, str) or not script_code.strip():
        return jsonify({"error": "scriptCode must be a non-empty string"}), 400
    if len(script_code) > 200_000:
        return jsonify({"error": "scriptCode too large"}), 400

    try:
        pdf_bytes = _decode_pdf(pdf_b64)
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400

    workdir = tempfile.mkdtemp(prefix="extract-", dir=WORK_ROOT)
    try:
        script_path = Path(workdir) / "extract.py"
        pdf_path = Path(workdir) / "input.pdf"
        script_path.write_text(script_code, encoding="utf-8")
        pdf_path.write_bytes(pdf_bytes)

        try:
            result = _run(
                [PYTHON_BIN, str(script_path), str(pdf_path)],
                cwd=workdir,
                timeout=DEFAULT_TIMEOUT_S,
            )
        except subprocess.TimeoutExpired:
            return jsonify({"error": "timeout", "timeoutSeconds": DEFAULT_TIMEOUT_S}), 504

        return jsonify(result)
    finally:
        for p in Path(workdir).glob("*"):
            try:
                p.unlink()
            except OSError:
                pass
        try:
            os.rmdir(workdir)
        except OSError:
            pass


@app.post("/extract-header")
def extract_header():
    """Run the baked-in extract-text.py — no LLM code accepted."""
    body = request.get_json(silent=True) or {}
    pdf_b64 = body.get("pdfBase64")
    try:
        pdf_bytes = _decode_pdf(pdf_b64)
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400

    workdir = tempfile.mkdtemp(prefix="header-", dir=WORK_ROOT)
    try:
        pdf_path = Path(workdir) / "input.pdf"
        pdf_path.write_bytes(pdf_bytes)
        try:
            result = _run(
                [PYTHON_BIN, HEADER_SCRIPT, str(pdf_path)],
                cwd=workdir,
                timeout=15,
            )
        except subprocess.TimeoutExpired:
            return jsonify({"error": "timeout", "timeoutSeconds": 15}), 504
        return jsonify(result)
    finally:
        try:
            (Path(workdir) / "input.pdf").unlink()
        except OSError:
            pass
        try:
            os.rmdir(workdir)
        except OSError:
            pass


@app.errorhandler(413)
def too_large(_err):
    return jsonify({"error": "request body exceeds 15 MB"}), 413


if __name__ == "__main__":
    Path(WORK_ROOT).mkdir(parents=True, exist_ok=True)
    app.run(host="0.0.0.0", port=8080)
