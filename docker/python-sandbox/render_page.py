"""Rasterize one PDF page to JPEG for GPT-4o vision.

Usage: python render_page.py <path_to_pdf> <page_number> [password]

- page_number is 1-based.
- On success: emits { "page", "jpeg_base64", "width", "height" } and exits 0.
- Encryption signals match extract-pages.py: exit 2 / 3. The password is never
  written to stdout or stderr.
"""
from __future__ import annotations

import base64
import io
import json
import sys

import pdfplumber
import pypdfium2 as pdfium
from pdfminer.pdfdocument import PDFEncryptionError
LONG_EDGE_PX = 2048
JPEG_QUALITY = 75


def _emit_encrypted(password):
    if password is None:
        json.dump({"encrypted": True}, sys.stdout)
        sys.exit(2)
    json.dump({"encrypted": True, "wrong_password": True}, sys.stdout)
    sys.exit(3)


def main():
    if len(sys.argv) not in (3, 4):
        print(
            "Usage: python render_page.py <pdf_path> <page_number> [password]",
            file=sys.stderr,
        )
        sys.exit(1)

    pdf_path = sys.argv[1]
    try:
        page_number = int(sys.argv[2])
    except ValueError:
        print("page_number must be an integer", file=sys.stderr)
        sys.exit(1)
    if page_number < 1:
        print("page_number must be >= 1", file=sys.stderr)
        sys.exit(1)
    password = sys.argv[3] if len(sys.argv) == 4 else None
    open_kwargs = {} if password is None else {"password": password}

    try:
        with pdfplumber.open(pdf_path, **open_kwargs) as pdf:
            n_pages = len(pdf.pages)
    except PDFEncryptionError:
        _emit_encrypted(password)

    if page_number > n_pages:
        print(f"page {page_number} out of range (pdf has {n_pages})", file=sys.stderr)
        sys.exit(1)

    pdfium_kwargs = {} if password is None else {"password": password}
    src = pdfium.PdfDocument(pdf_path, **pdfium_kwargs)
    try:
        page = src[page_number - 1]
        width_pt, height_pt = page.get_size()
        long_edge = max(float(width_pt), float(height_pt), 1.0)
        scale = LONG_EDGE_PX / long_edge
        bitmap = page.render(scale=scale)
        pil = bitmap.to_pil().convert("RGB")
        buf = io.BytesIO()
        pil.save(buf, format="JPEG", quality=JPEG_QUALITY, optimize=True)
        jpeg = buf.getvalue()
        width, height = pil.size
        if not jpeg.startswith(b"\xff\xd8"):
            print("renderer did not produce a JPEG", file=sys.stderr)
            sys.exit(1)
        json.dump(
            {
                "page": page_number,
                "jpeg_base64": base64.b64encode(jpeg).decode("ascii"),
                "width": width,
                "height": height,
            },
            sys.stdout,
        )
    finally:
        src.close()


if __name__ == "__main__":
    main()
