/**
 * scrape-booru — build a character image dataset (for LoRA training) from Gelbooru.
 *
 * Usage:
 *   node scrape-booru/index.js                                   (interactive)
 *   node scrape-booru/index.js --tag hatsune_miku --limit 60
 *   node scrape-booru/index.js --tag hatsune_miku --rating any --sort newest
 *
 * Interactive mode asks which character you want, searches Gelbooru's tag list
 * so you can pick the exact tag (spelling and post counts both matter), then
 * downloads the matching posts into out/<character>/ with one .txt caption file
 * per image — the layout kohya_ss / sd-scripts expect.
 *
 * Only still images are kept (png/jpg/jpeg/webp); video and animated posts are
 * skipped, and every download is verified against the image magic bytes before
 * it is written. Files are named after their post id, so rerunning tops a
 * dataset up instead of starting it over.
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
  cropToMainCharacter,
} = require('../lib/dataset-image');

const OUT_DIR = path.join(__dirname, 'out');

const BASE_URL = 'https://gelbooru.com/index.php';
const USER_AGENT = 'scrape-booru/1.0 (personal dataset tool; node)';

// Gelbooru's image hosts answer a refererless request with an HTML "Image View"
// page — and a 200 status, so nothing looks wrong until you open the file.
const REFERER = 'https://gelbooru.com/';

// Gelbooru caps a post query at 100 results, so larger datasets page through
// with &pid=. MAX_PAGES stops a too-narrow query from paging forever.
const PAGE_SIZE = 100;
const MAX_PAGES = 25;

const DOWNLOAD_DELAY_MS = 250;

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp']);

// Booru originals run to several thousand pixels a side, which trainers throw
// away and upload endpoints reject (HTTP 413). Every kept image is capped at
// MAX_SIZE on its short side and 1.5x that on its long side, then re-encoded as
// JPEG — roughly what a trainer actually sees.
const DEFAULT_MAX_SIZE = 1024;

// Tags appended to every query: one character per image, no comic pages.
const DEFAULT_EXTRA_TAGS = 'solo -comic';

const RATING_PRESETS = [
  { key: 'general', label: 'General only (safest, cleanest training data)', tags: 'rating:general' },
  { key: 'safe', label: 'General + sensitive (no questionable/explicit)', tags: '-rating:questionable -rating:explicit' },
  { key: 'any', label: 'Any rating', tags: '' },
];

// Gelbooru is fan art by default. These narrow it towards how the character
// actually looks in game — thin for less popular characters, so the tool says
// how many posts each one leaves.
const STYLE_PRESETS = [
  { key: 'any', label: 'Any style (mostly fan art)', tags: '' },
  { key: 'official', label: 'Official art and game CG only', tags: '{official_art ~ game_cg ~ screenshot}' },
  { key: '3d', label: '3D renders and screenshots (closest to the in-game model)', tags: '{3d ~ screenshot}' },
  { key: 'real', label: '3D or official, no anime styling', tags: '{3d ~ official_art ~ game_cg ~ screenshot}' },
];

const SORT_PRESETS = [
  { key: 'score', label: 'Highest score first (best quality)', tags: 'sort:score:desc' },
  { key: 'newest', label: 'Newest first', tags: '' },
];

const USAGE =
  'Usage: node scrape-booru/index.js [--tag <name>] [--limit <n>] ' +
  '[--rating general|safe|any] [--style any|official|3d|real] [--sort score|newest] [--extra "<tags>"] ' +
  '[--out <dir>] [--max-size <px>] [--no-captions] [--crop] [--resize-only]';

// Gelbooru's post API answers 401 without credentials (its tag autocomplete
// still works anonymously). Keys are free: Account Options -> API Access
// Credentials. Env vars win; otherwise they live in credentials.json, which
// this tool offers to write on first run.
const CREDENTIALS_PATH = path.join(__dirname, 'credentials.json');
let credentials = { apiKey: '', userId: '' };

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

/** Gelbooru tags are underscore-separated; accept "hatsune miku" too. */
function normalizeTag(input) {
  return input.trim().toLowerCase().replace(/\s+/g, '_');
}

/** Turn a tag into a folder name that is safe on every platform. */
function slugify(tag) {
  return tag.replace(/[^a-z0-9_-]+/gi, '_').replace(/^_+|_+$/g, '') || 'dataset';
}

// ---- Credentials ------------------------------------------------------------

const CREDENTIALS_HELP = [
  'Gelbooru needs free API credentials for post searches:',
  '  1. Log in at https://gelbooru.com',
  '  2. Account Options -> API Access Credentials',
  '  3. Copy the "&api_key=...&user_id=..." string it shows you',
];

/** Env vars first, then credentials.json next to this script. */
function loadCredentials() {
  const envKey = process.env.GELBOORU_API_KEY || '';
  const envUser = process.env.GELBOORU_USER_ID || '';
  if (envKey && envUser) {
    return { apiKey: envKey, userId: envUser, source: 'environment' };
  }

  if (fs.existsSync(CREDENTIALS_PATH)) {
    try {
      const saved = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf8'));
      if (saved.api_key && saved.user_id) {
        return { apiKey: String(saved.api_key), userId: String(saved.user_id), source: 'credentials.json' };
      }
    } catch (err) {
      console.warn(`  Warning: could not read credentials.json (${err.message}) — ignoring it.`);
    }
  }

  return { apiKey: '', userId: '', source: null };
}

/** Accept a bare key, or the whole "&api_key=...&user_id=..." string. */
function parseCredentialInput(text) {
  const trimmed = text.trim();
  const keyMatch = trimmed.match(/api_key=([^&\s]+)/i);
  const userMatch = trimmed.match(/user_id=([^&\s]+)/i);
  return {
    apiKey: keyMatch ? keyMatch[1] : /[=&\s]/.test(trimmed) ? '' : trimmed,
    userId: userMatch ? userMatch[1] : '',
  };
}

// ---- Gelbooru API -----------------------------------------------------------

async function apiRequest(params, label) {
  const url = new URL(BASE_URL);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, String(value));
  }
  if (credentials.apiKey && credentials.userId) {
    url.searchParams.set('api_key', credentials.apiKey);
    url.searchParams.set('user_id', credentials.userId);
  }

  const response = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
  });
  if (response.status === 401 || response.status === 403) {
    throw new Error(
      `${label} was refused (HTTP ${response.status}). ` +
        (credentials.source
          ? `The API credentials from ${credentials.source} look wrong — replace them and rerun.`
          : 'Gelbooru requires API credentials for this — see the README.')
    );
  }
  if (!response.ok) {
    throw new Error(`${label} failed: HTTP ${response.status} ${response.statusText}`);
  }

  const body = (await response.text()).trim();
  if (body === '') return null;

  try {
    return JSON.parse(body);
  } catch (err) {
    const preview = body.slice(0, 120).replace(/\s+/g, ' ');
    throw new Error(
      `${label} returned a non-JSON response ("${preview}"). Gelbooru is probably rate-limiting ` +
        'this machine — wait a few minutes and try again.'
    );
  }
}

/**
 * Look up tags matching a search term, newest API first.
 * Returns [{ name, count, category }], most-used tag first.
 */
async function searchTags(term) {
  const search = normalizeTag(term);

  try {
    const suggestions = await apiRequest(
      { page: 'autocomplete2', term: search, type: 'tag_query', limit: 15 },
      'Tag search'
    );
    if (Array.isArray(suggestions) && suggestions.length > 0) {
      return suggestions
        .filter((item) => item && item.value)
        .map((item) => ({
          name: item.value,
          count: Number(item.post_count) || 0,
          category: item.category || 'tag',
        }));
    }
  } catch (err) {
    console.log(`  Autocomplete unavailable (${err.message}) — falling back to the tag index.`);
  }

  const data = await apiRequest(
    {
      page: 'dapi',
      s: 'tag',
      q: 'index',
      json: 1,
      limit: 20,
      orderby: 'count',
      name_pattern: `%${search}%`,
    },
    'Tag search'
  );

  const tags = data && Array.isArray(data.tag) ? data.tag : [];
  return tags
    .map((tag) => ({
      name: tag.name,
      count: Number(tag.count) || 0,
      // Gelbooru tag types: 4 is character, 3 copyright, 1 artist.
      category: tag.type === 4 ? 'character' : tag.type === 3 ? 'copyright' : 'tag',
    }))
    .sort((a, b) => b.count - a.count);
}

/** Fetch up to `wanted` usable image posts for a tag query, paging as needed. */
async function fetchPosts(tagQuery, wanted) {
  const collected = [];
  const seenIds = new Set();
  let skippedNonImage = 0;

  for (let page = 0; page < MAX_PAGES && collected.length < wanted; page++) {
    const data = await apiRequest(
      { page: 'dapi', s: 'post', q: 'index', json: 1, limit: PAGE_SIZE, pid: page, tags: tagQuery },
      'Post search'
    );

    // Gelbooru omits "post" entirely when nothing matches, and can return a
    // bare object rather than an array for a single hit.
    const raw = data && data.post ? data.post : [];
    const posts = Array.isArray(raw) ? raw : [raw];
    if (posts.length === 0) break;

    for (const post of posts) {
      if (!post || !post.file_url || seenIds.has(post.id)) continue;
      seenIds.add(post.id);

      const ext = path.extname(new URL(post.file_url).pathname).toLowerCase();
      if (!IMAGE_EXTENSIONS.has(ext)) {
        skippedNonImage++;
        continue;
      }

      collected.push({ ...post, ext });
      if (collected.length >= wanted) break;
    }

    if (posts.length < PAGE_SIZE) break;
    await sleep(DOWNLOAD_DELAY_MS);
  }

  return { posts: collected, skippedNonImage };
}

// ---- Resizing ---------------------------------------------------------------

/** Every image file in a dataset folder, ignoring captions and the manifest. */
function listImages(dir) {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase()))
    .map((entry) => entry.name)
    .sort();
}

/**
 * Cap every image in an existing dataset folder — for sets downloaded before
 * the cap existed, or when a smaller --max-size is wanted after the fact.
 */
async function resizeDataset(dir, maxSize, crop) {
  const files = listImages(dir);
  const totals = { files: files.length, resized: 0, cropped: 0, skipped: 0, failed: 0, before: 0, after: 0 };

  console.log('');
  console.log(`${path.basename(dir)}: ${files.length} image(s)`);

  for (const name of files) {
    let filePath = path.join(dir, name);
    let label = name;
    try {
      if (crop) {
        const before = fs.statSync(filePath).size;
        const cropped = await cropToMainCharacter(filePath);
        if (cropped.changed) {
          totals.cropped++;
          console.log(`  ${label}: cropped out a second face (${cropped.width}x${cropped.height})`);
          filePath = cropped.filePath;
          label = path.basename(filePath);
        }
      }

      if (maxSize > 0) {
        const result = await capImage(filePath, maxSize);
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

  return totals;
}

/**
 * Point a folder's manifest back at the files that are really there — capping
 * renames .png to .jpg — and drop entries whose image has gone.
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

  const byStem = new Map(listImages(dir).map((name) => [path.parse(name).name, name]));
  const entries = (manifest.images || [])
    .map((entry) => {
      const current = byStem.get(String(entry.id));
      return current ? { ...entry, file: current } : null;
    })
    .filter(Boolean);

  writeManifest(dir, manifest.tag, entries);
}

/**
 * Build a kohya-style caption: comma-separated, underscores turned into
 * spaces, with the character tag first so it acts as the trigger word.
 */
function buildCaption(post, characterTag) {
  const tags = String(post.tags || '')
    .split(/\s+/)
    .filter(Boolean);
  const ordered = [characterTag, ...tags.filter((tag) => tag !== characterTag)];
  return ordered.map((tag) => tag.replace(/_/g, ' ')).join(', ');
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

/**
 * Ask for API credentials and save them to credentials.json (gitignored) so
 * this only ever happens once per machine.
 */
async function setUpCredentials(rl) {
  console.log('');
  CREDENTIALS_HELP.forEach((line) => console.log(line));
  console.log('');

  const pasted = parseCredentialInput(await askText(rl, 'Paste it here'));
  const apiKey = pasted.apiKey || (await askText(rl, 'API key'));
  const userId = pasted.userId || (await askText(rl, 'User id'));

  credentials = { apiKey, userId, source: 'credentials.json' };

  try {
    fs.writeFileSync(
      CREDENTIALS_PATH,
      `${JSON.stringify({ api_key: apiKey, user_id: userId }, null, 2)}\n`,
      'utf8'
    );
    console.log(`Saved to "${CREDENTIALS_PATH}" — it is gitignored, and you will not be asked again.`);
  } catch (err) {
    console.warn(`  Warning: could not save credentials (${err.message}) — using them for this run only.`);
  }
}

/** Search-and-pick loop: keeps asking until the user settles on a tag. */
async function chooseCharacterTag(rl) {
  while (true) {
    const term = await askText(rl, 'Which character do you want images of?');

    console.log(`Searching Gelbooru tags for "${normalizeTag(term)}"...`);
    let matches = [];
    try {
      matches = await searchTags(term);
    } catch (err) {
      console.error(`  Tag search failed: ${err.message}`);
    }

    if (matches.length === 0) {
      console.log('  No tags matched. Try another spelling (e.g. "makima", "2b_(nier)").');
      continue;
    }

    const options = matches.slice(0, 12).map((match) => ({
      value: match.name,
      label: `${match.name}  (${match.count.toLocaleString()} posts${
        match.category && match.category !== 'tag' ? `, ${match.category}` : ''
      })`,
    }));
    options.push({ value: null, label: 'None of these — search again' });

    const picked = await askChoice(rl, 'Matching tags:', options, 0);
    if (picked.value) return picked.value;
  }
}

// ---- Arguments --------------------------------------------------------------

function parseArgs(argv) {
  const options = {
    tag: null,
    limit: null,
    rating: null,
    style: null,
    sort: null,
    extra: null,
    out: null,
    captions: true,
    maxSize: DEFAULT_MAX_SIZE,
    crop: false,
    resizeOnly: false,
  };

  const valueFlags = new Set(['--tag', '--limit', '--rating', '--style', '--sort', '--extra', '--out', '--max-size']);

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (valueFlags.has(arg)) {
      // An empty value is meaningful (--extra "" clears the default filters);
      // a following flag means the value was simply forgotten.
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) {
        console.error(`Error: ${arg} needs a value. ${USAGE}`);
        process.exit(1);
      }
      i++;
      if (arg === '--tag') options.tag = normalizeTag(value);
      else if (arg === '--limit') options.limit = Number(value);
      else if (arg === '--rating') options.rating = value.toLowerCase();
      else if (arg === '--style') options.style = value.toLowerCase();
      else if (arg === '--sort') options.sort = value.toLowerCase();
      else if (arg === '--extra') options.extra = value;
      else if (arg === '--max-size') options.maxSize = Number(value);
      else options.out = value;
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

  if (options.tag !== null && options.tag === '') {
    console.error('Error: --tag cannot be empty.');
    process.exit(1);
  }
  if (
    options.limit !== null &&
    (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > 1000)
  ) {
    console.error('Error: --limit must be a whole number between 1 and 1000.');
    process.exit(1);
  }
  if (options.rating && !RATING_PRESETS.some((preset) => preset.key === options.rating)) {
    console.error(`Error: unknown --rating "${options.rating}". Use general, safe or any.`);
    process.exit(1);
  }
  if (options.style && !STYLE_PRESETS.some((preset) => preset.key === options.style)) {
    console.error(`Error: unknown --style "${options.style}". Use any, official, 3d or real.`);
    process.exit(1);
  }
  if (options.sort && !SORT_PRESETS.some((preset) => preset.key === options.sort)) {
    console.error(`Error: unknown --sort "${options.sort}". Use score or newest.`);
    process.exit(1);
  }
  // 0 keeps the booru original; anything smaller than 256 is not worth training on.
  if (!Number.isInteger(options.maxSize) || options.maxSize < 0 || (options.maxSize > 0 && options.maxSize < 256) || options.maxSize > 4096) {
    console.error('Error: --max-size must be 0 (no cap) or a whole number between 256 and 4096.');
    process.exit(1);
  }

  return options;
}

/** Merge this run's posts into out/<character>/manifest.json, keyed by post id. */
function writeManifest(datasetDir, tag, entries) {
  const manifestPath = path.join(datasetDir, 'manifest.json');
  const byId = new Map();

  if (fs.existsSync(manifestPath)) {
    try {
      const previous = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      for (const entry of previous.images || []) byId.set(entry.id, entry);
    } catch (err) {
      console.warn(`  Warning: could not read the existing manifest (${err.message}) — rewriting it.`);
    }
  }

  for (const entry of entries) byId.set(entry.id, entry);

  // Drop entries whose image has since been deleted from the folder — pruning a
  // dataset by hand should leave the manifest honest.
  for (const [id, entry] of byId) {
    if (!fs.existsSync(path.join(datasetDir, entry.file))) byId.delete(id);
  }

  const manifest = {
    tag,
    source: 'gelbooru.com',
    updated: new Date().toISOString(),
    images: [...byId.values()].sort((a, b) => b.score - a.score),
  };
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return manifest.images.length;
}

/**
 * --resize-only: cap the images in datasets that are already on disk. Takes no
 * network and no credentials. Defaults to every dataset folder in out/;
 * --out <dir> narrows it to one.
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
    const result = await resizeDataset(dir, options.maxSize, options.crop);
    for (const key of Object.keys(totals)) totals[key] += result[key];
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

async function main() {
  const options = parseArgs(process.argv.slice(2));

  ensureDir(OUT_DIR);
  ensureGitkeep(OUT_DIR);

  console.log('');
  console.log('scrape-booru — character dataset builder (source: gelbooru.com)');
  console.log('--------------------------------------------------------------');

  // Resizing what is already on disk asks nothing and downloads nothing.
  if (options.resizeOnly) {
    await runResizeOnly(options);
    return;
  }

  const interactive = options.tag === null;
  if (interactive && !process.stdin.isTTY) {
    console.error(`Error: no terminal to prompt on — pass --tag <name> instead. ${USAGE}`);
    process.exit(1);
  }

  credentials = loadCredentials();
  if (!credentials.apiKey || !credentials.userId) {
    if (!process.stdin.isTTY) {
      console.error('');
      CREDENTIALS_HELP.forEach((line) => console.error(line));
      console.error('  4. Set GELBOORU_API_KEY and GELBOORU_USER_ID, or run this tool interactively once to save them.');
      process.exit(1);
    }
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    try {
      await setUpCredentials(rl);
    } finally {
      rl.close();
    }
  }

  let tag = options.tag;
  let limit = options.limit;
  let rating = RATING_PRESETS.find((preset) => preset.key === options.rating) || RATING_PRESETS[0];
  let style = STYLE_PRESETS.find((preset) => preset.key === options.style) || STYLE_PRESETS[0];
  let sort = SORT_PRESETS.find((preset) => preset.key === options.sort) || SORT_PRESETS[0];
  const extras = options.extra === null ? DEFAULT_EXTRA_TAGS : options.extra;

  if (interactive) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    try {
      tag = await chooseCharacterTag(rl);
      limit = await askNumber(rl, 'How many images?', 40, 1, 1000);
      rating = await askChoice(rl, 'Content rating:', RATING_PRESETS, 0);
      style = await askChoice(rl, 'Art style:', STYLE_PRESETS, 0);
      sort = await askChoice(rl, 'Pick posts by:', SORT_PRESETS, 0);

      console.log('');
      console.log(`  Tag:     ${tag}`);
      console.log(`  Images:  ${limit}`);
      console.log(`  Filters: ${[extras, rating.tags, style.tags].filter(Boolean).join(' ') || '(none)'}`);
      console.log(`  Order:   ${sort.label}`);
      console.log('');
      if (!(await askYesNo(rl, 'Start downloading?'))) {
        console.log('Cancelled — nothing was downloaded.');
        return;
      }
    } finally {
      rl.close();
    }
  }

  if (limit === null) limit = 40;
  const tagQuery = [tag, extras, rating.tags, style.tags, sort.tags].filter(Boolean).join(' ').trim();

  const datasetDir = options.out
    ? path.resolve(process.cwd(), options.out)
    : path.join(OUT_DIR, slugify(tag));
  ensureDir(datasetDir);

  console.log('');
  console.log(`Query:  ${tagQuery}`);
  console.log(`Output: ${datasetDir}`);
  console.log(`Searching for up to ${limit} image(s)...`);

  const { posts, skippedNonImage } = await fetchPosts(tagQuery, limit);

  if (posts.length === 0) {
    console.log('');
    console.log('No images found for these tags. Try a broader query — drop the rating filter,');
    console.log('or pass --extra "" to clear the default "solo -comic" filters.');
    return;
  }
  if (posts.length < limit) {
    console.log(`Only ${posts.length} post(s) matched — this tag combination is narrower than ${limit}.`);
  }

  // ---- Download ------------------------------------------------------------
  let downloaded = 0;
  let skippedExisting = 0;
  let repaired = 0;
  let cropCount = 0;
  let failed = 0;
  let bytes = 0;
  const entries = [];

  for (let i = 0; i < posts.length; i++) {
    const post = posts[i];
    let fileName = `${post.id}${post.ext}`;
    const filePath = path.join(datasetDir, fileName);
    const progress = `${String(i + 1).padStart(3, '0')}/${posts.length}`;

    // The manifest only ever describes files that are actually on disk, so a
    // failed download is logged but never recorded.
    const record = () =>
      entries.push({
        id: post.id,
        file: fileName,
        // fileName is whatever survived the cap (a .png may now be a .jpg).
        score: Number(post.score) || 0,
        rating: post.rating || 'unknown',
        post: `https://gelbooru.com/index.php?page=post&s=view&id=${post.id}`,
        file_url: post.file_url,
      });

    // A file already here is only trusted if it really is an image; anything
    // else (a truncated save, or an anti-hotlink page from an older run) is
    // replaced rather than skipped.
    const existingPath = findExisting(datasetDir, String(post.id), post.ext);
    if (existingPath) {
      fileName = path.basename(existingPath);
      if (fileLooksLikeImage(existingPath)) {
        console.log(`${progress} Skipped ${fileName} (already downloaded)`);
        skippedExisting++;
        record();
        continue;
      }
      console.log(`${progress} Replacing ${fileName} (on disk, but not a valid image)`);
      fs.rmSync(existingPath, { force: true });
      repaired++;
    }

    let keptPath = filePath;
    try {
      const size = await downloadImage(post.file_url, filePath, {
        headers: { 'User-Agent': USER_AGENT, Referer: REFERER, Accept: 'image/*' },
      });
      let note = formatBytes(size);

      if (options.crop) {
        const cropped = await cropToMainCharacter(filePath);
        if (cropped.changed) {
          cropCount++;
          note = `cropped to ${cropped.width}x${cropped.height}, ${note}`;
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

      downloaded++;
      record();
      console.log(`${progress} Downloaded ${fileName} (${note})`);
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
        fs.writeFileSync(
          path.join(datasetDir, `${post.id}.txt`),
          `${buildCaption(post, tag)}\n`,
          'utf8'
        );
      } catch (err) {
        console.error(`        Could not write the caption for ${fileName}: ${err.message}`);
        failed++;
      }
    }

    // Be a polite guest: one image at a time, with a short pause between.
    await sleep(DOWNLOAD_DELAY_MS);
  }

  let manifestTotal = 0;
  try {
    manifestTotal = writeManifest(datasetDir, tag, entries);
  } catch (err) {
    console.error(`Error: could not write the manifest: ${err.message}`);
    process.exitCode = 1;
  }

  // ---- Summary -------------------------------------------------------------
  console.log('');
  console.log('Summary:');
  console.log(`  Tag:              ${tag}`);
  console.log(`  Downloaded:       ${downloaded} (${formatBytes(bytes)})`);
  console.log(`  Already present:  ${skippedExisting}`);
  if (repaired > 0) {
    console.log(`  Repaired:         ${repaired} bad file(s) replaced`);
  }
  console.log(`  Failed:           ${failed}`);
  if (skippedNonImage > 0) {
    console.log(`  Non-image posts:  ${skippedNonImage} skipped (video/animated)`);
  }
  if (options.crop) {
    console.log(`  Cropped:          ${cropCount} (extra face removed)`);
  }
  console.log(`  Captions:         ${options.captions ? 'one .txt per image' : 'disabled'}`);
  console.log(
    `  Size cap:         ${
      options.maxSize > 0 ? `${options.maxSize}px short side, JPEG q${JPEG_QUALITY}` : 'off (booru originals)'
    }`
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
