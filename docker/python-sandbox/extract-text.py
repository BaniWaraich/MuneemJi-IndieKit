"""Extract raw text from the first 2 pages of a PDF using pdfplumber.

Usage: python extract-text.py <path_to_pdf>
Prints raw text to stdout.
"""
import sys
import pdfplumber


def main():
    if len(sys.argv) != 2:
        print("Usage: python extract-text.py <pdf_path>", file=sys.stderr)
        sys.exit(1)

    pdf_path = sys.argv[1]
    with pdfplumber.open(pdf_path) as pdf:
        pages = pdf.pages[:2]
        for page in pages:
            text = page.extract_text()
            if text:
                print(text)


if __name__ == "__main__":
    main()
