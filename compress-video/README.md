# Video Compressor

A simple TypeScript utility to compress video files for easier uploading.

## Prerequisites

- [Node.js](https://nodejs.org/) (v14 or newer recommended)
- [FFmpeg](https://ffmpeg.org/) installed on your system

### Installing FFmpeg

#### macOS
```bash
brew install ffmpeg
```

#### Windows
1. Download from [FFmpeg official website](https://ffmpeg.org/download.html)
2. Add FFmpeg to your PATH environment variable

#### Linux
```bash
sudo apt update
sudo apt install ffmpeg
```

## Installation

1. Clone this repository
2. Install dependencies:
```bash
npm install
```

## Usage

1. Place your video files in the `in` folder
2. Run the compression script:
```bash
npm run compress
```
3. Compressed videos will be saved to the `out` folder

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
