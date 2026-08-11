# remove-img-bg

Removes the background from images using `@imgly/background-removal-node`, outputting PNGs with transparency.

## Requirements

Node.js. Dependencies (`sharp`, `@imgly/background-removal-node`, `onnxruntime-node`) are installed by running `npm install` at the repo root.

## Usage

1. Drop images into `in/`
2. From the repo root run: `npm run remove-img-bg:process`
3. Results appear in `out/`

To archive processed files out of the way: `npm run remove-img-bg:archive`

## Notes

- Accepted input formats: `.jpg`, `.jpeg`, `.png`, `.gif`, `.webp`. BMP is not supported (sharp has no BMP decoder).
- Each input is first converted to PNG in a `temp/` working directory, which is cleaned up at the end of the run.
- Output is always a `.png` named after the input file, with the subject kept and the background made transparent.
- One bad file does not abort the batch: it is logged, the rest are processed, and the run exits with code 1. A summary line reports processed/failed/skipped counts.
- `in/` and `out/` are auto-created if missing. Archiving moves everything (subfolders included) to `archive/<timestamp>/{in,out}/`, leaving `.gitkeep` in place.
