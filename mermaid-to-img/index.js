const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT_DIR = __dirname;
const IN_DIR = path.join(ROOT_DIR, 'in');
const OUT_DIR = path.join(ROOT_DIR, 'out');
const PROJECT_ROOT = path.join(ROOT_DIR, '..');

function getMermaidCliPath() {
  const binName = process.platform === 'win32' ? 'mmdc.cmd' : 'mmdc';
  return path.join(PROJECT_ROOT, 'node_modules', '.bin', binName);
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function extractMermaid(content) {
  const fenceMatch = content.match(/```mermaid\s*([\s\S]*?)```/m);
  if (fenceMatch && fenceMatch[1]) {
    return fenceMatch[1].trim() + '\n';
  }
  // Fallback: treat whole file as mermaid code
  return content.trim() + '\n';
}

function convertFile(fileName) {
  const inputPath = path.join(IN_DIR, fileName);
  const baseName = path.parse(fileName).name;
  const tempPath = path.join(ROOT_DIR, `${baseName}.mmd`);
  const outputPath = path.join(OUT_DIR, `${baseName}.png`);

  const content = fs.readFileSync(inputPath, 'utf8');
  const mermaidCode = extractMermaid(content);
  fs.writeFileSync(tempPath, mermaidCode, 'utf8');

  console.log(`Rendering "${fileName}" -> "${path.basename(outputPath)}"...`);

  const mmdcPath = getMermaidCliPath();
  const result = spawnSync(
    mmdcPath,
    ['-i', tempPath, '-o', outputPath],
    { stdio: 'inherit' }
  );

  // Clean up temp file
  try {
    fs.unlinkSync(tempPath);
  } catch (e) {
    // ignore
  }

  if (result.error || result.status !== 0) {
    console.error(`Failed to render "${fileName}".`);
    process.exitCode = 1;
  }
}

function main() {
  ensureDir(IN_DIR);
  ensureDir(OUT_DIR);

  const files = fs.readdirSync(IN_DIR).filter((f) => f.toLowerCase().endsWith('.md'));

  if (files.length === 0) {
    console.log('No .md files found in "in" directory. Add a markdown file with a ```mermaid``` block.');
    return;
  }

  files.forEach(convertFile);
}

main();

