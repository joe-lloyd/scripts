import { readdir, mkdir, stat } from "node:fs/promises";
import { join, extname, basename } from "node:path";
import { spawn } from "node:child_process";

const IN_DIR = join(process.cwd(), "in");
const OUT_DIR = join(process.cwd(), "out");

async function ensureDirs() {
    await mkdir(IN_DIR, { recursive: true });
    await mkdir(OUT_DIR, { recursive: true });
}

function runOCR(input: string, output: string) {
    return new Promise<void>((resolve, reject) => {
        const proc = spawn("ocrmypdf", [
            "--optimize", "3",
            "--skip-text",
            input,
            output
        ], { stdio: "inherit" });

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
        await runOCR(input, output);
        console.log(`✅ Done: ${basename(file)}`);
    }

    console.log("🎉 All PDFs processed");
}

main().catch(err => {
    console.error("💥 OCR failed");
    console.error(err);
    process.exit(1);
});
