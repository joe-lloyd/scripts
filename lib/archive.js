const fs = require('fs');
const path = require('path');

// Shared archive script for tool folders that follow the in/-out/ convention.
// Usage: node lib/archive.js <tool-folder-name>   (e.g. node lib/archive.js compress-img)
// Moves everything (including subdirectories) from <tool>/in and <tool>/out
// into <tool>/archive/<YYYY-MM-DD_HH-mm-ss>/{in,out}, leaving .gitkeep behind.

function timestampFolderName() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` +
    `_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`
  );
}

function main() {
  const toolName = process.argv[2];
  if (!toolName) {
    console.error('Usage: node lib/archive.js <tool-folder-name>');
    console.error('Example: node lib/archive.js compress-img');
    process.exit(1);
  }

  const toolDir = path.join(__dirname, '..', toolName);
  if (!fs.existsSync(toolDir) || !fs.statSync(toolDir).isDirectory()) {
    console.error(`Tool folder not found: ${toolDir}`);
    process.exit(1);
  }

  // Collect items to archive from in/ and out/ (creating them if missing).
  const items = [];
  for (const sub of ['in', 'out']) {
    const dir = path.join(toolDir, sub);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    for (const name of fs.readdirSync(dir)) {
      if (name === '.gitkeep') continue;
      items.push({ sub, name, src: path.join(dir, name) });
    }
  }

  if (items.length === 0) {
    console.log('Nothing to archive.');
    return;
  }

  const archiveRoot = path.join(toolDir, 'archive', timestampFolderName());
  let archived = 0;
  let failed = 0;

  for (const item of items) {
    const rel = `${item.sub}/${item.name}`;
    const destDir = path.join(archiveRoot, item.sub);
    const dest = path.join(destDir, item.name);

    // Copy first; only delete the original once the copy succeeded.
    try {
      fs.mkdirSync(destDir, { recursive: true });
      fs.cpSync(item.src, dest, { recursive: true });
    } catch (err) {
      console.error(`Failed to copy ${rel}: ${err.message} (original left in place)`);
      failed++;
      process.exitCode = 1;
      continue;
    }

    try {
      if (fs.statSync(item.src).isDirectory()) {
        fs.rmSync(item.src, { recursive: true });
      } else {
        fs.unlinkSync(item.src);
      }
      archived++;
      console.log(`Archived ${rel}`);
    } catch (err) {
      console.error(`Copied ${rel} but failed to remove the original: ${err.message}`);
      failed++;
      process.exitCode = 1;
    }
  }

  console.log(`Done: ${archived} archived, ${failed} failed.`);
  console.log(`Archive folder: ${archiveRoot}`);
}

main();
