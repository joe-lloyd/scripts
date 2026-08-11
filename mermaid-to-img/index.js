const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT_DIR = __dirname;
const IN_DIR = path.join(ROOT_DIR, 'in');
const OUT_DIR = path.join(ROOT_DIR, 'out');
const TEMP_DIR = path.join(ROOT_DIR, 'temp');
const PROJECT_ROOT = path.join(ROOT_DIR, '..');

// Resolve the mermaid-cli JS entry point and run it with the current Node
// binary. Spawning the .cmd shim directly throws EINVAL on modern Node
// (>=18.20/20.12) on Windows, and the package's "exports" map blocks
// require.resolve() of subpaths, so read its bin field ourselves.
function getMermaidCliEntry() {
  const pkgDir = path.join(PROJECT_ROOT, 'node_modules', '@mermaid-js', 'mermaid-cli');
  const pkgJsonPath = path.join(pkgDir, 'package.json');
  if (!fs.existsSync(pkgJsonPath)) {
    throw new Error(
      '@mermaid-js/mermaid-cli is not installed. Run "npm install" in the project root.'
    );
  }
  const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
  const bin = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin.mmdc;
  return path.join(pkgDir, bin);
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function extractMermaidBlocks(content) {
  const blocks = [...content.matchAll(/```mermaid\s*([\s\S]*?)```/g)]
    .map((m) => m[1].trim())
    .filter(Boolean);
  if (blocks.length > 0) {
    return blocks;
  }
  // Fallback: treat whole file as mermaid code
  const whole = content.trim();
  return whole ? [whole] : [];
}

function renderBlock(mermaidCliEntry, code, tempPath, outputPath) {
  fs.writeFileSync(tempPath, code + '\n', 'utf8');
  try {
    const result = spawnSync(
      process.execPath,
      [mermaidCliEntry, '-i', tempPath, '-o', outputPath],
      { stdio: 'inherit' }
    );
    if (result.error) {
      throw result.error;
    }
    if (result.status !== 0) {
      throw new Error(`mmdc exited with status ${result.status}`);
    }
  } finally {
    // Always clean up the temp .mmd file
    try {
      fs.unlinkSync(tempPath);
    } catch (e) {
      // ignore
    }
  }
}

function main() {
  ensureDir(IN_DIR);
  ensureDir(OUT_DIR);
  ensureDir(TEMP_DIR);

  let ok = 0;
  let failed = 0;
  let skipped = 0;

  try {
    const files = fs.readdirSync(IN_DIR).filter((f) => f.toLowerCase().endsWith('.md'));

    if (files.length === 0) {
      console.log('No .md files found in "in" directory. Add a markdown file with a ```mermaid``` block.');
      console.log('Done: 0 ok, 0 failed, 0 skipped');
      return;
    }

    const mermaidCliEntry = getMermaidCliEntry();

    for (const fileName of files) {
      const baseName = path.parse(fileName).name;

      try {
        const content = fs.readFileSync(path.join(IN_DIR, fileName), 'utf8');
        const blocks = extractMermaidBlocks(content);

        if (blocks.length === 0) {
          console.warn(`Skipped "${fileName}": no mermaid content found.`);
          skipped++;
          continue;
        }

        for (let i = 0; i < blocks.length; i++) {
          // One fence -> <name>.png; multiple -> <name>-1.png, <name>-2.png, ...
          const suffix = blocks.length === 1 ? '' : `-${i + 1}`;
          const outputPath = path.join(OUT_DIR, `${baseName}${suffix}.png`);
          const tempPath = path.join(TEMP_DIR, `${baseName}${suffix}.mmd`);

          console.log(`Rendering "${fileName}" -> "${path.basename(outputPath)}"...`);

          try {
            renderBlock(mermaidCliEntry, blocks[i], tempPath, outputPath);
            ok++;
          } catch (err) {
            console.error(`Failed to render "${fileName}"${suffix ? ` (diagram ${i + 1})` : ''}: ${err.message}`);
            failed++;
          }
        }
      } catch (err) {
        console.error(`Failed to process "${fileName}": ${err.message}`);
        failed++;
      }
    }
  } finally {
    // Clean up the temp directory after the run
    try {
      fs.rmSync(TEMP_DIR, { recursive: true, force: true });
    } catch (e) {
      // ignore
    }
  }

  console.log(`Done: ${ok} ok, ${failed} failed, ${skipped} skipped`);
  if (failed > 0) {
    process.exitCode = 1;
  }
}

main();
