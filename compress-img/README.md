# compress-img

Compresses images with [sharp](https://sharp.pixelplumbing.com/). Two modes: convert everything to high-quality WebP, or recompress each image while keeping its original format.

## Requirements

Node.js. Dependencies (`sharp`, `typescript`, `ts-node`) are installed by running `npm install` at the repo root.

## Usage

1. Drop images into `in/`
2. From the repo root run: `npm run compress-img:compress` (convert to WebP) or `npm run compress-img:compress-original` (keep original format)
3. Results appear in `out/`

To archive processed files out of the way: `npm run compress-img:archive`

## Notes

- Supported input formats: `.jpg`, `.jpeg`, `.png`, `.gif`, `.tiff`, `.webp`, `.avif` (plus `.tif` in original-format mode). BMP is not supported (sharp has no BMP decoder).
- WebP mode name collisions (e.g. `a.jpg` and `a.png` would both become `a.webp`) are disambiguated by keeping the original extension in the name (`a.png.webp`); the script logs when this happens.
- One bad file does not abort the batch: it is logged, the rest are processed, and the run exits with code 1. A summary line reports converted/failed/skipped counts.
- `in/` and `out/` are auto-created if missing. Archiving moves everything (subfolders included) to `archive/<timestamp>/{in,out}/`, leaving `.gitkeep` in place.
