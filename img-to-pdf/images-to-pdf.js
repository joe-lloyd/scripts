const fs = require("fs");
const path = require("path");
const sharp = require("sharp");
const PDFDocument = require("pdfkit");

// Formats sharp can decode (no .bmp — sharp has no BMP decoder)
const SUPPORTED = new Set([".jpg", ".jpeg", ".png", ".webp", ".tiff", ".tif", ".gif"]);

function naturalSort(a, b) {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

async function imagesToPdf(inDir, outDir) {
  // Ensure input and output directories exist
  fs.mkdirSync(inDir, { recursive: true });
  fs.mkdirSync(outDir, { recursive: true });

  const entries = fs
    .readdirSync(inDir)
    .filter((f) => fs.statSync(path.join(inDir, f)).isFile());

  const images = entries
    .filter((f) => SUPPORTED.has(path.extname(f).toLowerCase()))
    .sort(naturalSort)
    .map((f) => path.join(inDir, f));

  // Unsupported (non-dot) files count as skipped
  const skipped = entries.filter(
    (f) => !f.startsWith(".") && !SUPPORTED.has(path.extname(f).toLowerCase())
  ).length;

  if (images.length === 0) {
    console.log(`No supported images found in: ${inDir}`);
    console.log(`Done: 0 ok, 0 failed, ${skipped} skipped`);
    return;
  }

  console.log(`Found ${images.length} image(s) — building PDF...`);

  const outputPdf = path.join(outDir, "output.pdf");
  if (fs.existsSync(outputPdf)) {
    console.log(`Note: overwriting existing ${outputPdf}`);
  }

  const doc = new PDFDocument({ autoFirstPage: false });
  const writeStream = fs.createWriteStream(outputPdf);
  doc.pipe(writeStream);

  let ok = 0;
  let failed = 0;

  for (const imgPath of images) {
    try {
      // pdfkit only decodes JPEG/PNG, so decode every image with sharp first.
      // .rotate() bakes in any EXIF orientation so portrait photos get
      // portrait pages. Only add a page once the decode has succeeded.
      const ext = path.extname(imgPath).toLowerCase();
      const pipeline = sharp(imgPath).rotate();
      const buf =
        ext === ".jpg" || ext === ".jpeg"
          ? await pipeline.jpeg({ quality: 95 }).toBuffer()
          : await pipeline.png().toBuffer();
      const { width, height } = await sharp(buf).metadata();

      doc.addPage({ size: [width, height], margin: 0 });
      doc.image(buf, 0, 0, { width, height });
      ok++;
      console.log(`  Added: ${path.basename(imgPath)}`);
    } catch (err) {
      failed++;
      console.error(`  Failed ${path.basename(imgPath)}: ${err.message}`);
    }
  }

  doc.end();

  await new Promise((resolve, reject) => {
    writeStream.on("finish", resolve);
    writeStream.on("error", reject);
  });

  if (ok === 0) {
    // Every image failed — don't leave an empty/invalid PDF behind
    fs.unlinkSync(outputPdf);
    console.error("No images could be added — removed empty PDF.");
  } else {
    console.log(`PDF created: ${outputPdf}`);
  }

  console.log(`Done: ${ok} ok, ${failed} failed, ${skipped} skipped`);
  if (failed > 0) {
    process.exitCode = 1;
  }
}

const inDir = process.argv[2] || path.join(__dirname, "in");
const outDir = process.argv[3] || path.join(__dirname, "out");

imagesToPdf(inDir, outDir).catch((err) => {
  console.error(err);
  process.exit(1);
});
