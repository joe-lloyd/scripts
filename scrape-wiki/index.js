/**
 * scrape-wiki — build a character image dataset from a game wiki (MediaWiki).
 *
 * Usage:
 *   node scrape-wiki/index.js                                    (interactive)
 *   node scrape-wiki/index.js --wiki bg3.wiki --page Shadowheart
 *   node scrape-wiki/index.js --wiki cyberpunk.fandom.com --page "Panam Palmer" --limit 25
 *
 * The companion to scrape-booru: where a booru is fan art by construction, a
 * game wiki holds official renders, promotional shots and in-game screenshots —
 * the character as the game actually draws them. Anything running MediaWiki
 * works (Fandom, wiki.gg, bg3.wiki, mariowiki.com), because they all expose the
 * same api.php.
 *
 * Wikis also host a great deal of furniture — icons, logos, UI chrome, item
 * sprites — so candidates are filtered by size, aspect and file name before
 * anything is downloaded. Output matches scrape-booru exactly: out/<character>/
 * with a .txt caption per image, capped at 1024px, plus a manifest recording
 * each file's source page and licence.
 */

const fs = require('fs');
const path = require('path');
const readline = require('node:readline/promises');
const {
  JPEG_QUALITY,
  fileLooksLikeImage,
  findExisting,
  downloadImage,
  capImage,
  measureBackground,
  cropToMainCharacter,
} = require('../lib/dataset-image');

const OUT_DIR = path.join(__dirname, 'out');

// Wikis sit behind CDNs that answer an unfamiliar user agent with an HTML
// challenge page, so this one leads with Mozilla and then says what it is.
const USER_AGENT = 'Mozilla/5.0 (compatible; scrape-wiki/1.0; personal dataset tool)';

// Bursts get throttled — several rapid queries come back as HTML rather than
// JSON. One request a second keeps every wiki tested here happy.
const REQUEST_DELAY_MS = 1000;

const DEFAULT_LIMIT = 40;
const DEFAULT_MIN_SIZE = 512;
const DEFAULT_MAX_SIZE = 1024;

// Anything narrower than a 3:1 letterbox is a banner or a UI strip, not art.
const MAX_ASPECT = 3;

const IMAGE_MIME = /^image\/(jpeg|png|webp)$/;

// File names that are furniture rather than character art, at any size:
// merchandise photography, composite plates, national flags, wiki chrome.
// Concept art, render, portrait and promotional deliberately survive this.
const SKIP_NAME = new RegExp(
  [
    'logo', 'banner', 'achievement', 'trophy', 'map', 'favicon', 'placeholder',
    'template', 'divider', 'border', 'frame', 'sprite', 'chart', 'graph',
    'header', 'footer', 'wordmark', 'infobox', 'spoiler', 'stub', 'wiki-',
    // Composite plates: every dye of one item, every variant of one outfit.
    'dye', 'dyed', 'swatch', 'palette', 'variants', 'comparison', 'sheet', 'grid', 'table',
    // Merchandise photography and country flags. Big wikis file both under a
    // character: the Resident Evil wiki returned statue product shots and the
    // Chinese and Mexican flags for "Claire Redfield", all of which sail past
    // the size, aspect and backdrop checks.
    'flag', 'figure', 'figurine', 'statue', 'nendoroid', 'funko', 'amiibo', 'plush',
    'keychain', 'merch', 'packaging', 'unboxing', 'product', 'prime_1', 'prime 1',
    // "_box_front" / "_box_inside" — retail packaging shot from every angle.
    '_box_', 'box_front', 'box_back', 'box_inside', 'boxart',
  ].join('|'),
  'i'
);

// Words that mean "interface furniture" at thumbnail size and "character
// portrait" at full size. The Stellar Blade wiki files both under the same
// name: two dozen 128px roster icons, and "Evie icon.png" at 1197x1266, which
// is a high-res bust and among the best training images on the page. Rejecting
// on the word alone threw the good one away with the chrome.
const SKIP_NAME_IF_SMALL = /icon|button|badge|cursor|thumbnail|symbol|emblem|tooltip|ui[-_]/i;
const FURNITURE_MAX_SIZE = 800;

// A downloaded image whose backdrop is this black is a composite plate, not a
// screenshot. Above DOMINANT_WARN of one flat colour is worth a look but often
// legitimate — an official render cut out on white lands there.
const NEAR_BLACK_REJECT = 0.4;
const DOMINANT_WARN = 0.5;

const WIKI_PRESETS = [
  { label: "Baldur's Gate 3 (bg3.wiki)", api: 'https://bg3.wiki/w/api.php' },
  { label: 'Cyberpunk 2077 (cyberpunk.fandom.com)', api: 'https://cyberpunk.fandom.com/api.php' },
  { label: 'Final Fantasy (finalfantasy.fandom.com)', api: 'https://finalfantasy.fandom.com/api.php' },
  { label: 'Super Mario (mariowiki.com)', api: 'https://www.mariowiki.com/api.php' },
  { label: 'Clair Obscur: Expedition 33 (expedition33.fandom.com)', api: 'https://expedition33.fandom.com/api.php' },
  { label: 'Another wiki — type its address', api: null },
];

const USAGE =
  'Usage: node scrape-wiki/index.js [--wiki <host>] [--page <title>] ' +
  '[--character <name>] [--limit <n>] [--min-size <px>] [--max-size <px>] ' +
  '[--out <dir>] [--caption "<text>"] [--match <pattern>] [--no-captions] [--crop] [--resize-only]';

// Reused by --resize-only to find images already on disk.
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp']);

// Captions have no tag list to draw on the way a booru does, so they state the
// trigger word and the style, which is the whole point of this source.
const DEFAULT_CAPTION = 'official art';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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

/** Turn a page title into a folder name that is safe on every platform. */
function slugify(name) {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'dataset'
  );
}

/** File:Shadowheart-promotional.jpg -> Shadowheart-promotional.jpg */
function fileNameFromTitle(title) {
  const withoutNamespace = title.replace(/^File:/i, '');
  return withoutNamespace.replace(/[^a-z0-9._-]+/gi, '_');
}

// ---- MediaWiki API ----------------------------------------------------------

let lastRequestAt = 0;

async function apiRequest(api, params, label) {
  // Self-imposed pacing: wikis answer a burst with an HTML challenge page.
  const wait = REQUEST_DELAY_MS - (Date.now() - lastRequestAt);
  if (wait > 0) await sleep(wait);
  lastRequestAt = Date.now();

  const url = new URL(api);
  url.searchParams.set('format', 'json');
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, String(value));
  }

  const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' } });
  if (!response.ok) {
    throw new Error(`${label} failed: HTTP ${response.status} ${response.statusText}`);
  }

  const body = (await response.text()).trim();
  if (!body.startsWith('{')) {
    throw new Error(
      `${label} came back as a web page rather than JSON — the wiki is rate-limiting this machine. ` +
        'Wait a minute and try again.'
    );
  }

  const data = JSON.parse(body);
  if (data.error) {
    throw new Error(`${label} failed: ${data.error.info || data.error.code}`);
  }
  return data;
}

/**
 * Work out a wiki's api.php from whatever the user typed — a bare host, a page
 * URL, or the endpoint itself — by asking each candidate who it is.
 */
async function resolveApi(input) {
  const trimmed = input.trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  const host = trimmed.split('/')[0];
  const candidates = /api\.php$/i.test(trimmed)
    ? [`https://${trimmed}`]
    : [`https://${host}/api.php`, `https://${host}/w/api.php`, `https://${host}/wiki/api.php`];

  for (const candidate of candidates) {
    try {
      const data = await apiRequest(candidate, { action: 'query', meta: 'siteinfo' }, 'Wiki lookup');
      const name = data.query && data.query.general ? data.query.general.sitename : host;
      return { api: candidate, name };
    } catch {
      // Try the next layout before giving up on the host entirely.
    }
  }

  throw new Error(`could not find a MediaWiki API on "${host}" (tried ${candidates.join(', ')})`);
}

/** Search article titles, so the user picks a real page rather than guessing. */
async function searchPages(api, term) {
  const data = await apiRequest(
    { action: 'query', list: 'search', srsearch: term, srnamespace: 0, srlimit: 10 },
    'Page search'
  );
  const results = data.query && data.query.search ? data.query.search : [];
  return results.map((result) => result.title);
}

const IMAGE_INFO = { prop: 'imageinfo', iiprop: 'url|size|mime|sha1|extmetadata' };

/** Pull the imageinfo records out of an api.php response. */
function collectImages(data, into) {
  const pages = data.query && data.query.pages ? Object.values(data.query.pages) : [];
  for (const page of pages) {
    if (!page.imageinfo || !page.imageinfo[0]) continue;
    const info = page.imageinfo[0];
    if (!into.has(page.title)) into.set(page.title, { title: page.title, ...info });
  }
}

/** "Yuna (Final Fantasy X-2 party member)" -> "Yuna" */
function bareName(title) {
  return title.replace(/\s*\(.*\)\s*$/, '').trim() || title;
}

/**
 * Gather image candidates for a character from three angles, because no single
 * one is complete: the article's own images, its /Gallery subpage, and a file
 * search.
 *
 * The file search deliberately searches the bare character name, not the full
 * page title: a disambiguated title like "Yuna (Final Fantasy X-2 party
 * member)" makes "Final Fantasy X-2", "party" and "member" search terms too,
 * and on a big franchise wiki those match nearly everything — measured on
 * Yuna, that pulled in unrelated monsters, other characters and even other
 * games, dropping the useful fraction of results to about one in seven.
 * Searching "Yuna" alone found more genuine candidates and far less noise.
 */
async function gatherImages(api, title) {
  const searchName = bareName(title);
  const found = new Map();
  const sources = [
    ['page', { action: 'query', generator: 'images', titles: title, gimlimit: 500, ...IMAGE_INFO }],
    // Gallery subpages are named inconsistently across wikis — bg3.wiki uses
    // /Gallery, the Future Diary wiki uses /Image Gallery. A miss just returns
    // nothing, so trying both costs one paced request.
    ['gallery', { action: 'query', generator: 'images', titles: `${title}/Gallery`, gimlimit: 500, ...IMAGE_INFO }],
    ['image gallery', { action: 'query', generator: 'images', titles: `${title}/Image Gallery`, gimlimit: 500, ...IMAGE_INFO }],
    [
      'file search',
      { action: 'query', generator: 'search', gsrsearch: searchName, gsrnamespace: 6, gsrlimit: 200, ...IMAGE_INFO },
    ],
  ];

  for (const [label, params] of sources) {
    const before = found.size;
    try {
      collectImages(await apiRequest(api, params, `Image lookup (${label})`), found);
      console.log(`  ${label}: ${found.size - before} new candidate(s)`);
    } catch (err) {
      console.log(`  ${label}: skipped (${err.message})`);
    }
  }

  return [...found.values()];
}

/**
 * Drop everything that is not usable character art: wrong format, too small,
 * banner-shaped, obvious UI furniture, or a byte-identical duplicate. Returns
 * the keepers biggest-first, since resolution is the best quality proxy a wiki
 * offers.
 */
function filterImages(images, minSize, match) {
  const reasons = { format: 0, small: 0, shape: 0, furniture: 0, duplicate: 0, unmatched: 0 };
  const seenHashes = new Set();
  const kept = [];

  for (const image of images) {
    // --match narrows to one design era. A character page often spans remakes
    // and sequels whose file names are the only thing telling them apart.
    if (match && !match.test(image.title)) {
      reasons.unmatched++;
      continue;
    }
    if (!IMAGE_MIME.test(image.mime || '')) {
      reasons.format++;
      continue;
    }
    const short = Math.min(image.width, image.height);
    const long = Math.max(image.width, image.height);
    if (SKIP_NAME.test(image.title)) {
      reasons.furniture++;
      continue;
    }
    if (SKIP_NAME_IF_SMALL.test(image.title) && short < FURNITURE_MAX_SIZE) {
      reasons.furniture++;
      continue;
    }
    if (!short || short < minSize) {
      reasons.small++;
      continue;
    }
    if (long / short > MAX_ASPECT) {
      reasons.shape++;
      continue;
    }
    if (image.sha1 && seenHashes.has(image.sha1)) {
      reasons.duplicate++;
      continue;
    }
    if (image.sha1) seenHashes.add(image.sha1);
    kept.push(image);
  }

  kept.sort((a, b) => b.width * b.height - a.width * a.height);
  return { kept, reasons };
}

/** extmetadata values arrive as HTML; captions and manifests want plain text. */
function plainText(value) {
  if (!value || !value.value) return '';
  return String(value.value)
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ---- Prompts ----------------------------------------------------------------

async function askText(rl, question, defaultValue = '') {
  const suffix = defaultValue ? ` [${defaultValue}]` : '';
  while (true) {
    const answer = (await rl.question(`${question}${suffix}: `)).trim();
    if (answer !== '') return answer;
    if (defaultValue) return defaultValue;
    console.log('  Please type something (or press Ctrl+C to quit).');
  }
}

async function askChoice(rl, question, options, defaultIndex = 0) {
  console.log('');
  console.log(question);
  options.forEach((option, i) => console.log(`  ${i + 1}) ${option.label}`));
  while (true) {
    const answer = (await rl.question(`Choice [${defaultIndex + 1}]: `)).trim();
    if (answer === '') return options[defaultIndex];
    const choice = Number(answer);
    if (Number.isInteger(choice) && choice >= 1 && choice <= options.length) {
      return options[choice - 1];
    }
    console.log(`  Please enter a number between 1 and ${options.length}.`);
  }
}

async function askNumber(rl, question, defaultValue, min, max) {
  while (true) {
    const answer = (await rl.question(`${question} [${defaultValue}]: `)).trim();
    if (answer === '') return defaultValue;
    const value = Number(answer);
    if (Number.isInteger(value) && value >= min && value <= max) return value;
    console.log(`  Please enter a whole number between ${min} and ${max}.`);
  }
}

async function askYesNo(rl, question, defaultYes = true) {
  const suffix = defaultYes ? '[Y/n]' : '[y/N]';
  while (true) {
    const answer = (await rl.question(`${question} ${suffix}: `)).trim().toLowerCase();
    if (answer === '') return defaultYes;
    if (answer === 'y' || answer === 'yes') return true;
    if (answer === 'n' || answer === 'no') return false;
    console.log('  Please answer y or n.');
  }
}

/** Pick a wiki from the presets, or type any MediaWiki address. */
async function chooseWiki(rl) {
  while (true) {
    const picked = await askChoice(rl, 'Which wiki?', WIKI_PRESETS, 0);
    const input = picked.api || (await askText(rl, 'Wiki address (e.g. eldenring.wiki.gg)'));

    console.log(`Looking for the MediaWiki API on ${input.replace(/^https?:\/\//, '').split('/')[0]}...`);
    try {
      const wiki = await resolveApi(input);
      console.log(`  Found ${wiki.name}`);
      return wiki;
    } catch (err) {
      console.log(`  ${err.message}`);
    }
  }
}

/** Search-and-pick loop for the character's article. */
async function choosePage(rl, wiki) {
  while (true) {
    const term = await askText(rl, 'Which character?');

    console.log(`Searching ${wiki.name} for "${term}"...`);
    let titles = [];
    try {
      titles = await searchPages(wiki.api, term);
    } catch (err) {
      console.error(`  Page search failed: ${err.message}`);
    }

    if (titles.length === 0) {
      console.log('  No pages matched. Try another spelling.');
      continue;
    }

    const options = titles.map((title) => ({ value: title, label: title }));
    options.push({ value: null, label: 'None of these — search again' });

    const picked = await askChoice(rl, 'Matching pages:', options, 0);
    if (picked.value) return picked.value;
  }
}

// ---- Arguments --------------------------------------------------------------

function parseArgs(argv) {
  const options = {
    wiki: null,
    page: null,
    character: null,
    limit: DEFAULT_LIMIT,
    minSize: DEFAULT_MIN_SIZE,
    maxSize: DEFAULT_MAX_SIZE,
    out: null,
    caption: DEFAULT_CAPTION,
    match: null,
    captions: true,
    crop: false,
    resizeOnly: false,
  };

  const valueFlags = new Set([
    '--wiki', '--page', '--character', '--limit', '--min-size', '--max-size', '--out', '--caption', '--match',
  ]);

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (valueFlags.has(arg)) {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) {
        console.error(`Error: ${arg} needs a value. ${USAGE}`);
        process.exit(1);
      }
      i++;
      if (arg === '--wiki') options.wiki = value;
      else if (arg === '--page') options.page = value;
      else if (arg === '--character') options.character = value;
      else if (arg === '--limit') options.limit = Number(value);
      else if (arg === '--min-size') options.minSize = Number(value);
      else if (arg === '--max-size') options.maxSize = Number(value);
      else if (arg === '--caption') options.caption = value;
      else if (arg === '--match') {
        try {
          options.match = new RegExp(value, 'i');
        } catch (err) {
          console.error(`Error: --match "${value}" is not a valid pattern (${err.message}).`);
          process.exit(1);
        }
      } else options.out = value;
      continue;
    }

    if (arg === '--no-captions') {
      options.captions = false;
    } else if (arg === '--crop') {
      options.crop = true;
    } else if (arg === '--resize-only') {
      options.resizeOnly = true;
    } else if (arg === '--help' || arg === '-h') {
      console.log(USAGE);
      process.exit(0);
    } else {
      console.error(`Error: unknown option "${arg}". ${USAGE}`);
      process.exit(1);
    }
  }

  if (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > 500) {
    console.error('Error: --limit must be a whole number between 1 and 500.');
    process.exit(1);
  }
  if (!Number.isInteger(options.minSize) || options.minSize < 0 || options.minSize > 4096) {
    console.error('Error: --min-size must be a whole number between 0 and 4096.');
    process.exit(1);
  }
  if (!Number.isInteger(options.maxSize) || options.maxSize < 0 || (options.maxSize > 0 && options.maxSize < 256) || options.maxSize > 4096) {
    console.error('Error: --max-size must be 0 (no cap) or a whole number between 256 and 4096.');
    process.exit(1);
  }
  if (options.page && !options.wiki) {
    console.error(`Error: --page needs --wiki as well. ${USAGE}`);
    process.exit(1);
  }

  return options;
}

/** Merge this run's images into out/<character>/manifest.json, keyed by title. */
function writeManifest(datasetDir, meta, entries) {
  const manifestPath = path.join(datasetDir, 'manifest.json');
  const byTitle = new Map();

  if (fs.existsSync(manifestPath)) {
    try {
      const previous = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      for (const entry of previous.images || []) byTitle.set(entry.title, entry);
    } catch (err) {
      console.warn(`  Warning: could not read the existing manifest (${err.message}) — rewriting it.`);
    }
  }

  for (const entry of entries) byTitle.set(entry.title, entry);

  // Keep the manifest honest about what is actually in the folder.
  for (const [title, entry] of byTitle) {
    if (!fs.existsSync(path.join(datasetDir, entry.file))) byTitle.delete(title);
  }

  const manifest = {
    character: meta.character,
    wiki: meta.wiki,
    page: meta.page,
    updated: new Date().toISOString(),
    images: [...byTitle.values()].sort((a, b) => b.width * b.height - a.width * a.height),
  };
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return manifest.images.length;
}

/** Every image file in a dataset folder, ignoring captions and the manifest. */
function listImages(dir) {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase()))
    .map((entry) => entry.name)
    .sort();
}

/**
 * --resize-only: crop and/or cap the images in a dataset already on disk. No
 * network, no wiki lookup. Defaults to every folder in out/; --out narrows it
 * to one. Point it at scrape-booru's out/ too — this only touches image files
 * and never assumes which tool produced them.
 */
async function runResizeOnly(options) {
  if (options.maxSize === 0 && !options.crop) {
    console.error('Error: --resize-only needs a --max-size above 0 or --crop — there is nothing to do otherwise.');
    process.exit(1);
  }

  const dirs = options.out
    ? [path.resolve(process.cwd(), options.out)]
    : fs
        .readdirSync(OUT_DIR, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && !entry.name.startsWith('_'))
        .map((entry) => path.join(OUT_DIR, entry.name));

  for (const dir of dirs) {
    if (!fs.existsSync(dir)) {
      console.error(`Error: "${dir}" does not exist.`);
      process.exit(1);
    }
  }
  if (dirs.length === 0) {
    console.log(`No dataset folders in "${OUT_DIR}" yet — download one first.`);
    return;
  }

  const steps = [options.crop && 'cropping out extra faces', options.maxSize > 0 && `capping at ${options.maxSize}px short side (JPEG q${JPEG_QUALITY})`]
    .filter(Boolean)
    .join(', then ');
  console.log(`${steps}, ${dirs.length} folder(s).`);

  const totals = { files: 0, resized: 0, cropped: 0, skipped: 0, failed: 0, before: 0, after: 0 };
  for (const dir of dirs) {
    const files = listImages(dir);
    totals.files += files.length;
    console.log('');
    console.log(`${path.basename(dir)}: ${files.length} image(s)`);

    for (const name of files) {
      let filePath = path.join(dir, name);
      let label = name;
      try {
        if (options.crop) {
          const cropped = await cropToMainCharacter(filePath);
          if (cropped.changed) {
            totals.cropped++;
            console.log(`  ${label}: cropped out a second face (${cropped.width}x${cropped.height})`);
            filePath = cropped.filePath;
            label = path.basename(filePath);
          }
        }

        if (options.maxSize > 0) {
          const result = await capImage(filePath, options.maxSize);
          totals.before += result.before;
          totals.after += result.after;
          if (result.changed) {
            totals.resized++;
            console.log(
              `  ${label} -> ${path.basename(result.filePath)} ` +
                `(${result.width}x${result.height}, ${formatBytes(result.before)} -> ${formatBytes(result.after)})`
            );
          } else {
            totals.skipped++;
            console.log(`  ${label} already within the cap`);
          }
        }
      } catch (err) {
        console.error(`  Failed to process ${name}: ${err.message}`);
        totals.failed++;
      }
    }

    // A crop can leave the manifest's width/height stale for the images it
    // touched; the file list itself stays accurate since it just re-reads disk.
    refreshManifest(dir);
  }

  console.log('');
  console.log('Summary:');
  console.log(`  Images:           ${totals.files}`);
  if (options.crop) {
    console.log(`  Cropped:          ${totals.cropped} (extra face removed)`);
  }
  if (options.maxSize > 0) {
    console.log(`  Resized:          ${totals.resized}`);
    console.log(`  Already capped:   ${totals.skipped}`);
    console.log(`  Size:             ${formatBytes(totals.before)} -> ${formatBytes(totals.after)}`);
  }
  console.log(`  Failed:           ${totals.failed}`);

  if (totals.failed > 0) {
    process.exitCode = 1;
  }
}

/**
 * Point a folder's manifest back at the files that are really there — a crop
 * or cap can rename or remove images — dropping any entry whose image is gone.
 */
function refreshManifest(dir) {
  const manifestPath = path.join(dir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) return;

  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (err) {
    console.warn(`  Warning: could not read ${manifestPath} (${err.message}) — leaving it alone.`);
    return;
  }

  const present = new Set(listImages(dir));
  const entries = (manifest.images || []).filter((entry) => present.has(entry.file));
  writeManifest(dir, { character: manifest.character, wiki: manifest.wiki, page: manifest.page }, entries);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  ensureDir(OUT_DIR);
  ensureGitkeep(OUT_DIR);

  console.log('');
  console.log('scrape-wiki — character dataset builder (source: game wikis)');
  console.log('------------------------------------------------------------');

  // Resizing/cropping what is already on disk asks nothing and downloads nothing.
  if (options.resizeOnly) {
    await runResizeOnly(options);
    return;
  }

  const interactive = !options.wiki || !options.page;
  if (interactive && !process.stdin.isTTY) {
    console.error(`Error: no terminal to prompt on — pass --wiki and --page instead. ${USAGE}`);
    process.exit(1);
  }

  let wiki;
  let page = options.page;
  let limit = options.limit;

  if (interactive) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    try {
      wiki = options.wiki ? await resolveApi(options.wiki) : await chooseWiki(rl);
      page = page || (await choosePage(rl, wiki));
      limit = await askNumber(rl, 'How many images?', options.limit, 1, 500);

      console.log('');
      console.log(`  Wiki:      ${wiki.name}`);
      console.log(`  Page:      ${page}`);
      console.log(`  Images:    up to ${limit}, at least ${options.minSize}px on the short side`);
      console.log('');
      if (!(await askYesNo(rl, 'Start downloading?'))) {
        console.log('Cancelled — nothing was downloaded.');
        return;
      }
    } finally {
      rl.close();
    }
  } else {
    wiki = await resolveApi(options.wiki);
  }

  const character = options.character || page.replace(/\s*\(.*\)$/, '');
  const datasetDir = options.out ? path.resolve(process.cwd(), options.out) : path.join(OUT_DIR, slugify(character));
  ensureDir(datasetDir);

  console.log('');
  console.log(`Wiki:   ${wiki.name} (${wiki.api})`);
  console.log(`Page:   ${page}`);
  console.log(`Output: ${datasetDir}`);
  console.log('Collecting image candidates...');

  const candidates = await gatherImages(wiki.api, page);
  if (candidates.length === 0) {
    console.log('');
    console.log(`No images found for "${page}". Check the page title on the wiki and try again.`);
    return;
  }

  const { kept, reasons } = filterImages(candidates, options.minSize, options.match);
  console.log(
    `Filtered ${candidates.length} candidate(s) down to ${kept.length}: ` +
      `${reasons.small} too small, ${reasons.furniture} icons/UI, ${reasons.shape} banner-shaped, ` +
      `${reasons.format} wrong format, ${reasons.duplicate} duplicate` +
      (options.match ? `, ${reasons.unmatched} not matching --match.` : '.')
  );

  const selected = kept.slice(0, limit);
  if (selected.length === 0) {
    console.log('Nothing survived filtering — try a lower --min-size.');
    return;
  }
  if (selected.length < limit) {
    console.log(`Only ${selected.length} usable image(s) on this page — wikis are smaller than boorus.`);
  }

  // ---- Download ------------------------------------------------------------
  let downloaded = 0;
  let skippedExisting = 0;
  let repaired = 0;
  let junk = 0;
  let cropCount = 0;
  let failed = 0;
  let bytes = 0;
  const entries = [];

  for (let i = 0; i < selected.length; i++) {
    const image = selected[i];
    let fileName = fileNameFromTitle(image.title);
    const filePath = path.join(datasetDir, fileName);
    const progress = `${String(i + 1).padStart(3, '0')}/${selected.length}`;
    const stem = path.parse(fileName).name;

    const record = (finalName) =>
      entries.push({
        title: image.title,
        file: finalName,
        width: image.width,
        height: image.height,
        url: image.url,
        page: image.descriptionurl || '',
        licence: plainText(image.extmetadata && image.extmetadata.LicenseShortName),
        credit: plainText(image.extmetadata && image.extmetadata.Artist),
      });

    const existingPath = findExisting(datasetDir, stem, path.extname(fileName));
    if (existingPath) {
      fileName = path.basename(existingPath);
      if (fileLooksLikeImage(existingPath)) {
        console.log(`${progress} Skipped ${fileName} (already downloaded)`);
        skippedExisting++;
        record(fileName);
        continue;
      }
      console.log(`${progress} Replacing ${fileName} (on disk, but not a valid image)`);
      fs.rmSync(existingPath, { force: true });
      repaired++;
    }

    let keptPath = filePath;
    try {
      const size = await downloadImage(image.url, filePath, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'image/*' },
      });
      let note = `${image.width}x${image.height}, ${formatBytes(size)}`;

      if (options.crop) {
        const cropped = await cropToMainCharacter(filePath);
        if (cropped.changed) {
          cropCount++;
          note = `cropped to ${cropped.width}x${cropped.height}, ${formatBytes(size)}`;
        }
      }

      if (options.maxSize > 0) {
        const capped = await capImage(filePath, options.maxSize);
        keptPath = capped.filePath;
        fileName = path.basename(keptPath);
        if (capped.changed) {
          note = `${capped.width}x${capped.height}, ${formatBytes(size)} -> ${formatBytes(capped.after)}`;
        }
        bytes += capped.after;
      } else {
        bytes += size;
      }

      // Judge the pixels before keeping it: a name-based filter cannot see
      // that "Acolytes sandals dyed.jpg" is a 45-cell equipment grid.
      const background = await measureBackground(keptPath);
      if (background.nearBlack > NEAR_BLACK_REJECT) {
        fs.rmSync(keptPath, { force: true });
        console.log(
          `${progress} Discarded ${fileName} (${Math.round(background.nearBlack * 100)}% black backdrop — a chart or sprite sheet)`
        );
        junk++;
        continue;
      }

      downloaded++;
      record(fileName);
      console.log(`${progress} Downloaded ${fileName} (${note})`);
      if (background.dominant > DOMINANT_WARN) {
        console.log(
          `        Note: ${Math.round(background.dominant * 100)}% of this one is a single flat colour — ` +
            'a cut-out render, or possibly a composite. Worth a glance.'
        );
      }
    } catch (err) {
      console.error(`${progress} Failed ${fileName}: ${err.message}`);
      try {
        fs.rmSync(keptPath, { force: true });
      } catch (cleanupErr) {
        console.error(`        Could not remove the partial file: ${cleanupErr.message}`);
      }
      failed++;
      continue;
    }

    if (options.captions) {
      try {
        const caption = [character, options.caption].filter(Boolean).join(', ');
        fs.writeFileSync(path.join(datasetDir, `${stem}.txt`), `${caption}\n`, 'utf8');
      } catch (err) {
        console.error(`        Could not write the caption for ${fileName}: ${err.message}`);
        failed++;
      }
    }

    await sleep(REQUEST_DELAY_MS / 2);
  }

  let manifestTotal = 0;
  try {
    manifestTotal = writeManifest(datasetDir, { character, wiki: wiki.name, page }, entries);
  } catch (err) {
    console.error(`Error: could not write the manifest: ${err.message}`);
    process.exitCode = 1;
  }

  // ---- Summary -------------------------------------------------------------
  console.log('');
  console.log('Summary:');
  console.log(`  Character:        ${character}`);
  console.log(`  Downloaded:       ${downloaded} (${formatBytes(bytes)})`);
  console.log(`  Already present:  ${skippedExisting}`);
  if (repaired > 0) {
    console.log(`  Repaired:         ${repaired} bad file(s) replaced`);
  }
  if (junk > 0) {
    console.log(`  Discarded:        ${junk} chart/sprite-sheet image(s)`);
  }
  if (options.crop) {
    console.log(`  Cropped:          ${cropCount} (extra face removed)`);
  }
  console.log(`  Failed:           ${failed}`);
  console.log(`  Captions:         ${options.captions ? `"${[character, options.caption].filter(Boolean).join(', ')}"` : 'disabled'}`);
  console.log(
    `  Size cap:         ${options.maxSize > 0 ? `${options.maxSize}px short side, JPEG q${JPEG_QUALITY}` : 'off (wiki originals)'}`
  );
  console.log(`  Dataset total:    ${manifestTotal} image(s) in "${datasetDir}"`);

  if (failed > 0) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(`Fatal error: ${err.message}`);
  process.exitCode = 1;
});
