/**
 * Letting the in/ -> out/ tools work on files that live somewhere else.
 *
 * Most tools here resolve their folders from __dirname: compress-img always
 * reads compress-img/in and writes compress-img/out. That is exactly right for
 * the drop-files-in-a-folder workflow the repo is built around, and exactly
 * wrong for "compress the four screenshots in my other project", which is what
 * an agent in another repo actually asks for.
 *
 * Rather than rewrite nine scripts to take --in/--out, this stages around them:
 * whatever is already sitting in in/ and out/ is moved aside, the caller's
 * files are copied in, the script runs against the folders it expects, results
 * are moved to the caller's output directory, and the original contents are put
 * back. The scripts stay untouched and keep working by hand.
 *
 * Two calls to the same tool would tread on each other, so a tool holds a lock
 * for the length of a staged run and the second call queues behind it.
 */

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..', '..');
const DEFAULT_OUT_ROOT = path.join(__dirname, '..', 'out');

// A staged run is a whole batch — a long video compress can legitimately hold
// the lock for a while — but waiting forever would just hang the client.
const LOCK_TIMEOUT_MS = 10 * 60 * 1000;
const LOCK_POLL_MS = 250;

const KEEP_FILES = new Set(['.gitkeep', '.gitignore']);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Entries a tool's folder holds that are not repo furniture. */
function realEntries(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((name) => !KEEP_FILES.has(name));
}

/**
 * mkdir is atomic across processes, which is all a lock needs to be.
 * A lock older than the timeout belonged to a process that died holding it.
 */
async function acquireLock(toolDir) {
  const lockDir = path.join(toolDir, '.mcp-lock');
  const deadline = Date.now() + LOCK_TIMEOUT_MS;

  for (;;) {
    try {
      fs.mkdirSync(lockDir);
      fs.writeFileSync(path.join(lockDir, 'owner'), String(process.pid), 'utf8');
      return () => fs.rmSync(lockDir, { recursive: true, force: true });
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;

      const age = Date.now() - (fs.statSync(lockDir).mtimeMs || 0);
      if (age > LOCK_TIMEOUT_MS) {
        fs.rmSync(lockDir, { recursive: true, force: true });
        continue;
      }
      if (Date.now() > deadline) {
        throw new Error(
          `${path.basename(toolDir)} has been busy for over ${Math.round(LOCK_TIMEOUT_MS / 60000)} minutes. ` +
            'Another run is holding it; check job_list for what is still going.'
        );
      }
      await sleep(LOCK_POLL_MS);
    }
  }
}

/** Move every real entry out of `dir` into `stash`, remembering the names. */
async function stash(dir, stashDir) {
  const names = realEntries(dir);
  if (names.length === 0) return [];
  await fsp.mkdir(stashDir, { recursive: true });
  for (const name of names) {
    await fsp.rename(path.join(dir, name), path.join(stashDir, name));
  }
  return names;
}

async function unstash(stashDir, dir, names) {
  for (const name of names) {
    const from = path.join(stashDir, name);
    if (!fs.existsSync(from)) continue;
    await fsp.rm(path.join(dir, name), { recursive: true, force: true });
    await fsp.rename(from, path.join(dir, name));
  }
  await fsp.rm(stashDir, { recursive: true, force: true });
}

/** Expand the caller's `input` into a flat list of files to copy in. */
function collectInputs(input) {
  const paths = Array.isArray(input) ? input : [input];
  const files = [];

  for (const entry of paths) {
    const resolved = path.resolve(REPO_ROOT, entry);
    let stats;
    try {
      stats = fs.statSync(resolved);
    } catch (err) {
      throw new Error(`Input not found: ${entry}`);
    }

    if (stats.isDirectory()) {
      // One level only. A tool's in/ folder is flat, so a recursive walk would
      // silently flatten a tree and collide on same-named files.
      const names = fs.readdirSync(resolved, { withFileTypes: true });
      for (const dirent of names) {
        if (dirent.isFile() && !KEEP_FILES.has(dirent.name)) {
          files.push(path.join(resolved, dirent.name));
        }
      }
    } else {
      files.push(resolved);
    }
  }

  if (files.length === 0) {
    throw new Error('None of the given inputs held any files.');
  }
  return files;
}

function timestampDir(toolName) {
  const stamp = new Date().toISOString().replace(/[-:.]/g, '').slice(0, 15);
  return path.join(DEFAULT_OUT_ROOT, `${toolName}-${stamp}`);
}

/**
 * Run `body` with the tool's in/ holding the caller's files.
 *
 * With no input, nothing is staged and the tool runs against its own folders,
 * which is the by-hand workflow and stays available through MCP.
 */
async function withStagedIO(toolName, toolDir, options, body) {
  const { input = null, outputDir = null } = options;

  if (!input) {
    const before = new Set(realEntries(path.join(toolDir, 'out')));
    const record = await body();
    const after = realEntries(path.join(toolDir, 'out'));
    return {
      record,
      staged: false,
      inputDir: path.join(toolDir, 'in'),
      outputDir: path.join(toolDir, 'out'),
      outputs: after.filter((name) => !before.has(name)),
    };
  }

  const files = collectInputs(input);
  const inDir = path.join(toolDir, 'in');
  const outDir = path.join(toolDir, 'out');
  const destination = outputDir ? path.resolve(REPO_ROOT, outputDir) : timestampDir(toolName);

  const release = await acquireLock(toolDir);
  const stashRoot = path.join(toolDir, '.mcp-stash');
  let stashedIn = [];
  let stashedOut = [];

  try {
    await fsp.mkdir(inDir, { recursive: true });
    await fsp.mkdir(outDir, { recursive: true });
    stashedIn = await stash(inDir, path.join(stashRoot, 'in'));
    stashedOut = await stash(outDir, path.join(stashRoot, 'out'));

    for (const file of files) {
      await fsp.copyFile(file, path.join(inDir, path.basename(file)));
    }

    const record = await body();

    const produced = realEntries(outDir);
    await fsp.mkdir(destination, { recursive: true });
    for (const name of produced) {
      const target = path.join(destination, name);
      await fsp.rm(target, { recursive: true, force: true });
      await fsp.rename(path.join(outDir, name), target);
    }

    return {
      record,
      staged: true,
      inputCount: files.length,
      inputDir: inDir,
      outputDir: destination,
      outputs: produced,
    };
  } finally {
    // Put the folders back exactly as they were, whatever happened above.
    try {
      for (const name of realEntries(inDir)) {
        await fsp.rm(path.join(inDir, name), { recursive: true, force: true });
      }
      for (const name of realEntries(outDir)) {
        await fsp.rm(path.join(outDir, name), { recursive: true, force: true });
      }
      await unstash(path.join(stashRoot, 'in'), inDir, stashedIn);
      await unstash(path.join(stashRoot, 'out'), outDir, stashedOut);
      await fsp.rm(stashRoot, { recursive: true, force: true });
    } finally {
      release();
    }
  }
}

module.exports = { withStagedIO, collectInputs, realEntries, DEFAULT_OUT_ROOT, REPO_ROOT };
