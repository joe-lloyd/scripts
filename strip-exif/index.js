const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

// Directories
const inputDir = path.join(__dirname, 'in');
const outputDir = path.join(__dirname, 'out');

// Supported image extensions (lowercase). .gif is intentionally excluded:
// sharp would re-encode animated gifs lossily, so gifs are logged as skipped.
const SUPPORTED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp', '.tiff', '.tif', '.avif'];

// Ensure in/ and out/ exist
for (const dir of [inputDir, outputDir]) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * Format a byte count as a human-readable string.
 * @param {number} bytes
 * @returns {string}
 */
function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Strip all metadata (EXIF/GPS/XMP/IPTC) from a single image.
 * .rotate() with no arguments applies the EXIF Orientation tag by physically
 * rotating the pixels, so the image still displays correctly after the tag is
 * removed. sharp strips metadata by default (no .withMetadata() call).
 * @param {string} fileName - File name inside in/
 * @returns {Promise<void>}
 */
async function stripMetadata(fileName) {
  const inputPath = path.join(inputDir, fileName);
  const outputPath = path.join(outputDir, fileName);
  const ext = path.extname(fileName).toLowerCase();

  console.log(`Processing: ${fileName}`);

  const pipeline = sharp(inputPath).rotate();

  switch (ext) {
    case '.jpg':
    case '.jpeg':
      pipeline.jpeg({ quality: 95, mozjpeg: true });
      break;
    case '.png':
      pipeline.png();
      break;
    case '.webp':
      pipeline.webp({ quality: 95 });
      break;
    case '.tiff':
    case '.tif':
      pipeline.tiff();
      break;
    case '.avif':
      pipeline.avif({ quality: 70 });
      break;
    default:
      // Should not happen (extension filter runs first), but stay safe.
      throw new Error(`Unsupported extension: ${ext}`);
  }

  await pipeline.toFile(outputPath);

  const inputSize = fs.statSync(inputPath).size;
  const outputSize = fs.statSync(outputPath).size;
  console.log(`${fileName}: ${formatBytes(inputSize)} -> ${formatBytes(outputSize)} (metadata removed)`);
}

/**
 * Main entry point: process every supported image in in/.
 */
async function main() {
  const entries = fs.readdirSync(inputDir);

  let stripped = 0;
  let failed = 0;
  let skipped = 0;

  if (entries.length === 0) {
    console.log('No files found in in/. Drop some images there and run again.');
  }

  for (const entry of entries) {
    const entryPath = path.join(inputDir, entry);

    if (entry === '.gitkeep') {
      continue;
    }

    if (fs.statSync(entryPath).isDirectory()) {
      console.log(`Skipping directory: ${entry}`);
      skipped++;
      continue;
    }

    const ext = path.extname(entry).toLowerCase();
    if (!SUPPORTED_EXTENSIONS.includes(ext)) {
      if (ext === '.gif') {
        console.log(`Skipping ${entry}: gif is not supported (re-encoding animated gifs is lossy)`);
      } else {
        console.log(`Skipping unsupported file: ${entry}`);
      }
      skipped++;
      continue;
    }

    try {
      await stripMetadata(entry);
      stripped++;
    } catch (error) {
      console.error(`Failed to process ${entry}:`, error.message);
      failed++;
    }
  }

  console.log(`Done: ${stripped} stripped, ${failed} failed, ${skipped} skipped`);

  if (failed > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error('Unexpected error:', error);
  process.exitCode = 1;
});
