import * as fs from "fs";
import * as path from "path";
import sharp from "sharp";

// Cuts a fixed number of pixels off the top of every image in a folder.
// Originals are never touched; results go to a separate output folder.

const USAGE =
  "Usage: npx ts-node crop-top/crop-top.ts [folder] [--px <n>] [--out <folder>]";

const supportedFormats = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".tiff",
  ".tif",
  ".avif",
  ".gif",
]);

interface Options {
  inputDir: string;
  outputDir: string;
  px: number;
}

function fail(message: string): never {
  console.error(message);
  console.error(USAGE);
  process.exit(1);
}

function parseArgs(argv: string[]): Options {
  let px = 20;
  let inputDir: string | undefined;
  let outputDir: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--px") {
      const raw = argv[++i];
      const value = Number(raw);
      if (raw === undefined || !Number.isInteger(value) || value <= 0) {
        fail(`Invalid value for --px: expected a positive integer, got "${raw}"`);
      }
      px = value;
    } else if (arg === "--out") {
      const raw = argv[++i];
      if (raw === undefined) fail("--out needs a folder");
      outputDir = path.resolve(raw);
    } else if (arg.startsWith("--")) {
      fail(`Unknown argument: ${arg}`);
    } else if (inputDir === undefined) {
      inputDir = path.resolve(arg);
    } else {
      fail(`Unexpected extra argument: ${arg}`);
    }
  }

  // No folder given: fall back to the repo's in/ -> out/ convention.
  // Folder given: write next to the originals in <folder>/cropped.
  if (inputDir === undefined) {
    inputDir = path.join(__dirname, "in");
    outputDir ??= path.join(__dirname, "out");
  } else {
    outputDir ??= path.join(inputDir, "cropped");
  }

  if (!fs.existsSync(inputDir) || !fs.statSync(inputDir).isDirectory()) {
    fail(`Not a folder: ${inputDir}`);
  }
  if (outputDir === inputDir) {
    fail("Output folder must differ from the input folder");
  }

  return { inputDir, outputDir, px };
}

async function cropFile(inputPath: string, outputPath: string, px: number) {
  const image = sharp(inputPath).rotate(); // auto-orient from EXIF first
  const { data, info } = await image.toBuffer({ resolveWithObject: true });

  if (info.height <= px) {
    throw new Error(`image is only ${info.height}px tall, cannot cut ${px}px`);
  }

  await sharp(data)
    .extract({ left: 0, top: px, width: info.width, height: info.height - px })
    .toFile(outputPath);

  return { width: info.width, before: info.height, after: info.height - px };
}

async function main() {
  const { inputDir, outputDir, px } = parseArgs(process.argv.slice(2));
  fs.mkdirSync(outputDir, { recursive: true });

  console.log(`Cutting ${px}px off the top: ${inputDir} -> ${outputDir}`);

  let cropped = 0;
  let failed = 0;
  let skipped = 0;

  for (const name of fs.readdirSync(inputDir)) {
    if (name === ".gitkeep") continue;

    const inputPath = path.join(inputDir, name);
    if (fs.statSync(inputPath).isDirectory()) {
      skipped++;
      continue;
    }
    if (!supportedFormats.has(path.extname(name).toLowerCase())) {
      console.log(`Skipping unsupported file: ${name}`);
      skipped++;
      continue;
    }

    try {
      const r = await cropFile(inputPath, path.join(outputDir, name), px);
      console.log(`${name}: ${r.width}x${r.before} -> ${r.width}x${r.after}`);
      cropped++;
    } catch (error) {
      console.error(`Failed ${name}: ${(error as Error).message}`);
      failed++;
    }
  }

  console.log(`Done: ${cropped} cropped, ${failed} failed, ${skipped} skipped`);
  if (failed > 0) process.exitCode = 1;
}

main();
