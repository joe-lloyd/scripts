# PDF OCR Processor

A Node.js script to automatically process PDFs with OCR, fix broken internal JPEG streams, and output processed PDFs.

## Features

- Automatically fixes PDFs with broken JPEG streams.
- Performs OCR on PDFs using `ocrmypdf`.
- Deskews and rotates pages automatically.
- Processes all PDFs in the `in/` folder and outputs to `out/`.
- Skips non-PDF files.
- Continues processing even if one PDF fails.

## Requirements

- Node.js 18+.
- `ocrmypdf` installed and accessible in your PATH, or set via the `OCR_MY_PDF_PATH` environment variable.
- `pdf-lib` (already in package.json if using npm/yarn).

    ```bash
    npm install pdf-lib
    ```

- Input PDFs go in `in/` folder.
- Output PDFs are written to `out/` folder.

## Usage

1. Add your PDFs to the `in/` folder.
2. (Optional) Set a custom path for `ocrmypdf`:

    ```bash
    export OCR_MY_PDF_PATH="/custom/path/to/ocrmypdf"
    ```

3. Run the script:

    ```bash
    node index.js
    ```

4. Check the `out/` folder for processed PDFs.

## Notes

- Script automatically creates `in/` and `out/` folders if they don't exist.
- Any errors in a PDF will be logged, but processing will continue for other files.
- Works on macOS, Linux, and Windows (make sure `ocrmypdf` is installed and executable).

## Emoji Legend

- 📄 Found PDFs
- 🔍 OCR in progress
- ✅ Done
- ⚠️ Failed
- 🎉 All PDFs processed
- 💥 Script failed
