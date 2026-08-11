# resize-img

Batch image resizer built on sharp. Drop images into `in/`, run the script, and same-name, same-format resized copies land in `out/`.

## Requirements

Run `npm install` at the repo root (uses sharp).

## Usage

1. Drop images into `in/`
2. From the repo root run: `npm run resize-img:resize` (or with options: `npm run resize-img:resize -- --width 1280` / `-- --scale 50`)
3. Resized images appear in `out/`

## Notes

- Supported formats: jpg, jpeg, png, webp, tiff, tif, avif, gif (extension match is case-insensitive).
- Options: `--width <n>` and/or `--height <n>` fit the image inside that bounding box, preserving aspect ratio. `--scale <percent>` (1-500) resizes to a percentage of the original dimensions instead.
- Images are never upscaled in width/height mode — anything already smaller than the bounding box is copied through at its original size. `--scale` above 100 does enlarge.
- EXIF orientation is applied automatically before resizing.
- Default when no options are given: `--width 1920`.
