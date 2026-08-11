# convert-img

Batch-converts every image in `in/` to a single target format (webp by default) using sharp, writing the results to `out/`.

## Requirements

Run `npm install` at the repo root (uses sharp).

## Usage

1. Drop images into `in/`
2. From the repo root run: `npm run convert-img:convert` (or choose a format: `npm run convert-img:convert -- --to png`)
3. Converted images appear in `out/`

## Notes

- Input formats: jpg, jpeg, png, webp, tiff, tif, avif, gif (case-insensitive extensions).
- Target formats (`--to`): png, jpg, jpeg, webp, avif, tiff. Default is webp; unknown formats exit with an error.
- Quality defaults: jpeg 90 (mozjpeg), webp 90, avif 60; png and tiff use sharp's defaults. EXIF orientation is applied automatically.
- Files already in the target format are skipped (jpg and jpeg count as the same format).
- If two sources would produce the same output name in one run (e.g. `a.jpg` and `a.png` both to `a.webp`), the later one keeps its source extension in the name (`a.png.webp`).
- One bad file logs an error and the run continues; the summary line reports converted/failed/skipped counts and the exit code is 1 if anything failed.
