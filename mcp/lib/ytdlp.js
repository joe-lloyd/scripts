/**
 * Finding yt-dlp, and using it to turn a search phrase into real URLs.
 *
 * get-audio downloads yt-dlp into get-audio/tools on first run, so by the time
 * anyone wants a search there is usually a copy sitting there already. The
 * search itself is deliberately a separate step from the download: resolving
 * "Shadowheart voice lines" to five concrete URLs and reporting them back means
 * a wrong pick is visible in the result, rather than showing up later as an
 * audio file of the wrong character.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO_ROOT = path.join(__dirname, '..', '..');
const EXE = process.platform === 'win32' ? '.exe' : '';

const CANDIDATES = [
  () => process.env.YTDLP_PATH,
  () => path.join(REPO_ROOT, 'get-audio', 'tools', `yt-dlp${EXE}`),
  () => path.join(REPO_ROOT, 'tools', `yt-dlp${EXE}`),
  () => `yt-dlp${EXE}`, // whatever is on PATH
];

let cached;

function runsOk(file) {
  const result = spawnSync(file, ['--version'], { stdio: 'ignore', windowsHide: true });
  return !result.error && result.status === 0;
}

/** The first yt-dlp that actually executes, or null. */
function resolve() {
  if (cached !== undefined) return cached;
  for (const candidate of CANDIDATES) {
    const file = candidate();
    if (!file) continue;
    // A bare name has to be probed; a path can be rejected on sight if absent.
    if (path.isAbsolute(file) && !fs.existsSync(file)) continue;
    if (runsOk(file)) {
      cached = file;
      return cached;
    }
  }
  cached = null;
  return cached;
}

/**
 * Search YouTube and return the top results as { title, url, duration }.
 * --flat-playlist keeps this to one request rather than one per hit.
 */
function search(query, count = 5) {
  const binary = resolve();
  if (!binary) {
    throw new Error(
      'yt-dlp was not found. Run get-audio once (it fetches yt-dlp into get-audio/tools), ' +
        'install yt-dlp on PATH, or set YTDLP_PATH.'
    );
  }

  const result = spawnSync(
    binary,
    [
      `ytsearch${count}:${query}`,
      '--flat-playlist',
      '--no-warnings',
      // Windows hands child stdout back in the OEM codepage, which mangles any
      // non-ASCII character in a video title. Both sides have to agree on UTF-8.
      '--encoding',
      'utf-8',
      '--print',
      '%(title)s\t%(webpage_url)s\t%(duration)s',
    ],
    {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 90_000,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    }
  );

  if (result.error) throw new Error(`yt-dlp search failed: ${result.error.message}`);
  if (result.status !== 0) {
    const detail = (result.stderr || '').trim().split('\n').slice(-3).join(' ');
    throw new Error(`yt-dlp search failed (exit ${result.status})${detail ? `: ${detail}` : ''}`);
  }

  return (result.stdout || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [title, url, duration] = line.split('\t');
      return { title, url, duration: Number(duration) || null };
    })
    .filter((hit) => hit.url && hit.url.startsWith('http'));
}

module.exports = { resolve, search };
