# video-to-gif

Converts videos (mp4/mov/mkv/avi/webm/wmv/flv) from `in/` into GIFs in `out/` using ffmpeg, with a palette-based two-pass encode for good colors at a small size.

## Requirements

ffmpeg. Run `npm install` at the repo root and you already have it — prebuilt
binaries for Windows, macOS and Linux come with the install. If that was skipped
or failed, run `npm run setup:ffmpeg`, which reports what it found and fetches a
copy if needed. A system ffmpeg on your PATH is used in preference when present.

## Usage

1. Drop videos into `in/`
2. From the repo root run: `npm run video-to-gif:convert` (options: `-- --fps 15 --width 640`)
3. GIFs appear in `out/`

## Notes

- Quality: each conversion runs ffmpeg's palettegen/paletteuse pipeline in a single invocation (`fps` + lanczos `scale`, then a generated 256-color palette), which looks far better than a naive GIF encode. Defaults: 12 fps, 480px wide (height auto).
- Skip-if-exists: inputs whose `<name>.gif` is already in `out/` are skipped, so re-runs only convert new files. Output is written to `<name>.gif.part` and renamed on success, so interrupted runs never leave corrupt GIFs behind.
- ffmpeg discovery: handled by the shared `lib/ffmpeg.js` resolver, which checks `$FFMPEG_PATH`, then PATH, then `tools/`, then the bundled `ffmpeg-static` package, then common install locations. The startup line reports which binary was picked and where it came from; if nothing works the script prints platform-specific install instructions and exits 1.
