import * as fs from 'fs';
import * as path from 'path';

// Directories
const inputDir = path.join(__dirname, 'img-in');
const outputDir = path.join(__dirname, 'img-out');
const archiveDir = path.join(__dirname, 'img-archive');

// Ensure archive directory exists
if (!fs.existsSync(archiveDir)) {
  fs.mkdirSync(archiveDir, { recursive: true });
}

// Create a timestamp folder name
function getTimestampFolderName(): string {
  const now = new Date();
  return now.toISOString()
    .replace(/:/g, '-')
    .replace(/\..+/, '')
    .replace('T', '_');
}

// Copy a file from source to destination
function copyFile(source: string, destination: string): void {
  fs.copyFileSync(source, destination);
  console.log(`Copied: ${path.basename(source)} to ${destination}`);
}

// Empty a directory (delete all files but keep the directory)
function emptyDirectory(directory: string): void {
  const files = fs.readdirSync(directory);
  
  for (const file of files) {
    const filePath = path.join(directory, file);
    
    if (fs.statSync(filePath).isDirectory()) {
      // Recursively empty subdirectories
      emptyDirectory(filePath);
      fs.rmdirSync(filePath);
    } else {
      // Delete file
      fs.unlinkSync(filePath);
    }
  }
  
  console.log(`Emptied directory: ${directory}`);
}

// Archive files from input and output directories
function archiveFiles(): string | null {
  try {
    // Create timestamp folder in archive directory
    const timestamp = getTimestampFolderName();
    const archiveTimestampDir = path.join(archiveDir, timestamp);
    
    // Create input and output subdirectories in the archive timestamp folder
    const archiveInputDir = path.join(archiveTimestampDir, 'img-in');
    const archiveOutputDir = path.join(archiveTimestampDir, 'img-out');
    
    fs.mkdirSync(archiveTimestampDir, { recursive: true });
    fs.mkdirSync(archiveInputDir, { recursive: true });
    fs.mkdirSync(archiveOutputDir, { recursive: true });
    
    console.log(`Created archive directory: ${archiveTimestampDir}`);
    
    // Copy files from input directory to archive
    const inputFiles = fs.readdirSync(inputDir);
    for (const file of inputFiles) {
      const sourcePath = path.join(inputDir, file);
      
      // Skip directories
      if (fs.statSync(sourcePath).isDirectory()) {
        continue;
      }
      
      const destPath = path.join(archiveInputDir, file);
      copyFile(sourcePath, destPath);
    }
    
    // Copy files from output directory to archive
    const outputFiles = fs.readdirSync(outputDir);
    for (const file of outputFiles) {
      const sourcePath = path.join(outputDir, file);
      
      // Skip directories
      if (fs.statSync(sourcePath).isDirectory()) {
        continue;
      }
      
      const destPath = path.join(archiveOutputDir, file);
      copyFile(sourcePath, destPath);
    }
    
    console.log('All files archived successfully!');
    
    // Empty input and output directories
    emptyDirectory(inputDir);
    emptyDirectory(outputDir);
    
    console.log('Input and output directories emptied.');
    
    return archiveTimestampDir;
  } catch (error) {
    console.error('Error archiving files:', error);
    return null;
  }
}

// Run the archive process
const archivedDir = archiveFiles();
if (archivedDir) {
  console.log(`Archive completed successfully to: ${archivedDir}`);
} else {
  console.log('Archive process failed.');
}
