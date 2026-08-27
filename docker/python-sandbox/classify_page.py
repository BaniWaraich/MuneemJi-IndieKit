"""Classify a pdfplumber page as text, scanned, or blank.

Heuristic (D02 scanned-PDF path):
- blank: almost no alphanumeric text operators AND almost no image coverage
- scanned: full-page (or large) image with little text, OR almost no text at all
- text: everything else (native digital statements, searchable OCR scans)

Uses page.chars (text operators), not extract_text(), so a scan with a
decorative header still counts as scanned when the body is an image.
"""
from __future__ import annotations

from typing import Any, Literal, TypedDict

PageKind = Literal["text", "scanned", "blank"]

BLANK_ALNUM_MAX = 20
BLANK_IMAGE_AREA_MAX = 0.08
SCANNED_IMAGE_AREA_MIN = 0.40
SCANNED_IMAGE_ALNUM_MAX = 400
SCANNED_ALNUM_MAX = 80


class PageSignals(TypedDict):
    char_count: int
    alnum_count: int
    word_count: int
    image_area_ratio: float


def _rect(img: dict[str, Any]) -> tuple[float, float, float, float] | None:
    try:
        x0 = float(img["x0"])
        x1 = float(img["x1"])
        top = float(img["top"])
        bottom = float(img["bottom"])
    except (KeyError, TypeError, ValueError):
        return None
    return (min(x0, x1), min(top, bottom), max(x0, x1), max(top, bottom))


def _union_area(rects: list[tuple[float, float, float, float]]) -> float:
    if not rects:
        return 0.0
    xs = sorted({r[0] for r in rects} | {r[2] for r in rects})
    area = 0.0
    for i in range(len(xs) - 1):
        x0, x1 = xs[i], xs[i + 1]
        if x1 <= x0:
            continue
        ys: list[tuple[float, float]] = []
        for a, b, c, d in rects:
            if a < x1 and c > x0:
                ys.append((b, d))
        if not ys:
            continue
        ys.sort()
        covered = 0.0
        cur_s, cur_e = ys[0]
        for s, e in ys[1:]:
            if s <= cur_e:
                cur_e = max(cur_e, e)
            else:
                covered += cur_e - cur_s
                cur_s, cur_e = s, e
        covered += cur_e - cur_s
        area += (x1 - x0) * covered
    return area


def page_signals(page: Any) -> PageSignals:
    chars = list(getattr(page, "chars", []) or [])
    char_count = len(chars)
    alnum_count = sum(1 for c in chars if str(c.get("text") or "").isalnum())
    try:
        word_count = len(page.extract_words() or [])
    except Exception:
        word_count = 0

    width = float(getattr(page, "width", 0) or 0)
    height = float(getattr(page, "height", 0) or 0)
    page_area = width * height
    images = list(getattr(page, "images", []) or [])
    rects = [r for r in (_rect(img) for img in images) if r is not None]
    image_area = _union_area(rects)
    ratio = 0.0 if page_area <= 0 else min(1.0, image_area / page_area)

    return {
        "char_count": char_count,
        "alnum_count": alnum_count,
        "word_count": word_count,
        "image_area_ratio": round(ratio, 3),
    }


def classify_from_signals(signals: PageSignals) -> PageKind:
    alnum = signals["alnum_count"]
    ratio = signals["image_area_ratio"]
    if alnum < BLANK_ALNUM_MAX and ratio < BLANK_IMAGE_AREA_MAX:
        return "blank"
    if (ratio >= SCANNED_IMAGE_AREA_MIN and alnum < SCANNED_IMAGE_ALNUM_MAX) or (
        alnum < SCANNED_ALNUM_MAX
    ):
        return "scanned"
    return "text"


def classify_page(page: Any) -> tuple[PageKind, PageSignals]:
    signals = page_signals(page)
    return classify_from_signals(signals), signals
