const fs = require("fs");
const path = require("path");
const sharp = require("sharp");
const PDFDocument = require("pdfkit");

const SUPPORTED = new Set([".jpg", ".jpeg", ".png", ".webp", ".tiff", ".tif", ".bmp", ".gif"]);

function naturalSort(a, b) {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

async function imagesToPdf(inDir, outDir) {
  if (!fs.existsSync(inDir)) {
    console.error(`Input directory not found: ${inDir}`);
    process.exit(1);
  }

  fs.mkdirSync(outDir, { recursive: true });

  const images = fs
    .readdirSync(inDir)
    .filter((f) => SUPPORTED.has(path.extname(f).toLowerCase()))
    .sort(naturalSort)
    .map((f) => path.join(inDir, f));

  if (images.length === 0) {
    console.error(`No supported images found in: ${inDir}`);
    process.exit(1);
  }

  console.log(`Found ${images.length} image(s) — building PDF...`);

  const outputPdf = path.join(outDir, "output.pdf");
  const doc = new PDFDocument({ autoFirstPage: false });
  const writeStream = fs.createWriteStream(outputPdf);
  doc.pipe(writeStream);

  for (const imgPath of images) {
    try {
      const { width, height } = await sharp(imgPath).metadata();
      doc.addPage({ size: [width, height], margin: 0 });
      doc.image(imgPath, 0, 0, { width, height });
      console.log(`  Added: ${path.basename(imgPath)}`);
    } catch (err) {
      console.error(`  Skipped ${path.basename(imgPath)}: ${err.message}`);
    }
  }

  doc.end();

  await new Promise((resolve, reject) => {
    writeStream.on("finish", resolve);
    writeStream.on("error", reject);
  });

  console.log(`PDF created: ${outputPdf}`);
}

const inDir = process.argv[2] || path.join(__dirname, "in");
const outDir = process.argv[3] || path.join(__dirname, "out");

imagesToPdf(inDir, outDir);
