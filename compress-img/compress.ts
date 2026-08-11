import * as fs from "fs";
import * as path from "path";
import sharp from "sharp";

// Directories
const inputDir = path.join(__dirname, "in");
const outputDir = path.join(__dirname, "out");

// Ensure input and output directories exist
fs.mkdirSync(inputDir, { recursive: true });
fs.mkdirSync(outputDir, { recursive: true });

// WebP compression options - high quality (80-90 is generally considered high quality)
const compressionOptions = {
  quality: 95, // High quality but with some compression
  effort: 6, // Higher effort = better compression but slower (0-6)
};

// Image formats sharp can decode (no .bmp - sharp has no BMP decoder)
const supportedFormats = [
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".tiff",
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

  let converted = 0;
  let failed = 0;
  let skipped = 0;

  // Output names claimed during this run, to detect collisions
  // (e.g. a.jpg and a.png would both map to a.webp).
  const claimedOutputs = new Set<string>();

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

      // Create output filename (replace extension with .webp)
      let outputFilename = path.basename(file, ext) + ".webp";
      if (claimedOutputs.has(outputFilename.toLowerCase())) {
        // Collision with another file from this run - keep the original
        // extension in the name to disambiguate (e.g. a.png -> a.png.webp).
        outputFilename = file + ".webp";
        console.log(
          `Output name collision: writing ${file} as ${outputFilename}`
        );
      }
      claimedOutputs.add(outputFilename.toLowerCase());
      const outputPath = path.join(outputDir, outputFilename);

      console.log(`Converting ${file} to WebP...`);

      await sharp(inputPath).webp(compressionOptions).toFile(outputPath);

      console.log(`Successfully converted ${file} to ${outputFilename}`);
      converted++;
    } catch (error) {
      console.error(`Error processing ${file}:`, error);
      failed++;
    }
  }

  console.log(`Done: ${converted} converted, ${failed} failed, ${skipped} skipped`);
  if (failed > 0) {
    process.exitCode = 1;
  }
}

// Run the process
processImages();
