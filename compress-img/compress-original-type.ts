import * as fs from "fs";
import * as path from "path";
import sharp from "sharp";

// Directories
const inputDir = path.join(__dirname, "img-in");
const outputDir = path.join(__dirname, "img-out");

// Ensure output directory exists
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

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

// Process all files in the input directory
async function processImages(): Promise<void> {
  try {
    // Read all files from input directory
    const files = fs.readdirSync(inputDir);

    if (files.length === 0) {
      console.log("No files found in the input directory.");
      return;
    }

    console.log(`Found ${files.length} files to process.`);

    // Process each file
    for (const file of files) {
      const inputPath = path.join(inputDir, file);

      // Skip directories and non-image files
      if (fs.statSync(inputPath).isDirectory()) {
        console.log(`Skipping directory: ${file}`);
        continue;
      }

      // Get file extension
      const ext = path.extname(file).toLowerCase();
      const fileNameWithoutExt = path.basename(file, ext);

      // Check if it's an image file
      const supportedFormats = [
        ".jpg",
        ".jpeg",
        ".png",
        ".gif",
        ".bmp",
        ".tiff",
        ".webp",
        ".avif",
      ];
      
      if (!supportedFormats.includes(ext)) {
        console.log(`Skipping non-image file: ${file}`);
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
          await image.tiff(compressionOptions.tiff).toFile(outputPath);
          break;
        case ".gif":
          // For GIF, we don't have specific compression options
          // Just resave it through sharp
          await image.toFile(outputPath);
          break;
        default:
          // For other formats like BMP, convert to PNG for better compression
          const newOutputPath = path.join(outputDir, `${fileNameWithoutExt}.png`);
          await image.png(compressionOptions.png).toFile(newOutputPath);
          console.log(`Converted ${file} to PNG for better compression`);
          continue;
      }

      console.log(`Successfully compressed ${file}`);
    }

    console.log("All images processed successfully!");
  } catch (error) {
    console.error("Error processing images:", error);
  }
}

// Run the process
processImages();
