import * as fs from 'fs';
import * as path from 'path';
import ffmpeg from 'fluent-ffmpeg';

// Define input and output directories
const INPUT_DIR = path.join(__dirname, '..', 'in');
const OUTPUT_DIR = path.join(__dirname, '..', 'out');

// Ensure output directory exists
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

// Get all files from input directory
const getVideoFiles = (): string[] => {
  try {
    return fs.readdirSync(INPUT_DIR)
      .filter(file => {
        const ext = path.extname(file).toLowerCase();
        // Common video extensions
        return ['.mp4', '.mov', '.avi', '.mkv', '.wmv', '.flv', '.webm'].includes(ext);
      })
      .map(file => path.join(INPUT_DIR, file));
  } catch (error) {
    console.error('Error reading input directory:', error);
    return [];
  }
};

// Compress a single video file
const compressVideo = (inputPath: string): Promise<void> => {
  return new Promise((resolve, reject) => {
    const filename = path.basename(inputPath);
    const outputPath = path.join(OUTPUT_DIR, filename);
    
    // Skip if output file already exists
    if (fs.existsSync(outputPath)) {
      console.log(`Skipping ${filename} - already compressed`);
      resolve();
      return;
    }
    
    console.log(`Compressing ${filename}...`);
    
    ffmpeg(inputPath)
      .outputOptions([
        '-c:v libx264',       // Use H.264 codec
        '-crf 28',            // Constant Rate Factor (23 is default, higher = more compression)
        '-preset medium',     // Encoding speed (slower = better compression)
        '-c:a aac',           // Audio codec
        '-b:a 128k',          // Audio bitrate
        '-movflags +faststart' // Optimize for web streaming
      ])
      .output(outputPath)
      .on('progress', (progress: { percent?: number }) => {
        if (progress.percent) {
          console.log(`Processing: ${Math.round(progress.percent)}% done`);
        }
      })
      .on('error', (err: Error) => {
        console.error(`Error compressing ${filename}:`, err.message);
        reject(err);
      })
      .on('end', () => {
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

// Main function to process all videos
const processVideos = async (): Promise<void> => {
  const videoFiles = getVideoFiles();
  
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
processVideos().catch(err => {
  console.error('An error occurred:', err);
  process.exit(1);
});
