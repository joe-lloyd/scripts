const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const IN_DIR = path.join(__dirname, 'in');
const OUT_DIR = path.join(__dirname, 'out');

const INPUT_EXTENSIONS = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
  '.tiff',
  '.tif',
  '.avif',
  '.gif',
]);

const TARGET_FORMATS = ['png', 'jpg', 'jpeg', 'webp', 'avif', 'tiff'];

// Normalize a format/extension so equivalent spellings compare equal
// (jpg === jpeg, tif === tiff).
function normalizeFormat(fmt) {
  if (fmt === 'jpg') return 'jpeg';
  if (fmt === 'tif') return 'tiff';
  return fmt;
}

function parseTargetFormat(argv) {
  let target = 'webp';
  const toIndex = argv.indexOf('--to');
  if (toIndex !== -1) {
    target = (argv[toIndex + 1] || '').toLowerCase();
  }
  if (!TARGET_FORMATS.includes(target)) {
    console.error(
      `Error: unknown target format "${target}". Supported formats: ${TARGET_FORMATS.join(', ')}.`
    );
    console.error('Usage: node convert-img/index.js [--to <format>]');
    process.exit(1);
  }
  return target;
}

function applyEncoder(pipeline, target) {
  switch (normalizeFormat(target)) {
    case 'jpeg':
      return pipeline.jpeg({ quality: 90, mozjpeg: true });
    case 'webp':
      return pipeline.webp({ quality: 90 });
    case 'avif':
      return pipeline.avif({ quality: 60 });
    case 'png':
      return pipeline.png();
    case 'tiff':
      return pipeline.tiff();
    default:
      // Unreachable: parseTargetFormat validates the target.
      throw new Error(`Unsupported target format: ${target}`);
  }
}

async function main() {
  const target = parseTargetFormat(process.argv.slice(2));

  fs.mkdirSync(IN_DIR, { recursive: true });
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const entries = fs.readdirSync(IN_DIR, { withFileTypes: true });

  let converted = 0;
  let failed = 0;
  let skipped = 0;
  const producedNames = new Set();

  console.log(`Converting images in "in/" to ${target} ...`);

  for (const entry of entries) {
    const name = entry.name;

    if (entry.isDirectory()) {
      console.log(`Skipping ${name}/ (directory)`);
      skipped++;
      continue;
    }

    if (name === '.gitkeep') {
      console.log('Skipping .gitkeep');
      skipped++;
      continue;
    }

    const ext = path.extname(name).toLowerCase();
    if (!INPUT_EXTENSIONS.has(ext)) {
      console.log(`Skipping ${name} (unsupported extension)`);
      skipped++;
      continue;
    }

    const sourceFormat = normalizeFormat(ext.slice(1));
    if (sourceFormat === normalizeFormat(target)) {
      console.log(`Skipping ${name} (already ${target})`);
      skipped++;
      continue;
    }

    const baseName = path.parse(name).name;
    let outName = `${baseName}.${target}`;
    if (producedNames.has(outName.toLowerCase())) {
      outName = `${baseName}${ext}.${target}`;
      console.log(
        `Output name collision for ${baseName}.${target}; writing ${name} as ${outName}`
      );
    }
    producedNames.add(outName.toLowerCase());

    try {
      const pipeline = sharp(path.join(IN_DIR, name)).rotate();
      await applyEncoder(pipeline, target).toFile(path.join(OUT_DIR, outName));
      console.log(`Converted ${name} -> ${outName}`);
      converted++;
    } catch (err) {
      console.error(`Failed to convert ${name}: ${err.message}`);
      failed++;
    }
  }

  if (converted + failed + skipped === 0) {
    console.log('No files found in "in/". Drop some images there and rerun.');
  }

  console.log(`Done: ${converted} converted, ${failed} failed, ${skipped} skipped`);
  if (failed > 0) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(`Unexpected error: ${err.message}`);
  process.exitCode = 1;
});
