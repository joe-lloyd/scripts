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

// Convert a single video file to MP4
const convertToMp4 = (inputPath: string): Promise<void> => {
  return new Promise((resolve, reject) => {
    const parsedPath = path.parse(inputPath);
    if (parsedPath.ext.toLowerCase() === '.mp4') {
      resolve();
      return;
    }
    
    const outputPath = path.join(OUTPUT_DIR, `${parsedPath.name}.mp4`);
    
    if (fs.existsSync(outputPath)) {
      console.log(`Skipping ${parsedPath.base} - MP4 already exists`);
      resolve();
      return;
    }
    
    console.log(`Converting ${parsedPath.base} to MP4 without quality loss...`);
    
    ffmpeg(inputPath)
      .outputOptions([
        '-c copy' // Copy streams losslessly
      ])
      .output(outputPath)
      .on('error', (err: Error) => {
        console.error(`Error converting ${parsedPath.base}:`, err.message);
        reject(err);
      })
      .on('end', () => {
        console.log(`Finished converting ${parsedPath.base} to MP4`);
        resolve();
      })
      .run();
  });
};

// Main function to convert all videos to MP4
const convertVideos = async (): Promise<void> => {
  let videoFiles: string[] = [];
  try {
    videoFiles = fs.readdirSync(OUTPUT_DIR)
      .filter(file => {
        const ext = path.extname(file).toLowerCase();
        return ['.mov', '.avi', '.mkv', '.wmv', '.flv', '.webm'].includes(ext);
      })
      .map(file => path.join(OUTPUT_DIR, file));
  } catch (error) {
    console.error('Error reading output directory:', error);
    return;
  }
  
  if (videoFiles.length === 0) {
    console.log('No video files to convert in the output directory.');
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
