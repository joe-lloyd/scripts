/**
 * Shared cross-platform ffmpeg / ffprobe discovery.
 *
 * Every tool in this repo that shells out to ffmpeg goes through here so they
 * all find the same binary and print the same install guidance.
 *
 * Search order (first one that actually runs wins):
 *   1. $FFMPEG_PATH / $FFPROBE_PATH   - explicit override, always wins
 *   2. PATH                           - a system install is preferred when present
 *   3. <repo>/tools/                  - shared folder, searched recursively
 *   4. ffmpeg-static / ffprobe-static - npm packages, installed by `npm install`
 *   5. get-audio/tools/, ~/Downloads/ADStool/tools/ffmpeg - older local caches
 *   6. Common install dirs per platform (homebrew, snap, winget, chocolatey, ...)
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO_ROOT = path.join(__dirname, '..');
const TOOLS_DIR = path.join(REPO_ROOT, 'tools');
const EXE_SUFFIX = process.platform === 'win32' ? '.exe' : '';

// Resolution is stable for the life of the process, so only probe once.
const cache = new Map();

function exeName(tool) {
  return tool + EXE_SUFFIX;
}

/** A candidate is only accepted if it actually executes. */
function runsOk(file) {
  const result = spawnSync(file, ['-version'], { stdio: 'ignore', windowsHide: true });
  return !result.error && result.status === 0;
}

/** Find a binary inside a directory tree (static builds nest it under bin/). */
function findInTree(dir, wantedName, depth = 4) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return null; // missing or unreadable - just not a hit
  }

  const dirs = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isFile() && entry.name.toLowerCase() === wantedName.toLowerCase()) {
      return full;
    }
    if (entry.isDirectory()) {
      dirs.push(full);
    }
  }

  if (depth > 0) {
    for (const sub of dirs) {
      const found = findInTree(sub, wantedName, depth - 1);
      if (found) return found;
    }
  }
  return null;
}

/** Path exported by the optional ffmpeg-static / ffprobe-static packages. */
function staticPackagePath(tool) {
  try {
    const mod = require(`${tool}-static`);
    // ffmpeg-static exports the path directly, ffprobe-static exports { path }
    const resolved = typeof mod === 'string' ? mod : mod && mod.path;
    return typeof resolved === 'string' && resolved.length > 0 ? resolved : null;
  } catch {
    return null; // optional dependency not installed
  }
}

function commonInstallDirs() {
  const home = os.homedir();
  if (process.platform === 'win32') {
    return [
      path.join(process.env.ProgramFiles || 'C:\\Program Files', 'ffmpeg', 'bin'),
      'C:\\ffmpeg\\bin',
      path.join(process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'Microsoft', 'WinGet', 'Links'),
      'C:\\ProgramData\\chocolatey\\bin',
    ];
  }
  if (process.platform === 'darwin') {
    return [
      '/opt/homebrew/bin', // Apple Silicon homebrew
      '/usr/local/bin', // Intel homebrew
      '/opt/local/bin', // MacPorts
      path.join(home, '.local', 'bin'),
    ];
  }
  return [
    '/usr/bin',
    '/usr/local/bin',
    '/snap/bin',
    path.join(home, '.local', 'bin'),
    path.join(home, 'bin'),
  ];
}

/** Ordered candidates, each { file, source }. Lazily evaluated. */
function* candidates(tool) {
  const envVar = tool === 'ffprobe' ? 'FFPROBE_PATH' : 'FFMPEG_PATH';
  const override = process.env[envVar];
  if (override) {
    yield { file: override, source: `$${envVar}` };
  }

  yield { file: tool, source: 'PATH' };

  const shared = findInTree(TOOLS_DIR, exeName(tool));
  if (shared) {
    yield { file: shared, source: 'tools/ (npm run setup:ffmpeg)' };
  }

  const fromPackage = staticPackagePath(tool);
  if (fromPackage) {
    yield { file: fromPackage, source: `${tool}-static npm package` };
  }

  const legacyDirs = [
    path.join(REPO_ROOT, 'get-audio', 'tools'),
    path.join(os.homedir(), 'Downloads', 'ADStool', 'tools', 'ffmpeg'),
  ];
  for (const dir of legacyDirs) {
    const hit = findInTree(dir, exeName(tool));
    if (hit) {
      yield { file: hit, source: dir };
    }
  }

  for (const dir of commonInstallDirs()) {
    const direct = path.join(dir, exeName(tool));
    if (fs.existsSync(direct)) {
      yield { file: direct, source: dir };
    }
  }
}

/**
 * Locate a tool. Returns { path, source } or null.
 * @param {'ffmpeg'|'ffprobe'} tool
 */
function resolve(tool) {
  if (cache.has(tool)) {
    return cache.get(tool);
  }
  let found = null;
  for (const candidate of candidates(tool)) {
    if (runsOk(candidate.file)) {
      found = { path: candidate.file, source: candidate.source };
      break;
    }
  }
  cache.set(tool, found);
  return found;
}

const resolveFfmpeg = () => resolve('ffmpeg');
const resolveFfprobe = () => resolve('ffprobe');

/** Copy-paste install instructions for the current platform. */
function installHelp() {
  const lines = [
    'ffmpeg was not found.',
    '',
    'Easiest fix - grab a private copy for this repo (no admin rights needed):',
    '  npm run setup:ffmpeg',
    '',
    'Or install it system-wide:',
  ];
  if (process.platform === 'win32') {
    lines.push('  winget install Gyan.FFmpeg', '  choco install ffmpeg');
  } else if (process.platform === 'darwin') {
    lines.push('  brew install ffmpeg', '  port install ffmpeg');
  } else {
    lines.push(
      '  sudo apt install ffmpeg      (Debian/Ubuntu)',
      '  sudo dnf install ffmpeg      (Fedora)',
      '  sudo pacman -S ffmpeg        (Arch)',
      '  sudo snap install ffmpeg'
    );
  }
  lines.push('', 'Already have it somewhere unusual? Point at it directly:');
  lines.push(
    process.platform === 'win32'
      ? '  set FFMPEG_PATH=C:\\path\\to\\ffmpeg.exe'
      : '  export FFMPEG_PATH=/path/to/ffmpeg'
  );
  return lines.join('\n');
}

/**
 * Resolve ffmpeg or exit(1) with install guidance. For tools that cannot
 * do anything useful without it.
 * @returns {string} path to a working ffmpeg
 */
function requireFfmpeg() {
  const found = resolveFfmpeg();
  if (!found) {
    console.error(installHelp());
    process.exit(1);
  }
  return found.path;
}

/** How a resolved tool should be described in logs. */
function describe(found) {
  if (!found) return 'not found';
  return found.source === 'PATH' ? `${found.path} (on PATH)` : `${found.path} [${found.source}]`;
}

module.exports = {
  REPO_ROOT,
  TOOLS_DIR,
  exeName,
  resolveFfmpeg,
  resolveFfprobe,
  requireFfmpeg,
  installHelp,
  describe,
};
