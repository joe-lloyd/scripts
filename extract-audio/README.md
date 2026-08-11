# extract-audio

Extracts the audio track from local video files using ffmpeg. Drop videos into `in/` and get standalone audio files in `out/`.

## Requirements

ffmpeg. Run `npm install` at the repo root and you already have it — prebuilt
binaries for Windows, macOS and Linux come with the install. If that was skipped
or failed, run `npm run setup:ffmpeg`, which reports what it found and fetches a
copy if needed. A system ffmpeg on your PATH is used in preference when present.

## Usage

1. Drop videos into `in/`
2. From the repo root run: `npm run extract-audio:extract` (options: `-- --format wav`)
3. Audio files appear in `out/`

## Notes

- Supported inputs: mp4, mov, mkv, avi, webm, wmv, flv, m4v (case-insensitive).
- Output formats (`--format`, default `mp3`):
  - `mp3` - libmp3lame, VBR quality 2 (~190 kbps)
  - `wav` - pcm_s16le (uncompressed)
  - `m4a` - aac at 192 kbps
  - `flac` - flac (lossless)
- Writes to a `.part` file first and renames on success, so `out/` never holds half-written audio.
- Inputs whose output file already exists in `out/` are skipped - delete the output to re-extract.
- ffmpeg discovery: handled by the shared `lib/ffmpeg.js` resolver, which checks `$FFMPEG_PATH`, then PATH, then `tools/`, then the bundled `ffmpeg-static` package, then common install locations. The startup line reports which binary was picked and where it came from.
- Related tool: `get-audio` downloads audio from URLs; this one extracts audio from local video files.
