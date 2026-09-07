/**
 * The image, video and audio tools.
 *
 * All but two of these read a hardcoded in/ folder and write a hardcoded out/,
 * which is right for the drop-files-in-a-folder workflow the repo is built
 * around and wrong for an agent in another project asking about files that live
 * there. `stageDir` marks those: the caller's files are copied in around the
 * run and the results moved back out. See lib/staging.js.
 */

const fs = require('fs');
const path = require('path');
const powershell = require('../lib/powershell');
const ytdlp = require('../lib/ytdlp');
const { scriptTool, describeRecord, runDirect, flags, formatBytes } = require('./common');

const REPO_ROOT = path.join(__dirname, '..', '..');

/** List what a run left in a folder, newest first — used by get_audio. */
function newFilesIn(dir, since) {
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch (err) {
    return [];
  }

  return names
    .map((name) => {
      const full = path.join(dir, name);
      try {
        const stats = fs.statSync(full);
        return { file: full, mtime: stats.mtimeMs, bytes: stats.size };
      } catch (err) {
        return null;
      }
    })
    .filter((entry) => entry && entry.mtime >= since)
    .sort((a, b) => b.mtime - a.mtime)
    .map((entry) => ({ file: entry.file, size: formatBytes(entry.bytes) }));
}

/* -------------------------------------------------------------------------- */
/* Audio                                                                      */
/* -------------------------------------------------------------------------- */

const getAudio = {
  name: 'get_audio',
  title: 'Download audio from URLs or local video',
  description:
    'Pull the audio out of a video, from a URL or a local file, via yt-dlp and ffmpeg. The source ' +
    'stream is downloaded without re-encoding and decoded straight to 24-bit PCM at its native sample ' +
    'rate, so nothing is lost below what the site itself served — which for YouTube is a lossy stream ' +
    'around 100-130 kbps no matter what format you ask for. Give "duration" for a clip from a random ' +
    'start rather than a whole track; a long compilation as a full WAV is enormous. Existing files are ' +
    'never overwritten. Windows only — this tool is PowerShell.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      urls: {
        type: 'array',
        items: { type: 'string', minLength: 1 },
        description: 'URLs, or absolute paths to local video files. Omit to read get-audio/urls.txt, or use "search".',
      },
      search: {
        type: 'string',
        description:
          'Search YouTube with this phrase via yt-dlp and take the top hits instead of supplying URLs. ' +
          'Everything it picked is reported back, so a wrong pick is visible rather than silent.',
      },
      search_count: { type: 'integer', minimum: 1, maximum: 10, default: 3, description: 'How many search hits to take.' },
      format: { type: 'string', enum: ['wav', 'mp3', 'm4a', 'flac'], description: 'Output format. Default wav.' },
      duration: {
        type: 'number',
        minimum: 0,
        description:
          'Seconds to take, from a random start that fits inside the source. 0 or omitted takes the whole track.',
      },
      start: { type: 'string', description: 'Where to start: "90", "1:30" or "0:01:30". Default is random when duration is set.' },
      name: { type: 'string', description: 'Output base name. Defaults to the video title.' },
      out_dir: { type: 'string', description: 'Where files land. Defaults to get-audio/out/.' },
      rate: { type: 'integer', minimum: 0, description: 'Output sample rate. Omit to keep the source rate — resampling is a lossy step.' },
      bit_depth: { type: 'string', enum: ['16', '24', '32'], description: 'wav/flac only. Default 24.' },
      mono: { type: 'boolean', description: 'Downmix to one channel.' },
      update_tools: { type: 'boolean', description: 'Refresh yt-dlp first. Fixes most sudden download breakage.' },
      wait_seconds: {
        type: 'integer',
        minimum: 0,
        maximum: 300,
        default: 60,
        description: 'How long to wait before handing back a job id instead. Downloads are slow; this defaults higher than other tools.',
      },
    },
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },

  async run(args) {
    if (process.platform !== 'win32') {
      throw new Error(
        'get_audio is PowerShell and runs on Windows only. For local video files on another platform, use extract_audio.'
      );
    }

    let urls = args.urls || null;
    let hits = null;
    if (!urls && args.search) {
      hits = ytdlp.search(args.search, args.search_count);
      urls = hits.map((hit) => hit.url);
      if (urls.length === 0) throw new Error(`The search for "${args.search}" found nothing.`);
    }

    const outDir = args.out_dir ? path.resolve(REPO_ROOT, args.out_dir) : path.join(REPO_ROOT, 'get-audio', 'out');
    const startedAt = Date.now();

    const argv = powershell.callScript(path.join(REPO_ROOT, 'get-audio', 'Get-Audio.ps1'), [
      ['-Url', urls],
      ['-Format', args.format],
      ['-Duration', args.duration],
      ['-Start', args.start],
      ['-Name', args.name],
      ['-OutDir', args.out_dir ? outDir : null],
      ['-Rate', args.rate],
      ['-BitDepth', args.bit_depth],
      ['-Mono', args.mono],
      ['-UpdateTools', args.update_tools],
    ]);

    const { record } = await runDirect('get_audio', { binary: 'powershell.exe' }, argv, {
      args,
      waitSeconds: args.wait_seconds,
      // mtime beats parsing the console output: the script names files after
      // video titles and dodges collisions with " (2)" suffixes.
      summarise: () => ({ out_dir: outDir, files: newFilesIn(outDir, startedAt) }),
    });

    return describeRecord(record, {
      what: 'The audio download',
      extra: hits ? { search: args.search, picked: hits } : null,
    });
  },
};

const extractAudio = scriptTool({
  name: 'extract_audio',
  title: 'Extract audio tracks from local videos',
  description:
    'Extract the audio track from local video files with ffmpeg. Cross-platform, unlike get_audio — ' +
    'this one takes files you already have rather than URLs.',
  command: { node: 'extract-audio/index.js' },
  stageDir: 'extract-audio',
  inputWhat: 'videos',
  what: 'The audio extraction',
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  schema: {
    properties: {
      format: { type: 'string', enum: ['mp3', 'wav', 'm4a', 'flac'], description: 'Output format. Default mp3.' },
    },
  },
  buildArgv: (args) => flags([['--format', args.format]]),
});

/* -------------------------------------------------------------------------- */
/* Video                                                                      */
/* -------------------------------------------------------------------------- */

const compressVideo = scriptTool({
  name: 'compress_video',
  title: 'Compress or remux videos to MP4',
  description:
    'Compress videos to H.264/AAC MP4, or losslessly remux non-MP4 containers to MP4 without ' +
    're-encoding ("convert" mode). compress-video is a standalone package — it needs its own ' +
    '`npm install` inside compress-video/ before first use.',
  command: (args) => ({ npm: args.mode === 'convert' ? 'compress-video:convert' : 'compress-video:compress' }),
  stageDir: 'compress-video',
  inputWhat: 'videos',
  what: 'The video compression',
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  schema: {
    properties: {
      mode: {
        type: 'string',
        enum: ['compress', 'convert'],
        default: 'compress',
        description: '"compress" re-encodes to H.264/AAC; "convert" is a lossless remux to MP4.',
      },
    },
  },
  buildArgv: () => [],
});
const videoToGif = scriptTool({
  name: 'video_to_gif',
  title: 'Convert videos to palette-optimized GIFs',
  description: 'Convert video files to GIFs, generating a per-clip palette so colours survive the 256-colour limit.',
  command: { node: 'video-to-gif/index.js' },
  stageDir: 'video-to-gif',
  inputWhat: 'videos',
  what: 'The GIF conversion',
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  schema: {
    properties: {
      fps: { type: 'integer', minimum: 1, maximum: 60, description: 'Frames per second. Default 10.' },
      width: { type: 'integer', minimum: 1, description: 'Output width in pixels; height follows the aspect ratio.' },
    },
  },
  buildArgv: (args) =>
    flags([
      ['--fps', args.fps],
      ['--width', args.width],
    ]),
});

/* -------------------------------------------------------------------------- */
/* Images                                                                     */
/* -------------------------------------------------------------------------- */

const compressImg = scriptTool({
  name: 'compress_img',
  title: 'Compress images',
  description:
    'Compress images to WebP at quality 95, or recompress them keeping their original format ' +
    '(keep_format). Uses sharp.',
  command: (args) => ({ npm: args.keep_format ? 'compress-img:compress-original' : 'compress-img:compress' }),
  stageDir: 'compress-img',
  inputWhat: 'images',
  what: 'The image compression',
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  schema: {
    properties: {
      keep_format: {
        type: 'boolean',
        default: false,
        description: 'Recompress in the original format instead of converting everything to WebP.',
      },
    },
  },
  buildArgv: () => [],
});
const convertImg = scriptTool({
  name: 'convert_img',
  title: 'Convert images between formats',
  description: 'Convert images between png, jpg, webp, avif and tiff. EXIF orientation is applied to the pixels.',
  command: { node: 'convert-img/index.js' },
  stageDir: 'convert-img',
  inputWhat: 'images',
  what: 'The image conversion',
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  schema: {
    required: ['to'],
    properties: {
      to: { type: 'string', enum: ['png', 'jpg', 'jpeg', 'webp', 'avif', 'tiff'], description: 'Target format.' },
    },
  },
  buildArgv: (args) => flags([['--to', args.to]]),
});

const resizeImg = scriptTool({
  name: 'resize_img',
  title: 'Batch resize images',
  description:
    'Resize images by width, height or percentage scale. Never upscales — an image already smaller ' +
    'than the target is left alone. Give exactly one of width, height or scale.',
  command: { node: 'resize-img/index.js' },
  stageDir: 'resize-img',
  inputWhat: 'images',
  what: 'The resize',
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  schema: {
    properties: {
      width: { type: 'integer', minimum: 1, description: 'Target width in pixels.' },
      height: { type: 'integer', minimum: 1, description: 'Target height in pixels.' },
      scale: { type: 'integer', minimum: 1, maximum: 100, description: 'Scale as a percentage of the original.' },
    },
  },
  buildArgv: (args) => {
    const given = ['width', 'height', 'scale'].filter((key) => args[key] !== undefined);
    if (given.length !== 1) {
      throw new Error(`Give exactly one of width, height or scale (got ${given.length === 0 ? 'none' : given.join(' and ')}).`);
    }
    return flags([
      ['--width', args.width],
      ['--height', args.height],
      ['--scale', args.scale],
    ]);
  },
});

const stripExif = scriptTool({
  name: 'strip_exif',
  title: 'Remove image metadata',
  description:
    'Strip EXIF, GPS and XMP metadata from images. Orientation is preserved by rotating the pixels ' +
    'before the tag is dropped, so nothing ends up sideways.',
  command: { node: 'strip-exif/index.js' },
  stageDir: 'strip-exif',
  inputWhat: 'images',
  what: 'The metadata strip',
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  schema: { properties: {} },
  buildArgv: () => [],
});

const removeImgBg = scriptTool({
  name: 'remove_img_bg',
  title: 'Remove image backgrounds',
  description:
    'Remove the background from images with @imgly/background-removal, writing transparent PNGs. ' +
    'Runs a segmentation model on CPU, so it is slow — expect seconds per image, and use a job id ' +
    'rather than waiting on a large batch.',
  command: { npm: 'remove-img-bg:process' },
  stageDir: 'remove-img-bg',
  inputWhat: 'images',
  what: 'The background removal',
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  schema: { properties: {} },
  buildArgv: () => [],
});

const imgToPdf = scriptTool({
  name: 'img_to_pdf',
  title: 'Merge images into one PDF',
  description: 'Merge every image in a folder into a single PDF, one page per image, sized to the image.',
  command: { node: 'img-to-pdf/images-to-pdf.js' },
  what: 'The PDF build',
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  schema: {
    required: ['input_dir'],
    properties: {
      input_dir: { type: 'string', minLength: 1, description: 'Absolute path to the folder of images.' },
      output_dir: { type: 'string', description: 'Where the PDF goes. Defaults to img-to-pdf/out/.' },
    },
  },
  // This one already takes its folders positionally, so it needs no staging.
  buildArgv: (args) => [
    path.resolve(REPO_ROOT, args.input_dir),
    path.resolve(REPO_ROOT, args.output_dir || path.join(REPO_ROOT, 'img-to-pdf', 'out')),
  ],
  summarise: ({ args }) => ({
    output_dir: path.resolve(REPO_ROOT, args.output_dir || path.join(REPO_ROOT, 'img-to-pdf', 'out')),
  }),
});

module.exports = [
  getAudio,
  extractAudio,
  compressVideo,
  videoToGif,
  compressImg,
  convertImg,
  resizeImg,
  stripExif,
  removeImgBg,
  imgToPdf,
];
