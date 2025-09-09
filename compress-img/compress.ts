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

// WebP compression options - high quality (80-90 is generally considered high quality)
const compressionOptions = {
  quality: 95, // High quality but with some compression
  effort: 6, // Higher effort = better compression but slower (0-6)
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

      // Check if it's an image file
      const supportedFormats = [
        ".jpg",
        ".jpeg",
        ".png",
        ".gif",
        ".bmp",
        ".tiff",
        ".webp",
      ];
      if (!supportedFormats.includes(ext)) {
        console.log(`Skipping non-image file: ${file}`);
        continue;
      }

      // Create output filename (replace extension with .webp)
      const outputFilename = path.basename(file, ext) + ".webp";
      const outputPath = path.join(outputDir, outputFilename);

      console.log(`Converting ${file} to WebP...`);

      // Process the image with sharp
      await sharp(inputPath).webp(compressionOptions).toFile(outputPath);

      console.log(`Successfully converted ${file} to ${outputFilename}`);
    }

    console.log("All images processed successfully!");
  } catch (error) {
    console.error("Error processing images:", error);
  }
}

// Run the process
processImages();
