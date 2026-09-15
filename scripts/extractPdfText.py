import pathlib
import sys

from pypdf import PdfReader


def main() -> int:
    if len(sys.argv) != 4:
        raise SystemExit("usage: extractPdfText.py PDF START_PAGE END_PAGE")
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    pdf_path = pathlib.Path(sys.argv[1]).resolve(strict=True)
    start_page = int(sys.argv[2])
    end_page = int(sys.argv[3])
    if start_page < 1 or end_page < start_page or end_page - start_page + 1 > 100:
        raise SystemExit("invalid bounded page range")
    reader = PdfReader(str(pdf_path))
    last_page = min(end_page, len(reader.pages))
    for page_number in range(start_page, last_page + 1):
        text = reader.pages[page_number - 1].extract_text() or ""
        sys.stdout.write(text)
        sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
