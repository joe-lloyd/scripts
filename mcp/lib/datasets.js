/**
 * Reading what the dataset tools left on disk.
 *
 * scrape-booru, scrape-wiki and merge-datasets all write the same shape —
 * out/<character>/ holding images, a .txt caption beside each, and a
 * manifest.json — so one reader serves all three. Tool results quote these
 * numbers rather than the scripts' console output: an agent asking "did that
 * work" wants a count and a path, not a summary block to re-parse.
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..', '..');

const SOURCES = [
  { key: 'booru', dir: path.join(REPO_ROOT, 'scrape-booru', 'out') },
  { key: 'wiki', dir: path.join(REPO_ROOT, 'scrape-wiki', 'out') },
  { key: 'merged', dir: path.join(REPO_ROOT, 'merge-datasets', 'out') },
];

const IMAGE_EXT = /\.(jpe?g|png|webp)$/i;

/**
 * Loose character matching across sources. The two scrapers disagree by
 * construction — a booru tag carries the series (`shadowheart__baldur_s_gate`)
 * where the wiki has the bare name, and boorus file Japanese names surname
 * first — so comparison happens on a stripped-down key.
 */
function normalise(name) {
  return String(name)
    .toLowerCase()
    .replace(/\.(jpe?g|png|webp|txt)$/i, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/** The part before a `__series` suffix, which is the character alone. */
function baseName(name) {
  return normalise(name).split('__')[0];
}

function readManifest(dir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  } catch (err) {
    return null;
  }
}

function summarise(dir) {
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch (err) {
    return null;
  }

  const images = names.filter((name) => IMAGE_EXT.test(name));
  const captions = names.filter((name) => name.endsWith('.txt'));
  let bytes = 0;
  for (const name of images) {
    try {
      bytes += fs.statSync(path.join(dir, name)).size;
    } catch (err) {
      /* a file that vanished mid-scan is not worth failing the count over */
    }
  }

  const manifest = readManifest(dir);
  return {
    dir,
    name: path.basename(dir),
    images: images.length,
    captions: captions.length,
    bytes,
    // Only the parts of a manifest worth carrying back through a tool result;
    // the per-image list can run to hundreds of entries.
    manifest: manifest
      ? {
          character: manifest.character || manifest.tag || null,
          source: manifest.wiki || manifest.source || null,
          page: manifest.page || null,
          updated: manifest.updated || null,
          recorded: Array.isArray(manifest.images) ? manifest.images.length : null,
        }
      : null,
  };
}

/** Every dataset folder across all three tools. */
function list({ character = null } = {}) {
  const wanted = character ? baseName(character) : null;
  const found = [];

  for (const source of SOURCES) {
    let entries;
    try {
      entries = fs.readdirSync(source.dir, { withFileTypes: true });
    } catch (err) {
      continue; // that tool has simply never run
    }

    for (const entry of entries) {
      // Folders starting with _ are review scratch space, not datasets.
      if (!entry.isDirectory() || entry.name.startsWith('_')) continue;
      if (wanted) {
        const key = baseName(entry.name);
        if (key !== wanted && !key.includes(wanted) && !wanted.includes(key)) continue;
      }
      const summary = summarise(path.join(source.dir, entry.name));
      if (summary) found.push({ source: source.key, ...summary });
    }
  }

  return found;
}

/** Sample image files from a dataset, for a caller that wants to look at some. */
function sampleFiles(dir, count) {
  let names;
  try {
    names = fs.readdirSync(dir).filter((name) => IMAGE_EXT.test(name)).sort();
  } catch (err) {
    return [];
  }
  if (count <= 0 || names.length <= count) return names.map((n) => path.join(dir, n));

  // Spread across the folder rather than taking the first N, which on a
  // score-sorted booru pull would all be the same handful of popular posts.
  const step = names.length / count;
  const picked = [];
  for (let i = 0; i < count; i++) {
    picked.push(path.join(dir, names[Math.floor(i * step)]));
  }
  return picked;
}

module.exports = { list, summarise, sampleFiles, normalise, baseName, SOURCES, REPO_ROOT };
