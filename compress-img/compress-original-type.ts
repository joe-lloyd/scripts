import * as fs from "fs";
import * as path from "path";
import sharp from "sharp";

// Directories
const inputDir = path.join(__dirname, "in");
const outputDir = path.join(__dirname, "out");

// Ensure input and output directories exist
fs.mkdirSync(inputDir, { recursive: true });
fs.mkdirSync(outputDir, { recursive: true });

// Compression options - high quality
const compressionOptions = {
  jpeg: {
    quality: 95,
    mozjpeg: true, // Use mozjpeg for better compression
  },
  png: {
    quality: 95,
    compressionLevel: 9, // 0-9, 9 being highest compression
    palette: true, // Use palette-based quantization for smaller files
  },
  webp: {
    quality: 95,
    effort: 6, // Higher effort = better compression but slower (0-6)
  },
  avif: {
    quality: 95,
    effort: 9, // 0-9, 9 being highest effort
  },
  gif: {}, // Sharp doesn't have specific options for GIF compression
  tiff: {
    quality: 95,
  },
};

// Image formats sharp can decode (no .bmp - sharp has no BMP decoder)
const supportedFormats = [
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".tiff",
  ".tif",
  ".webp",
  ".avif",
];

// Process all files in the input directory
async function processImages(): Promise<void> {
  const files = fs.readdirSync(inputDir);

  if (files.length === 0) {
    console.log("No files found in the input directory.");
    return;
  }

  console.log(`Found ${files.length} files to process.`);

  let compressed = 0;
  let failed = 0;
  let skipped = 0;

  for (const file of files) {
    const inputPath = path.join(inputDir, file);

    try {
      if (file === ".gitkeep") {
        continue;
      }

      // Skip directories and non-image files
      if (fs.statSync(inputPath).isDirectory()) {
        console.log(`Skipping directory: ${file}`);
        skipped++;
        continue;
      }

      const ext = path.extname(file).toLowerCase();

      if (!supportedFormats.includes(ext)) {
        console.log(`Skipping non-image file: ${file}`);
        skipped++;
        continue;
      }

      // Create output path with same extension
      const outputPath = path.join(outputDir, file);

      console.log(`Compressing ${file} (keeping original format)...`);

      // Process the image with sharp based on file type
      const image = sharp(inputPath);

      switch (ext) {
        case ".jpg":
        case ".jpeg":
          await image.jpeg(compressionOptions.jpeg).toFile(outputPath);
          break;
        case ".png":
          await image.png(compressionOptions.png).toFile(outputPath);
          break;
        case ".webp":
          await image.webp(compressionOptions.webp).toFile(outputPath);
          break;
        case ".avif":
          await image.avif(compressionOptions.avif).toFile(outputPath);
          break;
        case ".tiff":
        case ".tif":
          await image.tiff(compressionOptions.tiff).toFile(outputPath);
          break;
        case ".gif":
          // For GIF, we don't have specific compression options
          // Just resave it through sharp
          await image.toFile(outputPath);
          break;
      }

      console.log(`Successfully compressed ${file}`);
      compressed++;
    } catch (error) {
      console.error(`Error processing ${file}:`, error);
      failed++;
    }
  }

  console.log(`Done: ${compressed} compressed, ${failed} failed, ${skipped} skipped`);
  if (failed > 0) {
    process.exitCode = 1;
  }
}

// Run the process
processImages();
