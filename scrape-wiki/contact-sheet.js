/**
 * contact-sheet — lay a dataset folder out as one numbered grid image, so a
 * whole pull can be judged at a glance before training on it.
 *
 * Usage:
 *   node scrape-wiki/contact-sheet.js <dataset-dir> <output.jpg>
 *
 * Prints the numbered file list to stdout, so a cell in the sheet maps back to
 * the file to delete. Works on any folder of images, including scrape-booru's.
 */
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const dir = process.argv[2];
const outFile = process.argv[3];
const CELL = 320;
const COLS = 8;

(async () => {
  const files = fs.readdirSync(dir).filter((n) => /\.(jpg|jpeg|png|webp)$/i.test(n)).sort();
  const rows = Math.ceil(files.length / COLS);
  const cells = [];

  for (let i = 0; i < files.length; i++) {
    const thumb = await sharp(fs.readFileSync(path.join(dir, files[i])))
      .resize(CELL, CELL, { fit: 'contain', background: '#1a1a1a' })
      .toBuffer();
    const label = Buffer.from(
      `<svg width="${CELL}" height="40"><rect x="0" y="0" width="46" height="26" fill="#000c" rx="4"/>` +
        `<text x="8" y="19" font-family="sans-serif" font-size="17" fill="#fff">${i + 1}</text></svg>`
    );
    cells.push({ input: thumb, left: (i % COLS) * CELL, top: Math.floor(i / COLS) * CELL });
    cells.push({ input: label, left: (i % COLS) * CELL + 4, top: Math.floor(i / COLS) * CELL + 4 });
  }

  await sharp({ create: { width: COLS * CELL, height: rows * CELL, channels: 3, background: '#1a1a1a' } })
    .composite(cells)
    .jpeg({ quality: 88 })
    .toFile(outFile);

  files.forEach((f, i) => console.log(`${String(i + 1).padStart(2)}. ${f}`));
  console.log(`\nSheet: ${outFile}`);
})();
