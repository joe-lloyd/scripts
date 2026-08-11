# Video Compressor

A simple TypeScript utility to compress video files for easier uploading.

## Requirements

ffmpeg. Run `npm install` at the repo root and you already have it — prebuilt
binaries for Windows, macOS and Linux come with the install. If that was skipped
or failed, run `npm run setup:ffmpeg`, which reports what it found and fetches a
copy if needed. A system ffmpeg on your PATH is used in preference when present.

Then run `npm install` inside this folder for its own dependencies.

## Usage

### Compress

1. Place your video files in the `in` folder
2. Run the compression script:
```bash
npm run compress
```
3. Compressed videos will be saved to the `out` folder

Output is **always MP4**: whatever the input container (`.mov`, `.mkv`, `.webm`, ...), the result is saved as `<name>.mp4` because the video/audio streams are re-encoded to H.264/AAC.

### Convert (lossless remux)

To repackage non-MP4 files from the `in` folder into MP4 **without re-encoding** (no quality loss, much faster than compressing):

```bash
npm run convert
```

This copies the existing video/audio streams into an MP4 container and writes `<name>.mp4` to the `out` folder. Note: it only works when the source streams are MP4-compatible (e.g. H.264/AAC in a `.mkv` or `.mov`); otherwise use `npm run compress`.

### Notes

- Files whose `<name>.mp4` already exists in `out` are skipped, so you can re-run the script to resume a batch.
- Encodes are written to a `.mp4.part` file and renamed only on success, so an interrupted or failed run never leaves a half-written file that would be mistaken for a finished one.

## How it works

This tool uses FFmpeg with the following compression settings:
- H.264 video codec with CRF (Constant Rate Factor) of 28
- AAC audio codec at 128kbps
- Medium encoding preset for a good balance of speed and compression
- Optimized for web streaming

## Customization

To modify compression settings, edit the `outputOptions` array in `src/index.ts`:

```typescript
ffmpeg(inputPath)
  .outputOptions([
    '-c:v libx264',       // Video codec
    '-crf 28',            // Compression quality (lower = better quality, higher = smaller file)
    '-preset medium',     // Encoding speed (slower = better compression)
    '-c:a aac',           // Audio codec
    '-b:a 128k',          // Audio bitrate
    '-movflags +faststart' // Optimize for web streaming
  ])
```

## License

ISC
