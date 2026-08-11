import * as fs from "fs";
import * as path from "path";
import { createExtractorFromData } from "node-unrar-js";

const IN_DIR = path.join(__dirname, "in");
const OUT_DIR = path.join(__dirname, "out");

// Ensure input and output directories exist
fs.mkdirSync(IN_DIR, { recursive: true });
fs.mkdirSync(OUT_DIR, { recursive: true });

async function unrarFiles() {
  let ok = 0;
  let failed = 0;
  let skipped = 0;

  const files = fs.readdirSync(IN_DIR);
  const rarFiles = files.filter((f) => f.toLowerCase().endsWith(".rar"));

  if (rarFiles.length === 0) {
    console.log("No .rar files found in the in folder.");
    console.log("Done: 0 ok, 0 failed, 0 skipped");
    return;
  }

  const outRoot = path.resolve(OUT_DIR);

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

        // Zip-slip guard: never write outside the out directory
        const resolved = path.resolve(outPath);
        if (!resolved.startsWith(outRoot + path.sep)) {
          console.warn(
            `  Skipped unsafe entry (escapes out/): ${item.fileHeader.name}`
          );
          skipped++;
          continue;
        }

        const outDir = path.dirname(resolved);
        if (!fs.existsSync(outDir)) {
          fs.mkdirSync(outDir, { recursive: true });
        }

        if (!item.fileHeader.flags.directory) {
          fs.writeFileSync(resolved, item.extraction as Uint8Array);
          console.log(`  Extracted: ${item.fileHeader.name}`);
        }
      }
      console.log(`Successfully extracted ${file}`);
      ok++;
    } catch (err) {
      console.error(`Error extracting ${file}:`, err);
      failed++;
    }
  }

  console.log(`Done: ${ok} ok, ${failed} failed, ${skipped} skipped`);
  if (failed > 0) {
    process.exitCode = 1;
  }
}

unrarFiles().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
