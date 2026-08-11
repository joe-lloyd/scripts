const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { requireFfmpeg, describe, resolveFfmpeg } = require('../lib/ffmpeg');

const ROOT_DIR = __dirname;
const IN_DIR = path.join(ROOT_DIR, 'in');
const OUT_DIR = path.join(ROOT_DIR, 'out');

const VIDEO_EXTENSIONS = ['.mp4', '.mov', '.mkv', '.avi', '.webm', '.wmv', '.flv', '.m4v'];

// Output format -> ffmpeg encoder args and container muxer.
// The .part extension hides the real container, so -f forces it explicitly.
const FORMATS = {
  mp3: { muxer: 'mp3', args: ['-vn', '-c:a', 'libmp3lame', '-q:a', '2'] },
  wav: { muxer: 'wav', args: ['-vn', '-c:a', 'pcm_s16le'] },
  m4a: { muxer: 'ipod', args: ['-vn', '-c:a', 'aac', '-b:a', '192k'] },
  flac: { muxer: 'flac', args: ['-vn', '-c:a', 'flac'] },
};

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function parseArgs(argv) {
  let format = 'mp3';
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--format') {
      format = argv[i + 1];
      i++;
    } else if (arg.startsWith('--format=')) {
      format = arg.slice('--format='.length);
    } else {
      console.error(`Unknown argument: ${arg}`);
      console.error('Usage: node extract-audio/index.js [--format mp3|wav|m4a|flac]');
      process.exit(1);
    }
  }
  if (!format || !Object.prototype.hasOwnProperty.call(FORMATS, format)) {
    console.error(`Invalid format: ${format || '(none)'}. Choose one of: ${Object.keys(FORMATS).join(', ')}`);
    process.exit(1);
  }
  return format;
}

function lastStderrLines(stderr, count) {
  const lines = String(stderr || '')
    .split(/\r\n|\r|\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  return lines.slice(-count).join('\n');
}

function extractAudio(ffmpegPath, fileName, format) {
  const { muxer, args } = FORMATS[format];
  const inputPath = path.join(IN_DIR, fileName);
  const outputName = `${path.parse(fileName).name}.${format}`;
  const outputPath = path.join(OUT_DIR, outputName);
  const partialPath = `${outputPath}.part`;

  // Skip if a finished output file already exists
  if (fs.existsSync(outputPath)) {
    console.log(`Skipping "${fileName}" - "${outputName}" already exists`);
    return 'skipped';
  }

  console.log(`Extracting "${fileName}" -> "${outputName}"...`);

  const result = spawnSync(
    ffmpegPath,
    ['-hide_banner', '-nostdin', '-nostats', '-y', '-i', inputPath, ...args, '-f', muxer, partialPath],
    { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }
  );

  if (result.error || result.status !== 0) {
    try {
      if (fs.existsSync(partialPath)) fs.unlinkSync(partialPath);
    } catch (e) {
      // ignore cleanup failure
    }
    const detail = result.error ? result.error.message : lastStderrLines(result.stderr, 5);
    throw new Error(`ffmpeg failed for "${fileName}"${detail ? `:\n${detail}` : ''}`);
  }

  fs.renameSync(partialPath, outputPath);
  const sizeKb = (fs.statSync(outputPath).size / 1024).toFixed(1);
  console.log(`Finished "${outputName}" (${sizeKb} KB)`);
  return 'extracted';
}

function main() {
  const format = parseArgs(process.argv.slice(2));

  ensureDir(IN_DIR);
  ensureDir(OUT_DIR);

  // Exits with install guidance if ffmpeg is missing, before any file work.
  const ffmpegPath = requireFfmpeg();
  console.log(`Using ffmpeg: ${describe(resolveFfmpeg())}`);
  console.log(`Output format: ${format}`);

  const entries = fs.readdirSync(IN_DIR, { withFileTypes: true });
  const videoFiles = [];
  let skipped = 0;

  for (const entry of entries) {
    if (entry.isDirectory()) {
      console.log(`Skipping "${entry.name}" - subdirectories are not processed`);
      skipped++;
      continue;
    }
    if (entry.name === '.gitkeep') {
      continue;
    }
    if (!VIDEO_EXTENSIONS.includes(path.extname(entry.name).toLowerCase())) {
      console.log(`Skipping "${entry.name}" - not a supported video file`);
      skipped++;
      continue;
    }
    videoFiles.push(entry.name);
  }

  if (videoFiles.length === 0) {
    console.log(`No video files found in "in". Supported: ${VIDEO_EXTENSIONS.join(', ')}`);
    console.log(`Done: 0 extracted, 0 failed, ${skipped} skipped`);
    return;
  }

  console.log(`Found ${videoFiles.length} video file(s).`);

  let extracted = 0;
  let failed = 0;

  for (const fileName of videoFiles) {
    try {
      const outcome = extractAudio(ffmpegPath, fileName, format);
      if (outcome === 'skipped') {
        skipped++;
      } else {
        extracted++;
      }
    } catch (err) {
      console.error(err.message);
      failed++;
    }
  }

  console.log(`Done: ${extracted} extracted, ${failed} failed, ${skipped} skipped`);
  if (failed > 0) {
    process.exitCode = 1;
  }
}

main();
