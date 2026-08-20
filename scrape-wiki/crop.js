/**
 * crop — trim an image by hand, for the frames face detection cannot fix.
 *
 * Usage:
 *   node scrape-wiki/crop.js <image> <spec> [spec ...]
 *
 * Specs, applied left to right:
 *   right:40%        trim 40% off the right edge (also left/top/bottom)
 *   center:60%       keep the middle 60% of the width
 *   box:x,y,w,h      exact pixels
 *
 * Examples:
 *   node scrape-wiki/crop.js out/yuna/Yuna-tidus-love.jpg right:52%
 *   node scrape-wiki/crop.js out/yuna/dancers.jpg box:380,0,260,575
 *
 * Automatic --crop on the scrapers keeps the largest face and stops short of
 * any other face, which handles the common two-shot. It cannot help when the
 * extra people are too small or dark to detect, or when what you want gone has
 * no face in frame at all — that is what this is for. Edits in place, writing
 * to a .part file first, and re-encodes JPEG at the same quality as the cap.
 */

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { JPEG_QUALITY } = require('../lib/dataset-image');

const USAGE = 'Usage: node scrape-wiki/crop.js <image> <spec> [spec ...]   (specs: right:40% | left:10% | top:5% | bottom:12% | center:60% | box:x,y,w,h)';

/** Apply one spec to the current {left, top, width, height} window. */
function applySpec(win, spec) {
  const [name, rawValue] = spec.split(':');
  if (!rawValue) throw new Error(`spec "${spec}" needs a value, e.g. right:40%`);

  if (name === 'box') {
    const parts = rawValue.split(',').map(Number);
    if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
      throw new Error(`box needs four numbers: box:x,y,w,h (got "${rawValue}")`);
    }
    const [x, y, w, h] = parts;
    return { left: win.left + x, top: win.top + y, width: w, height: h };
  }

  const percent = Number(rawValue.replace('%', ''));
  if (!Number.isFinite(percent) || percent <= 0 || percent >= 100) {
    throw new Error(`"${spec}" needs a percentage between 0 and 100`);
  }

  switch (name) {
    case 'right':
      return { ...win, width: Math.round(win.width * (1 - percent / 100)) };
    case 'left': {
      const cut = Math.round(win.width * (percent / 100));
      return { ...win, left: win.left + cut, width: win.width - cut };
    }
    case 'bottom':
      return { ...win, height: Math.round(win.height * (1 - percent / 100)) };
    case 'top': {
      const cut = Math.round(win.height * (percent / 100));
      return { ...win, top: win.top + cut, height: win.height - cut };
    }
    case 'center': {
      const width = Math.round(win.width * (percent / 100));
      return { ...win, left: win.left + Math.round((win.width - width) / 2), width };
    }
    default:
      throw new Error(`unknown spec "${name}" — use right, left, top, bottom, center or box`);
  }
}

async function main() {
  const [file, ...specs] = process.argv.slice(2);
  if (!file || specs.length === 0) {
    console.error(USAGE);
    process.exit(1);
  }
  if (!fs.existsSync(file)) {
    console.error(`Error: "${file}" does not exist.`);
    process.exit(1);
  }

  const source = fs.readFileSync(file);
  const meta = await sharp(source).metadata();

  let win = { left: 0, top: 0, width: meta.width, height: meta.height };
  try {
    for (const spec of specs) win = applySpec(win, spec);
  } catch (err) {
    console.error(`Error: ${err.message}`);
    console.error(USAGE);
    process.exit(1);
  }

  // Keep the window inside the image; an off-by-one past the edge is an error
  // in sharp rather than a smaller crop.
  win.left = Math.max(0, Math.min(win.left, meta.width - 1));
  win.top = Math.max(0, Math.min(win.top, meta.height - 1));
  win.width = Math.max(1, Math.min(win.width, meta.width - win.left));
  win.height = Math.max(1, Math.min(win.height, meta.height - win.top));

  const format = meta.format === 'png' || meta.format === 'webp' ? meta.format : 'jpeg';
  const partPath = `${file}.part`;
  try {
    await sharp(source)
      .extract(win)
      .toFormat(format, format === 'jpeg' ? { quality: JPEG_QUALITY, mozjpeg: true } : {})
      .toFile(partPath);
    fs.renameSync(partPath, file);
  } catch (err) {
    fs.rmSync(partPath, { force: true });
    throw err;
  }

  console.log(
    `${path.basename(file)}: ${meta.width}x${meta.height} -> ${win.width}x${win.height} ` +
      `(kept x ${win.left}..${win.left + win.width}, y ${win.top}..${win.top + win.height})`
  );
}

main().catch((err) => {
  console.error(`Fatal error: ${err.message}`);
  process.exitCode = 1;
});
