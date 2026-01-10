import * as fs from "fs";
import * as path from "path";
import { createExtractorFromData } from "node-unrar-js";

import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const IN_DIR = path.join(__dirname, "in");
const OUT_DIR = path.join(__dirname, "out");

async function unrarFiles() {
  if (!fs.existsSync(IN_DIR)) {
    console.error(`Input directory does not exist: ${IN_DIR}`);
    return;
  }

  if (!fs.existsSync(OUT_DIR)) {
    fs.mkdirSync(OUT_DIR, { recursive: true });
  }

  const files = fs.readdirSync(IN_DIR);
  const rarFiles = files.filter((f) => f.toLowerCase().endsWith(".rar"));

  if (rarFiles.length === 0) {
    console.log("No .rar files found in the in folder.");
    return;
  }

  for (const file of rarFiles) {
    const filePath = path.join(IN_DIR, file);
    console.log(`Processing: ${file}`);

    try {
      const buffer = fs.readFileSync(filePath);
      const data = buffer.buffer.slice(
        buffer.byteOffset,
        buffer.byteOffset + buffer.byteLength
      );
      const extractor = await createExtractorFromData({ data });

      const list = extractor.getFileList();
      const fileList = [...list.fileHeaders];

      const extracted = extractor.extract({
        files: fileList.map((f) => f.name),
      });

      for (const item of extracted.files) {
        const outPath = path.join(OUT_DIR, item.fileHeader.name);
        const outDir = path.dirname(outPath);

        if (!fs.existsSync(outDir)) {
          fs.mkdirSync(outDir, { recursive: true });
        }

        if (!item.fileHeader.flags.directory) {
          fs.writeFileSync(outPath, item.extraction as Uint8Array);
          console.log(`  Extracted: ${item.fileHeader.name}`);
        }
      }
      console.log(`Successfully extracted ${file}`);
    } catch (err) {
      console.error(`Error extracting ${file}:`, err);
    }
  }
}

unrarFiles().catch(console.error);
