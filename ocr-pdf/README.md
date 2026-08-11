# PDF OCR Processor

A Node.js script to automatically process PDFs with OCR, fix broken internal JPEG streams, and output processed PDFs.

## Features

- Automatically fixes PDFs with broken JPEG streams.
- Performs OCR on PDFs using `ocrmypdf`.
- Deskews and rotates pages automatically.
- Processes all PDFs in the `in/` folder and outputs to `out/`.
- Extracts the OCRed text from `out/` PDFs into Markdown files in `md/`.
- Skips non-PDF files.
- Continues processing even if one PDF fails.

## Requirements

- Node.js 18+.
- Install the Node dependencies:

    ```bash
    npm install
    ```

- The external OCR toolchain: `ocrmypdf` installed and accessible in your PATH (or set via the `OCR_MY_PDF_PATH` environment variable). `ocrmypdf` itself requires [Tesseract](https://github.com/tesseract-ocr/tesseract) and [Ghostscript](https://www.ghostscript.com/) to be installed.

- Input PDFs go in `in/` folder.
- Output PDFs are written to `out/` folder.
- Markdown files are written to `md/` folder.

## Usage

### Stage 1: OCR (`in/` → `out/`)

1. Add your PDFs to the `in/` folder.
2. (Optional) Set a custom path for `ocrmypdf`:

    ```bash
    export OCR_MY_PDF_PATH="/custom/path/to/ocrmypdf"
    ```

3. Run the OCR script:

    ```bash
    npm run ocr
    ```

4. Check the `out/` folder for processed PDFs.

### Stage 2: Markdown extraction (`out/` → `md/`)

Once PDFs have been OCRed into `out/`, extract their text into cleaned-up Markdown:

```bash
npm run md
```

One `.md` file per PDF is written to the `md/` folder. It prints a `Done: N ok, M failed` summary and exits non-zero if any file failed.

## Notes

- Scripts automatically create the `in/`, `out/`, `md/`, and `temp/` folders if they don't exist; intermediate "fixed" PDFs live in `temp/` and are deleted after each file is processed.
- Any errors in a PDF will be logged, but processing will continue for other files.
- Works on macOS, Linux, and Windows (make sure `ocrmypdf` is installed and executable).

## Emoji Legend

- 📄 Found PDFs
- 🔍 OCR in progress
- ✅ Done
- ⚠️ Failed
- 🎉 All PDFs processed
- 💥 Script failed
