import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { join, extname, basename, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { PDFParse } from "pdf-parse"; // assuming the actual implementation matches your d.ts

// Anchor all directories on the package root (parent of src/), not on cwd,
// so the script works no matter where it is launched from.
const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const OUT_DIR = join(PKG_ROOT, "out");
const MD_DIR = join(PKG_ROOT, "md");

async function ensureDirs() {
    await mkdir(OUT_DIR, { recursive: true });
    await mkdir(MD_DIR, { recursive: true });
}

async function extractTextToMD(filePath: string, outputDir: string) {
    const dataBuffer = await readFile(filePath);

    // Instantiate the parser
    const pdfParser = new PDFParse({ data: dataBuffer }); // match LoadParameters interface
    const textResult = await pdfParser.getText(); // returns TextResult according to your d.ts
    const text = textResult.text.trim(); // full concatenated text

    const mdFileName = basename(filePath, ".pdf") + ".md";
    const mdPath = join(outputDir, mdFileName);

    const cleaned = cleanText(text);
    await writeFile(mdPath, cleaned);

    console.log(`✅ Markdown saved: ${mdFileName}`);
}

function cleanText(raw: string): string {
    const lines = raw.split(/\r?\n/);
    const paragraphs: string[] = [];
    let buffer = "";
    let tableBuffer: string[] = [];
    let inTable = false;

    for (let line of lines) {
        line = line.trim();

        // Skip empty lines but flush buffers
        if (!line) {
            if (buffer) {
                paragraphs.push(buffer);
                buffer = "";
            }
            if (tableBuffer.length) {
                paragraphs.push(convertTableToMarkdown(tableBuffer));
                tableBuffer = [];
                inTable = false;
            }
            continue;
        }

        // Normalize weird dashes
        line = line.replace(/[\u2010\u2011\u2012\u2013\u2014]/g, "-");

        // Skip lines with mostly garbage
        if (/^[^a-zA-Z0-9]{2,}$/.test(line)) continue;

        // Fix letter spacing like "B L O O D" → "BLOOD"
        line = line.replace(/(\b[A-Z])\s(?=[A-Z]\b)/g, "$1");

        // Detect all-caps headings
        if (line === line.toUpperCase() && line.length > 3 && !line.match(/\d/)) {
            if (buffer) {
                paragraphs.push(buffer);
                buffer = "";
            }
            if (tableBuffer.length) {
                paragraphs.push(convertTableToMarkdown(tableBuffer));
                tableBuffer = [];
                inTable = false;
            }
            paragraphs.push(`## ${line}`);
            continue;
        }

        // Detect table-like lines (multiple spaces)
        if (line.match(/\s{2,}/)) {
            inTable = true;
            tableBuffer.push(line.replace(/\s{2,}/g, " | ")); // replace multiple spaces with pipe
            continue;
        } else if (inTable) {
            // Flush table buffer
            paragraphs.push(convertTableToMarkdown(tableBuffer));
            tableBuffer = [];
            inTable = false;
        }

        // Handle hyphenated words at line breaks
        if (line.endsWith("-")) {
            buffer += line.slice(0, -1); // remove '-' and continue
        } else {
            if (buffer) {
                buffer += " " + line;
            } else {
                buffer = line;
            }
        }

        // Finalize sentences on punctuation or long lines
        if (/[.!?]$/.test(line) || line.length > 80) {
            paragraphs.push(buffer);
            buffer = "";
        }
    }

    // Push remaining buffers
    if (buffer) paragraphs.push(buffer);
    if (tableBuffer.length) paragraphs.push(convertTableToMarkdown(tableBuffer));

    return paragraphs.join("\n\n"); // double newline for paragraphs
}

// Helper to wrap table rows as Markdown table
function convertTableToMarkdown(rows: string[]): string {
    if (!rows.length) return "";

    const header = rows[0].split(" | ").map(h => h.trim());
    const separator = header.map(() => "---");
    const mdRows = rows.map(r => r.split(" | ").map(c => c.trim()).join(" | "));

    return [header.join(" | "), separator.join(" | "), ...mdRows.slice(1)].join("\n");
}


async function main() {
    await ensureDirs();

    const files = await readdir(OUT_DIR);
    const pdfs = files.filter(f => extname(f).toLowerCase() === ".pdf");

    if (pdfs.length === 0) {
        console.log("😴 No PDFs found in out/");
        return;
    }

    let ok = 0;
    let failed = 0;

    for (const pdf of pdfs) {
        const fullPath = join(OUT_DIR, pdf);
        try {
            await extractTextToMD(fullPath, MD_DIR);
            ok++;
        } catch (err) {
            failed++;
            console.error(`⚠️ Failed: ${pdf}`);
            console.error(err);
            // continue with next PDF instead of killing everything
        }
    }

    console.log(`🎉 Done: ${ok} ok, ${failed} failed`);
    if (failed > 0) {
        process.exitCode = 1;
    }
}

main().catch(err => {
    console.error("💥 Failed to convert PDFs to Markdown");
    console.error(err);
    process.exit(1);
});
