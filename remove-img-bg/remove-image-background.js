const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { removeBackground } = require('@imgly/background-removal-node');

// Directories
const inputDir = path.join(__dirname, 'in');
const outputDir = path.join(__dirname, 'out');
const tempDir = path.join(__dirname, 'temp');

/**
 * Process a single image to remove its background
 * @param {string} inputPath - Path to the input image
 * @param {string} outputPath - Path to save the output image
 * @returns {Promise<boolean>} - Success status
 */
async function processImage(inputPath, outputPath) {
  try {
    console.log(`Processing image: ${path.basename(inputPath)}`);

    // Create a temp directory if it doesn't exist
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    // Use sharp to convert the image to PNG format first
    const tempPngPath = path.join(tempDir, 'temp_input.png');
    console.log('Converting image to PNG format...');

    await sharp(inputPath)
      .toFormat('png')
      .toFile(tempPngPath);

    // Now read the PNG file as a buffer
    const pngBuffer = fs.readFileSync(tempPngPath);

    console.log('Removing background with @imgly/background-removal-node...');

    // Use the removeBackground function from the package with Node.js specific configuration
    const outputBuffer = await removeBackground(pngBuffer, {
      // Node.js specific configuration
      debug: false,
      model: 'medium', // Use medium model for better quality
      output: {
        format: 'image/png', // Output format
        quality: 1, // Maximum quality
        type: 'foreground' // Extract the foreground (subject) with transparency
      }
    });

    // Write the result to the output file
    fs.writeFileSync(outputPath, outputBuffer);

    console.log(`Background removed and saved to ${outputPath}`);
    return true;
  } catch (error) {
    console.error(`Error processing ${inputPath}:`, error);
    return false;
  }
}

/**
 * Process all images in the in/ directory and save results to out/
 */
async function processAllImages() {
  // Ensure input and output directories exist
  fs.mkdirSync(inputDir, { recursive: true });
  fs.mkdirSync(outputDir, { recursive: true });

  let processed = 0;
  let failed = 0;
  let skipped = 0;

  try {
    // Read all files from the input directory
    const files = fs.readdirSync(inputDir).filter(file => file !== '.gitkeep');
    const imageFiles = files.filter(file => {
      const ext = path.extname(file).toLowerCase();
      // No .bmp - sharp has no BMP decoder
      return ['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext);
    });
    skipped = files.length - imageFiles.length;

    if (imageFiles.length === 0) {
      console.log('No image files found in the input directory.');
      return;
    }

    console.log(`Found ${imageFiles.length} image(s) to process.`);

    // Process each image
    for (const file of imageFiles) {
      const inputPath = path.join(inputDir, file);
      const outputPath = path.join(outputDir, `${path.parse(file).name}.png`);

      console.log(`\nProcessing: ${file}`);
      const ok = await processImage(inputPath, outputPath);
      if (ok) {
        processed++;
      } else {
        failed++;
      }
    }
  } finally {
    // Clean up the temp directory
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch (err) {
      console.warn('Could not clean up temp directory:', err.message);
    }

    console.log(`\nDone: ${processed} processed, ${failed} failed, ${skipped} skipped`);
    if (failed > 0) {
      process.exitCode = 1;
    }
  }
}

// Run the script
processAllImages();
