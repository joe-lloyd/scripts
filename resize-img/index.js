const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const IN_DIR = path.join(__dirname, 'in');
const OUT_DIR = path.join(__dirname, 'out');

const SUPPORTED_EXTS = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
  '.tiff',
  '.tif',
  '.avif',
  '.gif',
]);

const USAGE =
  'Usage: node resize-img/index.js [--width <n>] [--height <n>] [--scale <percent>]';

function fail(message) {
  console.error(message);
  console.error(USAGE);
  process.exit(1);
}

function parseArgs(argv) {
  const opts = { width: null, height: null, scale: null };

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--width' || arg === '--height' || arg === '--scale') {
      const raw = argv[++i];
      const value = Number(raw);
      if (raw === undefined || !Number.isInteger(value) || value <= 0) {
        fail(`Invalid value for ${arg}: expected a positive integer, got "${raw}"`);
      }
      opts[arg.slice(2)] = value;
    } else {
      fail(`Unknown argument: ${arg}`);
    }
  }

  if (opts.scale !== null && (opts.scale < 1 || opts.scale > 500)) {
    fail(`--scale must be between 1 and 500, got ${opts.scale}`);
  }

  // Default: fit within 1920px wide when nothing is specified
  if (opts.scale === null && opts.width === null && opts.height === null) {
    opts.width = 1920;
  }

  return opts;
}

async function resizeFile(fileName, opts) {
  const inputPath = path.join(IN_DIR, fileName);
  const outputPath = path.join(OUT_DIR, fileName);
  const animated = path.extname(fileName).toLowerCase() === '.gif';

  const image = sharp(inputPath, { animated }).rotate(); // auto-orient from EXIF
  const meta = await image.metadata();

  // Original (auto-oriented) dimensions. For animated gifs, height is the
  // full frame stack, so use pageHeight instead.
  let origWidth = meta.width;
  let origHeight = meta.pages > 1 ? meta.pageHeight : meta.height;
  if (meta.orientation && meta.orientation >= 5) {
    [origWidth, origHeight] = [origHeight, origWidth];
  }

  if (opts.scale !== null) {
    const targetWidth = Math.max(1, Math.round((origWidth * opts.scale) / 100));
    const targetHeight = Math.max(1, Math.round((origHeight * opts.scale) / 100));
    image.resize(targetWidth, targetHeight, { fit: 'fill' });
  } else {
    image.resize({
      width: opts.width || undefined,
      height: opts.height || undefined,
      fit: 'inside',
      withoutEnlargement: true,
    });
  }

  const info = await image.toFile(outputPath);
  const outHeight =
    meta.pages > 1 ? Math.round(info.height / meta.pages) : info.height;

  console.log(
    `Resizing ${fileName} -> ${fileName} (${origWidth}x${origHeight} -> ${info.width}x${outHeight})`
  );
}

async function main() {
  const opts = parseArgs(process.argv);

  fs.mkdirSync(IN_DIR, { recursive: true });
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const entries = fs.readdirSync(IN_DIR);

  let resized = 0;
  let failed = 0;
  let skipped = 0;

  for (const name of entries) {
    if (name === '.gitkeep') {
      continue;
    }

    const inputPath = path.join(IN_DIR, name);
    if (fs.statSync(inputPath).isDirectory()) {
      console.log(`Skipping directory: ${name}`);
      skipped++;
      continue;
    }

    const ext = path.extname(name).toLowerCase();
    if (!SUPPORTED_EXTS.has(ext)) {
      console.log(`Skipping unsupported file: ${name}`);
      skipped++;
      continue;
    }

    try {
      await resizeFile(name, opts);
      resized++;
    } catch (err) {
      console.error(`Failed to resize ${name}: ${err.message}`);
      failed++;
    }
  }

  if (resized === 0 && failed === 0 && skipped === 0) {
    console.log('No images found in "in" directory. Drop some in and re-run.');
  }

  console.log(`Done: ${resized} resized, ${failed} failed, ${skipped} skipped`);

  if (failed > 0) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(`Unexpected error: ${err.message}`);
  process.exitCode = 1;
});
