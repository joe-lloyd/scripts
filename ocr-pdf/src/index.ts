import { readdir, mkdir, stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { join, extname, basename } from "node:path";
import { PDFDocument } from "pdf-lib";

async function fixPDFImages(filePath: string) {
    const pdfBytes = await readFile(filePath);
    const pdfDoc = await PDFDocument.load(pdfBytes);

    // just saving it again can fix broken internal JPEG streams
    const fixedBytes = await pdfDoc.save();
    const fixedPath = filePath.replace(".pdf", "_fixed.pdf");
    await writeFile(fixedPath, fixedBytes);
    return fixedPath;
}


const IN_DIR = join(process.cwd(), "in");
const OUT_DIR = join(process.cwd(), "out");

// Ensure input/output folders exist
async function ensureDirs() {
    await mkdir(IN_DIR, { recursive: true });
    await mkdir(OUT_DIR, { recursive: true });
}

function runOCR(input: string, output: string) {
    return new Promise<void>((resolve, reject) => {
        const env = {
            ...process.env,
            PIL_IMAGEFILE_LOAD_TRUNCATED_IMAGES: "1" // allows truncated JPEGs
        };

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
            { stdio: "inherit", env }
        );

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

        if (info.isFile() && extname(file).toLowerCase() === ".pdf") {
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
        try {
            const inputFixedImages = await fixPDFImages(input);
            await runOCR(inputFixedImages, output);

            console.log(`✅ Done: ${basename(file)}`);
        } catch (err) {
            console.error(`⚠️ Failed: ${basename(file)}`);
            console.error(err);
            // continue with next PDF instead of killing everything
        }
    }

    console.log("🎉 All PDFs processed");
}

main().catch(err => {
    console.error("💥 OCR script failed");
    console.error(err);
    process.exit(1);
});
