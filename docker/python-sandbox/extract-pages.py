"""Extract every page of a bank-statement PDF as raw whitespace-laid-out text.

Uses page.extract_text(layout=True) for every page and concatenates them
into a single string. No table detection, no row merging — column
alignment is preserved by whitespace so the downstream LLM can read the
table directly.

Usage: python extract-pages.py <path_to_pdf>
Emits one JSON object to stdout: { "pages": [ { "page": N, "text": "..." } ] }
"""
import json
import sys

import pdfplumber


def main():
    if len(sys.argv) != 2:
        print("Usage: python extract-pages.py <pdf_path>", file=sys.stderr)
        sys.exit(1)

    pdf_path = sys.argv[1]
    pages_out = []

    with pdfplumber.open(pdf_path) as pdf:
        for idx, page in enumerate(pdf.pages, start=1):
            text = page.extract_text(layout=True) or ""
            pages_out.append({"page": idx, "text": text})

    json.dump({"pages": pages_out}, sys.stdout)


if __name__ == "__main__":
    main()
