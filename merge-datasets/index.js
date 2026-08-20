/**
 * merge-datasets — collect every character dataset into one training folder.
 *
 * Usage:
 *   node merge-datasets/index.js                       (one folder per character)
 *   node merge-datasets/index.js --repeats 10          (kohya-style 10_<name>/)
 *   node merge-datasets/index.js --per-character 30    (cap each character)
 *   node merge-datasets/index.js --flat                (everything in one folder)
 *
 * scrape-booru and scrape-wiki each write a folder per character, so a single
 * character ends up split across two of them under different names. This
 * gathers the pieces into out/<character>/ — one folder each, both sources
 * combined — which is the layout a trainer expects.
 *
 * Sources are only ever read. Deleting a bad image from a character folder and
 * re-running is the intended way to correct the merge.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const REPO_ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(__dirname, 'out');

// Every tool that produces per-character dataset folders.
const SOURCE_DIRS = [
  path.join(REPO_ROOT, 'scrape-booru', 'out'),
  path.join(REPO_ROOT, 'scrape-wiki', 'out'),
];

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp']);

const USAGE =
  'Usage: node merge-datasets/index.js [--out <dir>] [--per-character <n>] ' +
  '[--only <a,b,c>] [--repeats <n>] [--flat] [--clean]';

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function ensureGitkeep(dir) {
  const keepPath = path.join(dir, '.gitkeep');
  if (!fs.existsSync(keepPath)) {
    fs.writeFileSync(keepPath, '');
  }
}

function formatBytes(bytes) {
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  return i === 0 ? `${value} B` : `${value.toFixed(2)} ${units[i]}`;
}

function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'dataset';
}

function sha1(filePath) {
  return crypto.createHash('sha1').update(fs.readFileSync(filePath)).digest('hex');
}

/** Every image in a dataset folder, ignoring captions and the manifest. */
function listImages(dir) {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase()))
    .map((entry) => entry.name)
    .sort();
}

/**
 * Find every character dataset across the source tools. Folders starting with
 * "_" are review scratch (contact sheets, quarantined files), never datasets.
 */
function findDatasets(only) {
  const datasets = [];

  for (const sourceDir of SOURCE_DIRS) {
    if (!fs.existsSync(sourceDir)) continue;
    const tool = path.basename(path.dirname(sourceDir));

    for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith('_')) continue;
      const dir = path.join(sourceDir, entry.name);
      const images = listImages(dir);
      if (images.length === 0) continue;
      if (only && !only.some((want) => entry.name.toLowerCase().includes(want))) continue;
      datasets.push({ tool, name: entry.name, dir, images });
    }
  }

  return datasets;
}

/**
 * Do two dataset folder names describe the same character?
 *
 * Two things have to be caught. A source often qualifies the name — the booru
 * tag carries the series (shadowheart__baldur_s_gate against the wiki's plain
 * shadowheart) — which the prefix test handles. And the two sources disagree
 * about Japanese name order: boorus file surname-first (fujibayashi_kyou,
 * gasai_yuno, shimizu_hinako) while the wikis use given-name-first. Comparing
 * the words as an unordered set catches those, which a prefix test never can.
 */
function sameCharacter(a, b) {
  if (a === b) return true;
  if (a.startsWith(b) || b.startsWith(a)) return true;

  const wordsA = a.split('_').filter(Boolean).sort();
  const wordsB = b.split('_').filter(Boolean).sort();
  return wordsA.length === wordsB.length && wordsA.every((word, i) => word === wordsB[i]);
}

/**
 * Group dataset folders by character, returning slug -> [dataset]. Grouping is
 * transitive: three folders for one character collapse to one entry even when
 * only neighbouring pairs match.
 */
function groupByCharacter(datasets) {
  const groups = [];

  for (const dataset of datasets) {
    const slug = slugify(dataset.name);
    const existing = groups.find((group) => group.slugs.some((other) => sameCharacter(slug, other)));
    if (existing) {
      existing.slugs.push(slug);
      existing.datasets.push(dataset);
    } else {
      groups.push({ slugs: [slug], datasets: [dataset] });
    }
  }

  // Label with the shortest name in the group — the unqualified one, which is
  // the better trigger word.
  const byLabel = new Map();
  for (const group of groups) {
    const label = [...group.slugs].sort((x, y) => x.length - y.length || x.localeCompare(y))[0];
    byLabel.set(label, group.datasets);
  }
  return byLabel;
}

function parseArgs(argv) {
  const options = {
    out: null,
    perCharacter: 0,
    only: null,
    // 0 = plain <character>/ folders. Above 0 prefixes them "<n>_", which kohya
    // and sd-scripts read as "repeat this folder n times per epoch".
    repeats: 0,
    flat: false,
    clean: false,
  };

  const valueFlags = new Set(['--out', '--per-character', '--only', '--repeats']);

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (valueFlags.has(arg)) {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) {
        console.error(`Error: ${arg} needs a value. ${USAGE}`);
        process.exit(1);
      }
      i++;
      if (arg === '--out') options.out = value;
      else if (arg === '--per-character') options.perCharacter = Number(value);
      else if (arg === '--repeats') options.repeats = Number(value);
      else options.only = value.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
      continue;
    }

    if (arg === '--flat') options.flat = true;
    // --subfolders was the old opt-in for what is now the default.
    else if (arg === '--subfolders') options.flat = false;
    else if (arg === '--clean') options.clean = true;
    else if (arg === '--help' || arg === '-h') {
      console.log(USAGE);
      process.exit(0);
    } else {
      console.error(`Error: unknown option "${arg}". ${USAGE}`);
      process.exit(1);
    }
  }

  if (!Number.isInteger(options.perCharacter) || options.perCharacter < 0 || options.perCharacter > 1000) {
    console.error('Error: --per-character must be a whole number between 0 (no cap) and 1000.');
    process.exit(1);
  }
  if (!Number.isInteger(options.repeats) || options.repeats < 0 || options.repeats > 100) {
    console.error('Error: --repeats must be a whole number between 0 (no prefix) and 100.');
    process.exit(1);
  }

  return options;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const outDir = options.out ? path.resolve(process.cwd(), options.out) : OUT_DIR;

  console.log('');
  console.log('merge-datasets — one folder for training');
  console.log('---------------------------------------');

  const datasets = findDatasets(options.only);
  if (datasets.length === 0) {
    console.log('No character datasets found. Run scrape-booru or scrape-wiki first.');
    return;
  }

  ensureDir(outDir);
  if (options.clean) {
    // Only ever clears what this tool produces, never a source dataset.
    for (const entry of fs.readdirSync(outDir, { withFileTypes: true })) {
      if (entry.name === '.gitkeep') continue;
      fs.rmSync(path.join(outDir, entry.name), { recursive: true, force: true });
    }
    console.log('Cleared the output folder first (--clean).');
  }
  ensureGitkeep(outDir);

  const byCharacter = groupByCharacter(datasets);

  console.log(`Merging ${datasets.length} dataset folder(s) into ${byCharacter.size} character(s).`);
  console.log(`Output: ${outDir}`);
  console.log('');

  const seenHashes = new Set();
  let copied = 0;
  let skippedExisting = 0;
  let duplicates = 0;
  let missingCaptions = 0;
  let bytes = 0;

  for (const [label, sources] of [...byCharacter.entries()].sort()) {
    const folderName = options.repeats > 0 ? `${options.repeats}_${label}` : label;
    const destDir = options.flat ? outDir : path.join(outDir, folderName);
    ensureDir(destDir);

    let taken = 0;
    let characterCopied = 0;

    for (const dataset of sources) {
      for (const image of dataset.images) {
        if (options.perCharacter > 0 && taken >= options.perCharacter) break;

        const sourcePath = path.join(dataset.dir, image);
        const hash = sha1(sourcePath);
        if (seenHashes.has(hash)) {
          duplicates++;
          continue;
        }
        seenHashes.add(hash);

        // Prefix with the character so a booru post id and a wiki file name can
        // never collide once they share a folder.
        const stem = path.parse(image).name;
        // A per-character folder already separates them; a flat merge needs the
        // character in the name so a booru post id cannot collide with a wiki file.
        const destName = options.flat ? `${label}__${stem}${path.extname(image)}` : image;
        const destPath = path.join(destDir, destName);
        const captionSource = path.join(dataset.dir, `${stem}.txt`);
        const captionDest = path.join(destDir, `${path.parse(destName).name}.txt`);

        taken++;

        if (fs.existsSync(destPath)) {
          skippedExisting++;
          continue;
        }

        fs.copyFileSync(sourcePath, destPath);
        bytes += fs.statSync(destPath).size;
        copied++;
        characterCopied++;

        if (fs.existsSync(captionSource)) {
          fs.copyFileSync(captionSource, captionDest);
        } else {
          missingCaptions++;
        }
      }
    }

    const from = sources.map((s) => s.tool.replace('scrape-', '')).join(' + ');
    console.log(`  ${label.padEnd(28)} ${String(taken).padStart(3)} image(s) from ${from}` +
      (characterCopied !== taken ? ` (${characterCopied} new)` : ''));
  }

  console.log('');
  console.log('Summary:');
  console.log(`  Characters:       ${byCharacter.size}`);
  console.log(`  Copied:           ${copied} (${formatBytes(bytes)})`);
  console.log(`  Already there:    ${skippedExisting}`);
  if (duplicates > 0) {
    console.log(`  Duplicates:       ${duplicates} identical file(s) skipped`);
  }
  if (missingCaptions > 0) {
    console.log(`  Missing captions: ${missingCaptions} image(s) copied without a .txt`);
  }
  console.log(
    `  Layout:           ${
      options.flat
        ? 'flat, one folder'
        : `out/${options.repeats > 0 ? `${options.repeats}_` : ''}<character>/ — one folder each`
    }`
  );
  console.log(`  Output:           ${outDir}`);
}

try {
  main();
} catch (err) {
  console.error(`Fatal error: ${err.message}`);
  process.exitCode = 1;
}
