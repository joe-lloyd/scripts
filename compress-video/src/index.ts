import * as fs from 'fs';
import * as path from 'path';
import ffmpeg from 'fluent-ffmpeg';

// Shared ffmpeg discovery lives outside this package, so it is pulled in with a
// runtime require rather than an import - that keeps it out of the TypeScript
// rootDir graph while still resolving from both src/ (ts-node) and dist/ (tsc).
const ffmpegTools = require('../../lib/ffmpeg');

// Define input and output directories
const INPUT_DIR = path.join(__dirname, '..', 'in');
const OUTPUT_DIR = path.join(__dirname, '..', 'out');

// Ensure output directory exists
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

// fluent-ffmpeg only looks on PATH by default, which misses the repo's bundled
// binary. Point it at whatever the shared resolver found; exits with install
// guidance if ffmpeg is genuinely missing, before any file work happens.
ffmpeg.setFfmpegPath(ffmpegTools.requireFfmpeg());
console.log(`Using ffmpeg: ${ffmpegTools.describe(ffmpegTools.resolveFfmpeg())}`);

// ffprobe is not used by this tool today, so a missing one is not fatal.
const ffprobeFound = ffmpegTools.resolveFfprobe();
if (ffprobeFound) {
  ffmpeg.setFfprobePath(ffprobeFound.path);
}

// Track the in-progress partial file so an interrupt can clean it up
let currentPartial: string | null = null;

const removePartial = (partialPath: string): void => {
  try {
    if (fs.existsSync(partialPath)) {
      fs.unlinkSync(partialPath);
    }
  } catch (err) {
    console.error(`Warning: could not remove partial file ${partialPath}:`, err);
  }
};

process.on('SIGINT', () => {
  if (currentPartial) {
    console.log('\nInterrupted - removing partial file...');
    removePartial(currentPartial);
  }
  process.exit(130);
});

// Get all video files from a directory
const getVideoFiles = (dir: string, extensions: string[]): string[] => {
  try {
    return fs.readdirSync(dir)
      .filter(file => extensions.includes(path.extname(file).toLowerCase()))
      .map(file => path.join(dir, file));
  } catch (error) {
    console.error(`Error reading directory ${dir}:`, error);
    return [];
  }
};

// Compress a single video file (always outputs <name>.mp4)
const compressVideo = (inputPath: string): Promise<void> => {
  return new Promise((resolve, reject) => {
    const filename = path.basename(inputPath);
    const outputPath = path.join(OUTPUT_DIR, path.parse(inputPath).name + '.mp4');
    const partialPath = outputPath + '.part';

    // Skip if a finished output file already exists
    if (fs.existsSync(outputPath)) {
      console.log(`Skipping ${filename} - already compressed`);
      resolve();
      return;
    }

    console.log(`Compressing ${filename}...`);
    currentPartial = partialPath;

    ffmpeg(inputPath)
      .outputOptions([
        '-c:v libx264',       // Use H.264 codec
        '-crf 28',            // Constant Rate Factor (23 is default, higher = more compression)
        '-preset medium',     // Encoding speed (slower = better compression)
        '-c:a aac',           // Audio codec
        '-b:a 128k',          // Audio bitrate
        '-movflags +faststart' // Optimize for web streaming
      ])
      .format('mp4')          // The .part extension hides the real container, so force it
      .output(partialPath)
      .on('progress', (progress: { percent?: number }) => {
        if (progress.percent != null) {
          console.log(`Processing: ${Math.round(progress.percent)}% done`);
        }
      })
      .on('error', (err: Error) => {
        removePartial(partialPath);
        currentPartial = null;
        console.error(`Error compressing ${filename}:`, err.message);
        reject(err);
      })
      .on('end', () => {
        fs.renameSync(partialPath, outputPath);
        currentPartial = null;

        const inputSize = fs.statSync(inputPath).size / (1024 * 1024); // MB
        const outputSize = fs.statSync(outputPath).size / (1024 * 1024); // MB
        const reduction = ((1 - (outputSize / inputSize)) * 100).toFixed(2);

        console.log(`Finished compressing ${filename}`);
        console.log(`Original size: ${inputSize.toFixed(2)} MB`);
        console.log(`Compressed size: ${outputSize.toFixed(2)} MB`);
        console.log(`Size reduction: ${reduction}%`);
        resolve();
      })
      .run();
  });
};

// Losslessly remux a single non-mp4 video file to MP4 (no re-encoding)
const convertToMp4 = (inputPath: string): Promise<void> => {
  return new Promise((resolve, reject) => {
    const parsedPath = path.parse(inputPath);
    const outputPath = path.join(OUTPUT_DIR, `${parsedPath.name}.mp4`);
    const partialPath = outputPath + '.part';

    if (fs.existsSync(outputPath)) {
      console.log(`Skipping ${parsedPath.base} - MP4 already exists`);
      resolve();
      return;
    }

    console.log(`Converting ${parsedPath.base} to MP4 without quality loss...`);
    currentPartial = partialPath;

    ffmpeg(inputPath)
      .outputOptions([
        '-c copy' // Copy streams losslessly
      ])
      .format('mp4')
      .output(partialPath)
      .on('error', (err: Error) => {
        removePartial(partialPath);
        currentPartial = null;
        console.error(`Error converting ${parsedPath.base}:`, err.message);
        reject(err);
      })
      .on('end', () => {
        fs.renameSync(partialPath, outputPath);
        currentPartial = null;
        console.log(`Finished converting ${parsedPath.base} to MP4`);
        resolve();
      })
      .run();
  });
};

// Main function to remux all non-mp4 videos in in/ to MP4 in out/
const convertVideos = async (): Promise<void> => {
  const videoFiles = getVideoFiles(INPUT_DIR, ['.mov', '.avi', '.mkv', '.wmv', '.flv', '.webm']);

  if (videoFiles.length === 0) {
    console.log('No non-mp4 video files to convert in the input directory.');
    return;
  }

  console.log(`Found ${videoFiles.length} video file(s) to convert to MP4.`);

  for (const file of videoFiles) {
    try {
      await convertToMp4(file);
    } catch (error) {
      console.error(`Failed to process ${path.basename(file)}`);
    }
  }

  console.log('All conversions finished.');
};

// Main function to process all videos
const processVideos = async (): Promise<void> => {
  const videoFiles = getVideoFiles(INPUT_DIR, ['.mp4', '.mov', '.avi', '.mkv', '.wmv', '.flv', '.webm']);

  if (videoFiles.length === 0) {
    console.log('No video files found in the input directory.');
    return;
  }

  console.log(`Found ${videoFiles.length} video file(s) to compress.`);

  for (const file of videoFiles) {
    try {
      await compressVideo(file);
    } catch (error) {
      console.error(`Failed to process ${path.basename(file)}`);
    }
  }

  console.log('All videos processed.');
};

// Run the script
const command = process.argv[2];

if (command === 'convert') {
  convertVideos().catch(err => {
    console.error('An error occurred:', err);
    process.exit(1);
  });
} else {
  processVideos().catch(err => {
    console.error('An error occurred:', err);
    process.exit(1);
  });
}
