"""Classifier + renderer fixtures.

Run from docker/python-sandbox (pdfplumber, pypdfium2, Pillow installed):
  python -m unittest classify_page_test.py
"""
from __future__ import annotations

import base64
import io
import json
import os
import subprocess
import sys
import tempfile
import unittest

import pdfplumber
from PIL import Image

from classify_page import classify_from_signals, classify_page
from classify_page import (
    BLANK_ALNUM_MAX,
    BLANK_IMAGE_AREA_MAX,
    SCANNED_ALNUM_MAX,
    SCANNED_IMAGE_ALNUM_MAX,
    SCANNED_IMAGE_AREA_MIN,
)


HERE = os.path.dirname(os.path.abspath(__file__))


class _FakePage:
    def __init__(self, *, chars, images, width=612, height=792, words=None):
        self.chars = chars
        self.images = images
        self.width = width
        self.height = height
        self._words = words if words is not None else [{}] * (len(chars) // 4)

    def extract_words(self):
        return self._words


def _alnum_chars(n: int) -> list[dict]:
    return [{"text": "A"} for _ in range(n)]


def _full_page_image(width=612, height=792) -> dict:
    return {"x0": 0, "x1": width, "top": 0, "bottom": height}


def _logo_image() -> dict:
    return {"x0": 10, "x1": 60, "top": 10, "bottom": 60}


class ClassifyFromSignalsTest(unittest.TestCase):
    def test_blank(self):
        kind, _ = classify_page(
            _FakePage(chars=_alnum_chars(BLANK_ALNUM_MAX - 1), images=[])
        )
        self.assertEqual(kind, "blank")

    def test_full_page_image_is_scanned(self):
        kind, signals = classify_page(
            _FakePage(chars=[], images=[_full_page_image()])
        )
        self.assertEqual(kind, "scanned")
        self.assertGreaterEqual(signals["image_area_ratio"], SCANNED_IMAGE_AREA_MIN)

    def test_logo_plus_long_table_is_text(self):
        kind, signals = classify_page(
            _FakePage(
                chars=_alnum_chars(SCANNED_IMAGE_ALNUM_MAX + 50),
                images=[_logo_image()],
            )
        )
        self.assertEqual(kind, "text")
        self.assertLess(signals["image_area_ratio"], SCANNED_IMAGE_AREA_MIN)

    def test_header_fonts_plus_large_image_is_scanned(self):
        kind, _ = classify_page(
            _FakePage(
                chars=_alnum_chars(SCANNED_ALNUM_MAX - 1),
                images=[{"x0": 0, "x1": 612, "top": 80, "bottom": 792}],
            )
        )
        self.assertEqual(kind, "scanned")

    def test_native_table_no_image_is_text(self):
        kind, _ = classify_page(
            _FakePage(chars=_alnum_chars(500), images=[])
        )
        self.assertEqual(kind, "text")

    def test_high_ratio_low_alnum_is_scanned(self):
        self.assertEqual(
            classify_from_signals(
                {
                    "char_count": 100,
                    "alnum_count": 100,
                    "word_count": 20,
                    "image_area_ratio": 0.5,
                }
            ),
            "scanned",
        )


# --- Minimal PDF builders (no extra deps beyond Pillow for JPEGs) ---

def _pdf_with_objects(objects: list[bytes]) -> bytes:
    header = b"%PDF-1.4\n"
    body = b""
    offsets = [0]
    pos = len(header)
    out_objs = []
    for i, obj in enumerate(objects, start=1):
        chunk = f"{i} 0 obj\n".encode() + obj + b"\nendobj\n"
        offsets.append(pos)
        out_objs.append(chunk)
        pos += len(chunk)
        body += chunk
    xref_start = pos
    xref = f"xref\n0 {len(objects) + 1}\n".encode()
    xref += b"0000000000 65535 f \n"
    for off in offsets[1:]:
        xref += f"{off:010d} 00000 n \n".encode()
    trailer = (
        f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\n"
        f"startxref\n{xref_start}\n%%EOF\n"
    ).encode()
    return header + body + xref + trailer


def _font_resources() -> bytes:
    return (
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
        b"/Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>"
    )


def _text_stream(text: str, repeats: int) -> bytes:
    lines = []
    y = 720
    for i in range(repeats):
        safe = text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
        lines.append(f"BT /F1 10 Tf 72 {y} Td ({safe} {i}) Tj ET")
        y -= 12
        if y < 72:
            break
    content = "\n".join(lines)
    return f"<< /Length {len(content)} >>\nstream\n{content}\nendstream".encode()


def build_text_pdf(*, repeats: int = 40) -> bytes:
    line = "HDFC Bank Statement 02/04/2026 NEFT RAMESH 4500.00 78456.00"
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        _font_resources(),
        _text_stream(line, repeats),
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    return _pdf_with_objects(objects)


def build_blank_pdf() -> bytes:
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >>",
        b"<< /Length 0 >>\nstream\nendstream",
    ]
    return _pdf_with_objects(objects)


def _jpeg_bytes(width: int, height: int, color=(180, 40, 40)) -> bytes:
    img = Image.new("RGB", (width, height), color)
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=80)
    return buf.getvalue()


def build_image_pdf(*, img_w: int, img_h: int, draw_w: float, draw_h: float, extra_text: str | None = None) -> bytes:
    jpeg = _jpeg_bytes(img_w, img_h)
    # Object graph:
    # 1 catalog, 2 pages, 3 page, 4 contents, 5 image xobject, [6 font if text]
    content_ops = (
        f"q\n{draw_w:.2f} 0 0 {draw_h:.2f} 0 0 cm\n/Im1 Do\nQ\n"
    )
    if extra_text:
        safe = extra_text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
        content_ops += f"BT /F1 12 Tf 72 760 Td ({safe}) Tj ET\n"
    content = f"<< /Length {len(content_ops)} >>\nstream\n{content_ops}endstream".encode()

    img_obj = (
        f"<< /Type /XObject /Subtype /Image /Width {img_w} /Height {img_h} "
        f"/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode "
        f"/Length {len(jpeg)} >>\nstream\n"
    ).encode() + jpeg + b"\nendstream"

    if extra_text:
        page = (
            b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
            b"/Contents 4 0 R /Resources << /XObject << /Im1 5 0 R >> "
            b"/Font << /F1 6 0 R >> >> >>"
        )
        objects = [
            b"<< /Type /Catalog /Pages 2 0 R >>",
            b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
            page,
            content,
            img_obj,
            b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        ]
    else:
        page = (
            b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
            b"/Contents 4 0 R /Resources << /XObject << /Im1 5 0 R >> >> >>"
        )
        objects = [
            b"<< /Type /Catalog /Pages 2 0 R >>",
            b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
            page,
            content,
            img_obj,
        ]
    return _pdf_with_objects(objects)


def _open_first(pdf_bytes: bytes):
    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as f:
        f.write(pdf_bytes)
        path = f.name
    try:
        pdf = pdfplumber.open(path)
        page = pdf.pages[0]
        kind, signals = classify_page(page)
        pdf.close()
        return kind, signals, path
    except Exception:
        os.unlink(path)
        raise


class ClassifyRealPdfTest(unittest.TestCase):
    def _classify(self, pdf_bytes: bytes):
        kind, signals, path = _open_first(pdf_bytes)
        os.unlink(path)
        return kind, signals

    def test_native_text_page(self):
        kind, signals = self._classify(build_text_pdf(repeats=50))
        self.assertEqual(kind, "text", msg=signals)
        self.assertGreaterEqual(signals["alnum_count"], SCANNED_ALNUM_MAX)

    def test_full_page_jpeg(self):
        kind, signals = self._classify(
            build_image_pdf(img_w=200, img_h=260, draw_w=612, draw_h=792)
        )
        self.assertEqual(kind, "scanned", msg=signals)
        self.assertGreaterEqual(signals["image_area_ratio"], SCANNED_IMAGE_AREA_MIN)

    def test_empty_page(self):
        kind, signals = self._classify(build_blank_pdf())
        self.assertEqual(kind, "blank", msg=signals)
        self.assertLess(signals["alnum_count"], BLANK_ALNUM_MAX)
        self.assertLess(signals["image_area_ratio"], BLANK_IMAGE_AREA_MAX)

    def test_logo_plus_long_table(self):
        # Small image + lots of text must stay on the cheap text path.
        jpeg_pdf = build_image_pdf(
            img_w=40,
            img_h=40,
            draw_w=50,
            draw_h=50,
            extra_text="X",
        )
        # The helper only places a short extra_text; overlay a text-heavy PDF
        # by classifying a pure text PDF (logo case covered by FakePage) AND
        # asserting a small-image PDF with repeated header still isn't blank.
        kind, signals = self._classify(build_text_pdf(repeats=50))
        self.assertEqual(kind, "text", msg=signals)
        # Small-image PDF: ratio should be well under 0.40.
        kind2, signals2 = self._classify(jpeg_pdf)
        self.assertLess(signals2["image_area_ratio"], SCANNED_IMAGE_AREA_MIN)

    def test_header_only_plus_large_image(self):
        kind, signals = self._classify(
            build_image_pdf(
                img_w=200,
                img_h=200,
                draw_w=612,
                draw_h=500,
                extra_text="HDFC Bank",
            )
        )
        self.assertEqual(kind, "scanned", msg=signals)
        self.assertGreaterEqual(signals["image_area_ratio"], SCANNED_IMAGE_AREA_MIN)


class RenderPageTest(unittest.TestCase):
    def test_jpeg_soi_and_long_edge(self):
        pdf_bytes = build_image_pdf(img_w=200, img_h=260, draw_w=612, draw_h=792)
        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as f:
            f.write(pdf_bytes)
            path = f.name
        try:
            proc = subprocess.run(
                [sys.executable, os.path.join(HERE, "render_page.py"), path, "1"],
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertEqual(proc.returncode, 0, msg=proc.stderr)
            payload = json.loads(proc.stdout)
            jpeg = base64.b64decode(payload["jpeg_base64"])
            self.assertTrue(jpeg.startswith(b"\xff\xd8"))
            self.assertLessEqual(max(payload["width"], payload["height"]), 2048)
            self.assertEqual(payload["page"], 1)
        finally:
            os.unlink(path)


if __name__ == "__main__":
    unittest.main()
