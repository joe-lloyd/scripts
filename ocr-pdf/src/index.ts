import { readdir, mkdir, stat, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { join, extname, basename, parse, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { PDFDocument } from "pdf-lib";

// Anchor all directories on the package root (parent of src/), not on cwd,
// so the script works no matter where it is launched from.
const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const IN_DIR = join(PKG_ROOT, "in");
const OUT_DIR = join(PKG_ROOT, "out");
const TEMP_DIR = join(PKG_ROOT, "temp");

async function fixPDFImages(filePath: string) {
    const pdfBytes = await readFile(filePath);
    const pdfDoc = await PDFDocument.load(pdfBytes);

    // just saving it again can fix broken internal JPEG streams
    const fixedBytes = await pdfDoc.save();
    const fixedPath = join(TEMP_DIR, parse(filePath).name + "_fixed.pdf");
    await writeFile(fixedPath, fixedBytes);
    return fixedPath;
}

// Ensure input/output/temp folders exist
async function ensureDirs() {
    await mkdir(IN_DIR, { recursive: true });
    await mkdir(OUT_DIR, { recursive: true });
    await mkdir(TEMP_DIR, { recursive: true });
}

function runOCR(input: string, output: string) {
    return new Promise<void>((resolve, reject) => {
        // Use env variable OCR_MY_PDF_PATH or fallback to just "ocrmypdf" on PATH
        const ocrPath = process.env.OCR_MY_PDF_PATH || "ocrmypdf";

        const proc = spawn(
            ocrPath,
            [
                "--force-ocr",
                "--deskew",
                "--rotate-pages",
                "--output-type",
                "pdf",
                input,
                output
            ],
            { stdio: "inherit" }
        );

        proc.on("error", (err: NodeJS.ErrnoException) => {
            if (err.code === "ENOENT") {
                console.error(
                    `Could not find "${ocrPath}". Install ocrmypdf (it requires Tesseract and Ghostscript), ` +
                    `e.g. "pip install ocrmypdf" or "brew install ocrmypdf", ` +
                    `or point OCR_MY_PDF_PATH at the binary.`
                );
            }
            reject(err);
        });

        proc.on("exit", code => {
            if (code === 0) resolve();
            else reject(new Error(`ocrmypdf exited with ${code}`));
        });
    });
}

async function main() {
    await ensureDirs();

    const files = await readdir(IN_DIR);
    const pdfs = [];

    for (const file of files) {
        const fullPath = join(IN_DIR, file);
        const info = await stat(fullPath);

        // Skip leftover "*_fixed.pdf" intermediates from older versions of this
        // script that wrote them into in/ (defensive, avoids reprocessing).
        if (
            info.isFile() &&
            extname(file).toLowerCase() === ".pdf" &&
            !file.toLowerCase().endsWith("_fixed.pdf")
        ) {
            pdfs.push(file);
        }
    }

    if (pdfs.length === 0) {
        console.log("😴 No PDFs found in /in");
        return;
    }

    console.log(`📄 Found ${pdfs.length} PDF(s)`);

    for (const file of pdfs) {
        const input = join(IN_DIR, file);
        const output = join(OUT_DIR, file);

        console.log(`🔍 OCR → ${basename(file)}`);
        let inputFixedImages: string | undefined;
        try {
            inputFixedImages = await fixPDFImages(input);
            await runOCR(inputFixedImages, output);

            console.log(`✅ Done: ${basename(file)}`);
        } catch (err) {
            console.error(`⚠️ Failed: ${basename(file)}`);
            console.error(err);
            // continue with next PDF instead of killing everything
        } finally {
            // Clean up the temp intermediate regardless of outcome
            if (inputFixedImages) {
                await rm(inputFixedImages, { force: true });
            }
        }
    }

    console.log("🎉 All PDFs processed");
}

main().catch(err => {
    console.error("💥 OCR script failed");
    console.error(err);
    process.exit(1);
});
