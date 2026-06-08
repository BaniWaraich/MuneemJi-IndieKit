"""Extract every page of a bank-statement PDF as raw whitespace-laid-out text.

Uses page.extract_text(layout=True) for every page and concatenates them
into a single string. No table detection, no row merging — column
alignment is preserved by whitespace so the downstream LLM can read the
table directly.

Usage: python extract-pages.py <path_to_pdf> [password]

- On success: emits one JSON object to stdout and exits 0:
    { "pages": [ { "page": N, "text": "..." } ] }
- If the PDF is encrypted and NO password was supplied (or the encryption
    handler/algorithm is unrecognised): emits { "encrypted": true } to stdout
    and exits 2.
- If a password WAS supplied but it does not unlock the PDF: emits
    { "encrypted": true, "wrong_password": true } to stdout and exits 3.

Both cases are driven by pdfminer's PDFEncryptionError (PDFPasswordIncorrect is
a subclass), raised either at open time or while extracting page content.

The password (when supplied) is read from argv[2] only and is never echoed
to stdout or stderr — the JSON signals above never contain it.
"""
import json
import sys

import pdfplumber

# pdfplumber (>=0.11) wraps pdfminer.six. An encrypted PDF opened without the
# correct password raises pdfminer.pdfdocument.PDFPasswordIncorrect. We catch the
# PARENT class PDFEncryptionError instead: PDFPasswordIncorrect subclasses it, so
# the wrong/no-password cases still work, AND we additionally cover PDFs whose
# encryption handler/algorithm pdfminer does not recognise (e.g. "Unknown
# algorithm" / "Unknown security handler") — those raise the bare
# PDFEncryptionError and would otherwise crash with exit 1 instead of routing to
# the password prompt. pdfminer raises the SAME exception whether no password or
# a wrong password was given — the two cases are distinguished here by whether a
# password arg was supplied. The error can surface either at open time or lazily
# while extracting page content, so both are guarded.
from pdfminer.pdfdocument import PDFEncryptionError


def _emit_encrypted(password):
    """Emit the encryption signal extract-pages.py's caller maps to HTTP 422.
    Never includes the supplied password."""
    if password is None:
        json.dump({"encrypted": True}, sys.stdout)
        sys.exit(2)
    json.dump({"encrypted": True, "wrong_password": True}, sys.stdout)
    sys.exit(3)


def main():
    if len(sys.argv) not in (2, 3):
        print("Usage: python extract-pages.py <pdf_path> [password]", file=sys.stderr)
        sys.exit(1)

    pdf_path = sys.argv[1]
    password = sys.argv[2] if len(sys.argv) == 3 else None

    # pdfplumber.open accepts password=None for non-encrypted PDFs without issue.
    open_kwargs = {} if password is None else {"password": password}

    try:
        pdf = pdfplumber.open(pdf_path, **open_kwargs)
        pages_out = []
        with pdf:
            for idx, page in enumerate(pdf.pages, start=1):
                text = page.extract_text(layout=True) or ""
                pages_out.append({"page": idx, "text": text})
    except PDFEncryptionError:
        _emit_encrypted(password)

    json.dump({"pages": pages_out}, sys.stdout)


if __name__ == "__main__":
    main()
