const fs = require('fs');
const path = require('path');

// Define directories
const inputDir = path.join(__dirname, 'img-in');
const outputDir = path.join(__dirname, 'img-out');
const archiveDir = path.join(__dirname, 'img-archive');

// Ensure archive directory exists
if (!fs.existsSync(archiveDir)) {
  fs.mkdirSync(archiveDir, { recursive: true });
}

function archiveFiles() {
  try {
    // Create timestamp for archive folder
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const archiveTimestampDir = path.join(archiveDir, timestamp);
    
    // Create timestamped directory in archive
    fs.mkdirSync(archiveTimestampDir);
    fs.mkdirSync(path.join(archiveTimestampDir, 'input'));
    fs.mkdirSync(path.join(archiveTimestampDir, 'output'));
    
    // Archive input files
    const inputFiles = fs.readdirSync(inputDir);
    if (inputFiles.length > 0) {
      console.log(`Archiving ${inputFiles.length} input files...`);
      inputFiles.forEach(file => {
        const sourcePath = path.join(inputDir, file);
        const destPath = path.join(archiveTimestampDir, 'input', file);
        
        // Copy file to archive
        fs.copyFileSync(sourcePath, destPath);
        
        // Remove from input directory
        fs.unlinkSync(sourcePath);
      });
    } else {
      console.log('No input files to archive.');
    }
    
    // Archive output files
    const outputFiles = fs.readdirSync(outputDir);
    if (outputFiles.length > 0) {
      console.log(`Archiving ${outputFiles.length} output files...`);
      outputFiles.forEach(file => {
        const sourcePath = path.join(outputDir, file);
        const destPath = path.join(archiveTimestampDir, 'output', file);
        
        // Copy file to archive
        fs.copyFileSync(sourcePath, destPath);
        
        // Remove from output directory
        fs.unlinkSync(sourcePath);
      });
    } else {
      console.log('No output files to archive.');
    }
    
    console.log(`Files archived successfully to: ${archiveTimestampDir}`);
  } catch (error) {
    console.error('Error archiving files:', error);
  }
}

// Run the archive process
archiveFiles();
