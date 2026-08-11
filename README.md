# scripts

A personal collection of small batch utility tools. Each tool lives in its own folder and follows the same convention:

1. Drop files into the tool's `in/` folder
2. Run the tool's npm script from the repo root (`npm run <tool>:<action>`)
3. Collect results from `out/`

Scripts never modify the files in `in/`. Tools that support archiving move processed files into `<tool>/archive/<timestamp>/` via the shared `lib/archive.js`. One bad input file never aborts a batch — each tool logs the failure, continues, and exits nonzero at the end.

## Setup

```
npm install
```

That is the whole setup on Windows, macOS and Linux — including ffmpeg, which arrives as a prebuilt binary for your platform and architecture, so the video and audio tools work immediately with no system install and no admin rights.

`compress-video/` and `ocr-pdf/` are standalone packages — run `npm install` inside each of them once before first use.

### ffmpeg

Every tool here finds ffmpeg through one shared resolver (`lib/ffmpeg.js`), which checks, in order: `$FFMPEG_PATH` → your `PATH` → the repo's `tools/` folder → the bundled `ffmpeg-static` package → older local caches → the usual per-platform install locations. A system ffmpeg wins over the bundled copy, so installing your own stays worthwhile.

To check what is being used, or to repair a skipped/failed install:

```
npm run setup:ffmpeg
```

It prints which binary each tool will use and where it came from, and fetches one if nothing is found. Prefer a system-wide install? `winget install Gyan.FFmpeg` (Windows), `brew install ffmpeg` (macOS), `sudo apt install ffmpeg` (Linux) — all are picked up automatically. Have one somewhere unusual? Set `FFMPEG_PATH` and it wins over everything.

The bundled binaries add about 80 MB to `npm install`. On a machine where you only need the image tools, `npm install --omit=optional` skips them, and the video tools will still use a system ffmpeg if you have one.

## Image tools

| Tool | Command | What it does |
|---|---|---|
| `compress-img` | `npm run compress-img:compress` | Convert images to WebP (quality 95) |
| | `npm run compress-img:compress-original` | Recompress images keeping their original format |
| | `npm run compress-img:archive` | Archive processed files out of `in/` and `out/` |
| `convert-img` | `npm run convert-img:convert -- --to png` | Convert images between formats (png/jpg/webp/avif/tiff) |
| `resize-img` | `npm run resize-img:resize -- --width 1280` | Batch resize (`--width`/`--height`/`--scale`), never upscales |
| `strip-exif` | `npm run strip-exif:strip` | Remove EXIF/GPS/XMP metadata; orientation preserved by rotating pixels |
| `remove-img-bg` | `npm run remove-img-bg:process` | Remove image backgrounds (@imgly/background-removal) |
| `img-to-pdf` | `npm run img-to-pdf:convert` | Merge images into a single PDF, one page per image |

## Video & audio tools

| Tool | Command | What it does |
|---|---|---|
| `compress-video` | `npm run compress-video:compress` | Compress videos to H.264/AAC MP4 |
| | `npm run compress-video:convert` | Lossless remux of non-MP4 videos to MP4 |
| `video-to-gif` | `npm run video-to-gif:convert -- --fps 15` | Convert videos to palette-optimized GIFs |
| `extract-audio` | `npm run extract-audio:extract -- --format wav` | Extract audio tracks from videos (mp3/wav/m4a/flac) |
| `get-audio` | `get-audio\Get-Audio.cmd` (Windows) | Download audio from URLs via yt-dlp |

All four use ffmpeg, which `npm install` already provided — see [ffmpeg](#ffmpeg) above.

## Document & file tools

| Tool | Command | What it does |
|---|---|---|
| `ocr-pdf` | `npm run ocr-pdf:ocr`, then `npm run ocr-pdf:md` | OCR scanned PDFs (needs ocrmypdf/Tesseract/Ghostscript), then extract Markdown |
| `mermaid-to-img` | `npm run mermaid-to-img:render` | Render every ```mermaid fence in `.md` files to PNG |
| `unrar-files` | `npm run unrar-files:extract` | Extract `.rar` archives |
| `dedupe-files` | `npm run dedupe-files:scan -- "C:\some\folder"` | Find duplicate files by SHA-256; `--move` relocates them (never deletes) |

## Git & shell helpers (`bash/`, `git-split-commits/`)

Run these directly with bash; they take no npm wiring.

| Script | What it does |
|---|---|
| `bash/generate-csv.sh` | Export the current repo's commit history to CSV |
| `bash/git-get-all.sh` | Fetch all Gerrit change refs newer than a date into `cr-*` branches (config in `bash/config.env`) |
| `bash/git-get-after.sh` | CSV report of fetched Gerrit changes newer than a date, with merge status |
| `bash/git-pull-all-latest-branches.sh` | Fetch all Gerrit change refs, then prune merged/superseded `cr-*` branches |
| `bash/git-delete-old-branches.sh` | Delete merged and superseded `cr-*` branches |
| `bash/remove-artifacts.sh` | Recursively delete build artifacts/lockfiles below the cwd (asks for confirmation) |
| `bash/order-screens.sh` | macOS: launch apps onto specific desktops (superseded by `desktop-layout/`) |
| `git-split-commits/git-split-commits.sh` | Split the current branch into one `feature/*` branch per commit |

## macOS desktop tools (`desktop-layout/`)

`fix-desktops.py` reconciles Mission Control desktops and app-to-desktop bindings for one- and two-screen layouts; see its README for setup (Dock app, permissions) and the helper scripts (`add-spare-desktops.sh`, `count-windows.swift`).
