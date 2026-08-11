const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { requireFfmpeg, describe, resolveFfmpeg } = require('../lib/ffmpeg');

const ROOT_DIR = __dirname;
const IN_DIR = path.join(ROOT_DIR, 'in');
const OUT_DIR = path.join(ROOT_DIR, 'out');

const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.mkv', '.avi', '.webm', '.wmv', '.flv']);

const DEFAULT_FPS = 12;
const DEFAULT_WIDTH = 480;

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function printUsageAndExit(message) {
  if (message) {
    console.error(message);
  }
  console.error('Usage: node video-to-gif/index.js [--fps <1-60>] [--width <pixels>]');
  process.exit(1);
}

function parseArgs(argv) {
  const options = { fps: DEFAULT_FPS, width: DEFAULT_WIDTH };

  for (let i = 0; i < argv.length; i++) {
    let flag = argv[i];
    let value;

    const eq = flag.indexOf('=');
    if (eq !== -1) {
      value = flag.slice(eq + 1);
      flag = flag.slice(0, eq);
    }

    if (flag !== '--fps' && flag !== '--width') {
      printUsageAndExit(`Unknown argument: "${argv[i]}"`);
    }

    if (value === undefined) {
      value = argv[++i];
    }
    const parsed = Number(value);
    if (value === undefined || !Number.isInteger(parsed)) {
      printUsageAndExit(`${flag} expects a whole number, got "${value}".`);
    }

    if (flag === '--fps') {
      if (parsed < 1 || parsed > 60) {
        printUsageAndExit(`--fps must be between 1 and 60, got ${parsed}.`);
      }
      options.fps = parsed;
    } else {
      if (parsed < 1) {
        printUsageAndExit(`--width must be a positive number, got ${parsed}.`);
      }
      options.width = parsed;
    }
  }

  return options;
}

function lastStderrLines(stderr, count) {
  if (!stderr) {
    return '(no ffmpeg output captured)';
  }
  return stderr
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-count)
    .join('\n    ');
}

function convertFile(ffmpeg, fileName, options) {
  const inputPath = path.join(IN_DIR, fileName);
  const baseName = path.parse(fileName).name;
  const outputPath = path.join(OUT_DIR, `${baseName}.gif`);
  const partPath = `${outputPath}.part`;

  const filterComplex =
    `[0:v] fps=${options.fps},scale=${options.width}:-1:flags=lanczos,split [a][b];` +
    '[a] palettegen [p];[b][p] paletteuse';

  const args = [
    '-hide_banner',
    '-loglevel', 'error',
    '-nostdin',
    '-y',
    '-i', inputPath,
    '-filter_complex', filterComplex,
    '-f', 'gif',
    partPath,
  ];

  try {
    const result = spawnSync(ffmpeg, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

    if (result.error) {
      throw new Error(`could not run ffmpeg: ${result.error.message}`);
    }
    if (result.status !== 0) {
      throw new Error(
        `ffmpeg exited with code ${result.status}. Last output:\n    ${lastStderrLines(result.stderr, 5)}`
      );
    }
    if (!fs.existsSync(partPath) || fs.statSync(partPath).size === 0) {
      throw new Error('ffmpeg reported success but produced no output.');
    }

    fs.renameSync(partPath, outputPath);
    const sizeKb = (fs.statSync(outputPath).size / 1024).toFixed(1);
    console.log(`  done -> "${path.basename(outputPath)}" (${sizeKb} KB)`);
    return true;
  } catch (err) {
    // Never leave a half-written .part behind.
    try {
      if (fs.existsSync(partPath)) {
        fs.unlinkSync(partPath);
      }
    } catch (cleanupErr) {
      // ignore cleanup problems; the error below matters more
    }
    console.error(`  FAILED "${fileName}": ${err.message}`);
    return false;
  }
}

function main() {
  const options = parseArgs(process.argv.slice(2));

  ensureDir(IN_DIR);
  ensureDir(OUT_DIR);

  // Exits with install guidance if ffmpeg is missing, before any file work.
  const ffmpeg = requireFfmpeg();
  console.log(`Using ffmpeg: ${describe(resolveFfmpeg())}`);
  console.log(`Settings: ${options.fps} fps, ${options.width}px wide`);

  const entries = fs.readdirSync(IN_DIR, { withFileTypes: true });

  let converted = 0;
  let failed = 0;
  let skipped = 0;
  let index = 0;
  const total = entries.length;

  for (const entry of entries) {
    index++;
    const label = `[${index}/${total}]`;

    if (entry.name === '.gitkeep') {
      console.log(`${label} Skipping ".gitkeep" (housekeeping file).`);
      continue; // not a conversion candidate, so not counted in the summary
    }
    if (entry.isDirectory()) {
      console.log(`${label} Skipping "${entry.name}" (subdirectory).`);
      skipped++;
      continue;
    }
    const ext = path.extname(entry.name).toLowerCase();
    if (!VIDEO_EXTENSIONS.has(ext)) {
      console.log(`${label} Skipping "${entry.name}" (not a supported video type).`);
      skipped++;
      continue;
    }

    const outputName = `${path.parse(entry.name).name}.gif`;
    if (fs.existsSync(path.join(OUT_DIR, outputName))) {
      console.log(`${label} Skipping "${entry.name}" ("${outputName}" already exists in out/).`);
      skipped++;
      continue;
    }

    console.log(`${label} Converting "${entry.name}" -> "${outputName}" ...`);
    if (convertFile(ffmpeg, entry.name, options)) {
      converted++;
    } else {
      failed++;
    }
  }

  if (converted + failed + skipped === 0) {
    console.log('No videos found in "in/". Drop some .mp4/.mov/.mkv/.avi/.webm/.wmv/.flv files there.');
  }

  console.log(`Done: ${converted} converted, ${failed} failed, ${skipped} skipped`);
  if (failed > 0) {
    process.exitCode = 1;
  }
}

main();
