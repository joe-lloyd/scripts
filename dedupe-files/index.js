/**
 * dedupe-files — find (and optionally relocate) duplicate files by content.
 *
 * Usage:
 *   node dedupe-files/index.js [targetDir] [--move]
 *
 * Scans a directory tree recursively, groups files by size, then confirms
 * duplicates with a streamed SHA-256 hash. Read-only by default; with
 * --move the redundant copies are relocated into out/duplicates/ — nothing
 * is ever deleted.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT_DIR = __dirname;
const IN_DIR = path.join(ROOT_DIR, 'in');
const OUT_DIR = path.join(ROOT_DIR, 'out');
const REPORT_PATH = path.join(OUT_DIR, 'dedupe-report.txt');
const DUPLICATES_DIR = path.join(OUT_DIR, 'duplicates');

const SKIP_DIR_NAMES = new Set(['node_modules', '.git', 'archive', 'temp']);
const SKIP_FILE_NAMES = new Set(['.gitkeep']);
const HASH_PREVIEW = 12;

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
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  return i === 0 ? `${value} B` : `${value.toFixed(2)} ${units[i]}`;
}

/**
 * Recursively collect { path, size } records for every regular file.
 * Skips .gitkeep files, symlinks, the skip-listed directory names, and the
 * tool's own out/ directory (so a scan never picks up its own report).
 */
function collectFiles(dir, files, warnings) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    console.warn(`  Warning: cannot read directory "${dir}" (${err.message}) — skipping.`);
    warnings.count++;
    return;
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (fullPath === OUT_DIR) continue;
    if (entry.isSymbolicLink()) continue;

    if (entry.isDirectory()) {
      if (SKIP_DIR_NAMES.has(entry.name.toLowerCase())) continue;
      collectFiles(fullPath, files, warnings);
    } else if (entry.isFile()) {
      if (SKIP_FILE_NAMES.has(entry.name)) continue;
      try {
        const stats = fs.statSync(fullPath);
        files.push({ path: fullPath, size: stats.size });
      } catch (err) {
        console.warn(`  Warning: cannot stat "${fullPath}" (${err.message}) — excluded.`);
        warnings.count++;
      }
    }
  }
}

/** Stream a file through SHA-256 without loading it into memory. */
function hashFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('error', reject);
    hash.on('error', reject);
    hash.on('finish', () => resolve(hash.digest('hex')));
    stream.pipe(hash);
  });
}

/** Pick a destination path inside destDir, adding -1, -2, ... on name collisions. */
function uniqueDestination(destDir, fileName) {
  let candidate = path.join(destDir, fileName);
  if (!fs.existsSync(candidate)) return candidate;

  const { name, ext } = path.parse(fileName);
  let suffix = 1;
  while (fs.existsSync(candidate)) {
    candidate = path.join(destDir, `${name}-${suffix}${ext}`);
    suffix++;
  }
  return candidate;
}

/** Move a file; falls back to copy + remove-source when crossing devices. */
function moveFile(src, dest) {
  try {
    fs.renameSync(src, dest);
  } catch (err) {
    if (err.code === 'EXDEV') {
      fs.copyFileSync(src, dest, fs.constants.COPYFILE_EXCL);
      fs.unlinkSync(src);
    } else {
      throw err;
    }
  }
}

async function main() {
  // Keep the tool's own workspace ready.
  ensureDir(IN_DIR);
  ensureDir(OUT_DIR);
  ensureGitkeep(IN_DIR);
  ensureGitkeep(OUT_DIR);

  // ---- Arguments -----------------------------------------------------------
  const args = process.argv.slice(2);
  const moveMode = args.includes('--move');
  const positional = args.filter((a) => a !== '--move');

  const unknownFlags = positional.filter((a) => a.startsWith('--'));
  if (unknownFlags.length > 0) {
    console.error(`Error: unknown option ${unknownFlags.join(', ')}. Usage: node dedupe-files/index.js [targetDir] [--move]`);
    process.exit(1);
  }
  if (positional.length > 1) {
    console.error('Error: expected at most one target directory. Usage: node dedupe-files/index.js [targetDir] [--move]');
    process.exit(1);
  }

  const targetDir = positional[0] ? path.resolve(process.cwd(), positional[0]) : IN_DIR;
  let targetStats = null;
  try {
    targetStats = fs.statSync(targetDir);
  } catch (err) {
    targetStats = null;
  }
  if (!targetStats || !targetStats.isDirectory()) {
    console.error(`Error: target directory "${targetDir}" does not exist or is not a directory.`);
    process.exit(1);
  }

  console.log(`dedupe-files — target: "${targetDir}"${moveMode ? ' (--move enabled)' : ''}`);

  // ---- Phase 0: walk the tree ---------------------------------------------
  const files = [];
  const warnings = { count: 0 };
  collectFiles(targetDir, files, warnings);
  console.log(`Scanning ${files.length} files...`);

  // ---- Phase 1: group by size (only same-size files can be equal) ---------
  const bySize = new Map();
  for (const file of files) {
    if (!bySize.has(file.size)) bySize.set(file.size, []);
    bySize.get(file.size).push(file);
  }
  const candidateGroups = [...bySize.values()].filter((group) => group.length > 1);
  const candidateCount = candidateGroups.reduce((n, group) => n + group.length, 0);
  console.log(`Size check: ${candidateGroups.length} size group(s) with ${candidateCount} candidate file(s) need hashing.`);

  // ---- Phase 2: SHA-256 the candidates ------------------------------------
  const byHash = new Map();
  let hashedCount = 0;
  for (const group of candidateGroups) {
    for (const file of group) {
      try {
        const digest = await hashFile(file.path);
        if (!byHash.has(digest)) byHash.set(digest, { hash: digest, size: file.size, paths: [] });
        byHash.get(digest).paths.push(file.path);
      } catch (err) {
        console.warn(`  Warning: could not hash "${file.path}" (${err.message}) — excluded.`);
        warnings.count++;
      }
      hashedCount++;
      if (hashedCount % 100 === 0) {
        console.log(`  Hashed ${hashedCount}/${candidateCount} candidates...`);
      }
    }
  }

  const dupGroups = [...byHash.values()].filter((group) => group.paths.length > 1);
  for (const group of dupGroups) {
    // Keep-first rule: shortest path first, then alphabetical.
    group.paths.sort((a, b) => a.length - b.length || a.localeCompare(b));
    group.wasted = group.size * (group.paths.length - 1);
  }
  dupGroups.sort((a, b) => b.wasted - a.wasted || a.hash.localeCompare(b.hash));

  const redundantCount = dupGroups.reduce((n, group) => n + group.paths.length - 1, 0);
  const totalWasted = dupGroups.reduce((n, group) => n + group.wasted, 0);

  // ---- Report (console + out/dedupe-report.txt) ---------------------------
  const lines = [];
  lines.push('dedupe-files report');
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(`Target: ${targetDir}`);
  lines.push('');
  if (dupGroups.length === 0) {
    lines.push('No duplicate files found.');
  } else {
    dupGroups.forEach((group, i) => {
      lines.push(
        `Group ${i + 1}: ${group.hash.slice(0, HASH_PREVIEW)} | ${group.paths.length} files | ` +
          `${formatBytes(group.wasted)} wasted (${group.wasted} bytes)`
      );
      group.paths.forEach((p, j) => {
        lines.push(`  ${j === 0 ? '[keep]' : '[dup] '} ${p}`);
      });
      lines.push('');
    });
  }
  lines.push(
    `Totals: ${dupGroups.length} duplicate group(s), ${redundantCount} redundant file(s), ` +
      `${formatBytes(totalWasted)} wasted.`
  );

  console.log('');
  console.log(lines.join('\n'));
  console.log('');
  if (dupGroups.length === 0) {
    console.log('Great news — no duplicates found! Every file here is one of a kind.');
  }

  try {
    fs.writeFileSync(REPORT_PATH, lines.join('\n') + '\n', 'utf8');
    console.log(`Report written to "${REPORT_PATH}" (overwritten on every run).`);
  } catch (err) {
    console.error(`Error: could not write report file: ${err.message}`);
    process.exitCode = 1;
  }

  // ---- Optional: relocate duplicates (never deletes anything) -------------
  if (moveMode && dupGroups.length > 0) {
    console.log('');
    console.log(`Moving ${redundantCount} duplicate file(s) into "${DUPLICATES_DIR}"...`);
    let movedCount = 0;
    for (const group of dupGroups) {
      const groupDir = path.join(DUPLICATES_DIR, group.hash.slice(0, HASH_PREVIEW));
      try {
        ensureDir(groupDir);
      } catch (err) {
        console.error(`  Error: could not create "${groupDir}": ${err.message}`);
        process.exitCode = 1;
        continue;
      }
      for (const dupPath of group.paths.slice(1)) {
        try {
          const dest = uniqueDestination(groupDir, path.basename(dupPath));
          moveFile(dupPath, dest);
          console.log(`  Moved "${dupPath}" -> "${dest}"`);
          movedCount++;
        } catch (err) {
          console.error(`  Error: could not move "${dupPath}": ${err.message}`);
          process.exitCode = 1;
        }
      }
    }
    console.log(`Done — moved ${movedCount} file(s). Nothing was deleted.`);
    const insideToolFolder = targetDir === ROOT_DIR || targetDir.startsWith(ROOT_DIR + path.sep);
    if (!insideToolFolder) {
      console.log(`Duplicates from "${targetDir}" were moved to "${DUPLICATES_DIR}".`);
    }
  } else if (moveMode) {
    console.log('Nothing to move — no duplicates found.');
  }

  // ---- Summary -------------------------------------------------------------
  console.log('');
  console.log('Summary:');
  console.log(`  Files scanned:    ${files.length}`);
  console.log(`  Duplicate groups: ${dupGroups.length}`);
  console.log(`  Redundant files:  ${redundantCount}`);
  console.log(`  Wasted space:     ${formatBytes(totalWasted)}`);
  if (warnings.count > 0) {
    console.log(`  Warnings:         ${warnings.count} unreadable item(s) skipped.`);
  }
}

main().catch((err) => {
  console.error(`Fatal error: ${err.message}`);
  process.exitCode = 1;
});
