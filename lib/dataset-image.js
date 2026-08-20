/**
 * Shared image-dataset plumbing for the scraper tools (scrape-booru,
 * scrape-wiki).
 *
 * Both tools face the same two problems, so they solve them in one place here:
 *
 *   1. A download that answers HTTP 200 with something that is not an image.
 *      Booru and wiki hosts alike serve interstitials, hotlink guards and error
 *      pages with a success status, and an HTML page saved as "1234.jpg" only
 *      announces itself when the trainer chokes on it. Every download is
 *      therefore checked against the image magic bytes before it is kept.
 *
 *   2. Originals far larger than any trainer uses — thousands of pixels a side,
 *      hundreds of MB a folder, and HTTP 413 from upload endpoints. Every image
 *      is capped on the way in.
 */

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const MAX_RETRIES = 3;
const RETRY_BACKOFF_MS = 500;

// Cap geometry: short side to MAX_SIZE, long side to 1.5x that, so a tall
// image cannot stay huge just by being narrow.
const LONG_SIDE_FACTOR = 1.5;
const JPEG_QUALITY = 92;

/**
 * Does this start with a JPEG/PNG/WebP/GIF signature? Extensions, content types
 * and status codes all lie here, so the bytes get the final say.
 */
function looksLikeImage(buffer) {
  if (buffer.length < 12) return false;
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return true; // jpeg
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return true; // png
  if (buffer.subarray(0, 4).toString('latin1') === 'RIFF' && buffer.subarray(8, 12).toString('latin1') === 'WEBP') return true;
  if (buffer.subarray(0, 3).toString('latin1') === 'GIF') return true;
  return false;
}

/**
 * The file for this stem that is already on disk, or null. Capping rewrites a
 * .png as a .jpg, so "have I got this one already?" cannot be answered by the
 * source extension alone — miss this and every PNG re-downloads on every run.
 */
function findExisting(dir, stem, ext) {
  const candidates = [path.join(dir, `${stem}${ext}`), path.join(dir, `${stem}.jpg`)];
  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

/** True when a file on disk is a real image (used to spot earlier bad saves). */
function fileLooksLikeImage(filePath) {
  let handle;
  try {
    handle = fs.openSync(filePath, 'r');
    const header = Buffer.alloc(12);
    const read = fs.readSync(handle, header, 0, 12, 0);
    return looksLikeImage(header.subarray(0, read));
  } catch {
    return false;
  } finally {
    if (handle !== undefined) fs.closeSync(handle);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Download one image, retrying transient failures with a backoff. Writes to a
 * .part file first so an interrupted run never leaves a truncated image that a
 * later run would skip as "already downloaded". Returns the byte count.
 */
async function downloadImage(url, destPath, { headers = {}, retries = MAX_RETRIES } = {}) {
  const partPath = `${destPath}.part`;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url, { headers });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }
      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.length === 0) {
        throw new Error('empty response body');
      }
      if (!looksLikeImage(buffer)) {
        throw new Error(
          `the server sent ${buffer.length} bytes that are not an image ` +
            '(usually a hotlink guard or an error page) — not saving it'
        );
      }
      fs.writeFileSync(partPath, buffer);
      fs.renameSync(partPath, destPath);
      return buffer.length;
    } catch (err) {
      fs.rmSync(partPath, { force: true });
      if (attempt === retries) throw err;
      await sleep(RETRY_BACKOFF_MS * attempt);
    }
  }

  // Unreachable: the last attempt either returns or throws.
  throw new Error('download failed');
}

/**
 * Cap one image at maxSize on its short side (and 1.5x that on its long side),
 * re-encoding it as JPEG. Never upscales. Returns what changed, including the
 * new path — a .png becomes a .jpg, so the caller can follow the rename.
 *
 * The result is written beside the original and swapped in only once it is
 * complete, so an interrupted run cannot destroy the source image.
 */
async function capImage(filePath, maxSize, { quality = JPEG_QUALITY } = {}) {
  const before = fs.statSync(filePath).size;
  // Read the bytes rather than handing sharp a path: on Windows libvips keeps
  // the input file open past the call, and a .png cannot then be replaced by
  // its .jpg (EBUSY).
  const source = fs.readFileSync(filePath);
  const meta = await sharp(source).metadata();
  if (!meta.width || !meta.height) {
    throw new Error('could not read the image dimensions');
  }

  const shortSide = Math.min(meta.width, meta.height);
  const longSide = Math.max(meta.width, meta.height);
  const scale = Math.min(1, maxSize / shortSide, (maxSize * LONG_SIDE_FACTOR) / longSide);
  const unchanged = { changed: false, filePath, before, after: before, width: meta.width, height: meta.height };

  // Nothing to gain from re-encoding a JPEG that is already within the cap.
  if (scale === 1 && meta.format === 'jpeg') return unchanged;

  const width = Math.max(1, Math.round(meta.width * scale));
  const height = Math.max(1, Math.round(meta.height * scale));

  const destPath = path.join(path.dirname(filePath), `${path.parse(filePath).name}.jpg`);
  const partPath = `${destPath}.part`;

  try {
    await sharp(source)
      .rotate()
      .resize({ width, height, fit: 'fill', withoutEnlargement: true })
      // Booru and wiki PNGs often carry transparency; training wants opaque pixels.
      .flatten({ background: '#ffffff' })
      .jpeg({ quality, mozjpeg: true })
      .toFile(partPath);

    // Flat-colour PNGs sometimes re-encode larger than they started. If nothing
    // was downscaled either, the original is simply the better file.
    if (scale === 1 && fs.statSync(partPath).size >= before) {
      fs.rmSync(partPath);
      return unchanged;
    }

    if (filePath !== destPath) fs.rmSync(filePath);
    fs.renameSync(partPath, destPath);
  } catch (err) {
    fs.rmSync(partPath, { force: true });
    throw err;
  }

  return { changed: true, filePath: destPath, before, after: fs.statSync(destPath).size, width, height };
}

// ---- Cropping out extra people -----------------------------------------------

// Loaded lazily (require() takes real time) and only once, so a run that never
// asks for --crop never pays for it.
let faceModelPromise = null;

function loadFaceModel() {
  if (!faceModelPromise) {
    // Pure-JS TensorFlow backend: no native addon to compile, so it installs
    // and runs the same on Windows/macOS/Linux. Slower than tfjs-node, which
    // is fine for a batch tool running over a few dozen images at a time.
    const tf = require('@tensorflow/tfjs');
    const blazeface = require('@tensorflow-models/blazeface');
    faceModelPromise = blazeface.load().then((model) => ({ tf, model }));
  }
  return faceModelPromise;
}

/** How much two boxes overlap, 0 to 1, as intersection over union. */
function overlap(a, b) {
  const x = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const y = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  const intersection = x * y;
  const union = a.width * a.height + b.width * b.height - intersection;
  return union > 0 ? intersection / union : 0;
}

async function detectIn(tf, model, buffer, minConfidence) {
  const { data, info } = await sharp(buffer).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const tensor = tf.tensor3d(data, [info.height, info.width, 3], 'int32');
  let predictions;
  try {
    predictions = await model.estimateFaces(tensor, false);
  } finally {
    tensor.dispose();
  }

  return predictions
    .map((p) => ({
      x: p.topLeft[0],
      y: p.topLeft[1],
      width: p.bottomRight[0] - p.topLeft[0],
      height: p.bottomRight[1] - p.topLeft[1],
      confidence: Array.isArray(p.probability) ? p.probability[0] : p.probability,
    }))
    .filter((f) => f.confidence >= minConfidence && f.width > 0 && f.height > 0);
}

/**
 * Faces in an image as {x, y, width, height, confidence, rotation}, most
 * confident first. Coordinates are always in the original image's frame.
 *
 * The detector only recognises upright faces, so the image is also checked
 * upside down: promotional art in particular likes to invert one character,
 * and such a face is invisible at 0 degrees at any confidence threshold.
 * `rotation` records which pass found it — 180 means the face is upside down
 * in the file as it stands.
 */
async function detectFaces(filePath, { minConfidence = 0.7, rotations = [0, 180] } = {}) {
  const { tf, model } = await loadFaceModel();
  const source = fs.readFileSync(filePath);
  const meta = await sharp(source).metadata();

  const found = [];
  for (const rotation of rotations) {
    const buffer = rotation === 0 ? source : await sharp(source).rotate(rotation).toBuffer();
    const faces = await detectIn(tf, model, buffer, minConfidence);

    for (const face of faces) {
      // Map back into the original frame so every caller sees one coordinate space.
      const mapped =
        rotation === 180
          ? {
              ...face,
              x: meta.width - face.x - face.width,
              y: meta.height - face.y - face.height,
            }
          : face;
      mapped.rotation = rotation;

      // The same face can surface in more than one pass; keep the upright
      // reading, which is the one whose crop needs no rotating.
      const duplicate = found.find((f) => overlap(f, mapped) > 0.3);
      if (!duplicate) {
        found.push(mapped);
      } else if (duplicate.rotation !== 0 && mapped.rotation === 0) {
        Object.assign(duplicate, mapped);
      }
    }
  }

  return found.sort((a, b) => b.confidence - a.confidence);
}

/**
 * If a second person is in frame, crop down to just the main character —
 * assumed to be whoever has the largest face, which holds up well for a
 * character-focused shot with a smaller companion or background NPC.
 *
 * Left alone (changed: false) whenever there is nothing to decide: zero or
 * one face found, or every other face too small to be a real second subject
 * (minSecondaryAreaRatio) rather than a background extra. This is a real-face
 * detector run against game renders and illustration, so it is best-effort —
 * it can miss a face in profile, in shadow, or tucked in close beside the
 * kept one — not a guarantee every extra person is gone. The generous padding
 * below is a full-body-portrait guess, not a measurement, so check the result.
 */
async function cropToMainCharacter(filePath, opts = {}) {
  const {
    minConfidence = 0.7,
    minSecondaryAreaRatio = 0.15,
    padTop = 1.2,
    padBottom = 5,
    padSide = 2.2,
  } = opts;

  const meta = await sharp(fs.readFileSync(filePath)).metadata();
  const faces = await detectFaces(filePath, { minConfidence });

  if (faces.length < 2) {
    return { changed: false, faces: faces.length, reason: faces.length === 0 ? 'no face detected' : 'only one face' };
  }

  const [main, ...rest] = [...faces].sort((a, b) => b.width * b.height - a.width * a.height);
  const others = rest.filter((f) => f.width * f.height >= main.width * main.height * minSecondaryAreaRatio);
  if (others.length === 0) {
    return { changed: false, faces: faces.length, reason: 'other face(s) too small to be a second person' };
  }

  const centerX = main.x + main.width / 2;
  const top = Math.max(0, main.y - main.height * padTop);
  const bottom = Math.min(meta.height, main.y + main.height + main.height * padBottom);
  let left = Math.max(0, centerX - main.width / 2 - main.width * padSide);
  let right = Math.min(meta.width, centerX + main.width / 2 + main.width * padSide);

  // The padding above is a generous full-body guess and routinely reaches back
  // across the frame into where the excluded face actually is — on a wide
  // screenshot the "padded" box can cover the whole width before it's pulled
  // back here. So the one hard constraint is the face itself: never let an
  // edge cross into another kept-out face's box, whatever the padding wanted.
  const margin = main.width * 0.15;
  for (const other of others) {
    const otherCenterX = other.x + other.width / 2;
    if (otherCenterX < centerX) {
      left = Math.max(left, other.x + other.width + margin);
    } else {
      right = Math.min(right, other.x - margin);
    }
  }

  // Clamping to another face's edge can march straight past the face we meant
  // to keep — when the two overlap horizontally, "stop before the other face"
  // and "keep this one whole" are contradictory, and the crop silently returns
  // a sliver of hair with the subject's face cut off. The kept face has to
  // survive intact or there is no point cropping at all.
  if (left > main.x || right < main.x + main.width) {
    return { changed: false, faces: faces.length, reason: 'faces overlap horizontally — no clean crop exists' };
  }
  if (right - left < main.width) {
    return { changed: false, faces: faces.length, reason: 'other face is too close to crop around cleanly' };
  }

  const width = Math.round(right - left);
  const height = Math.round(bottom - top);

  // Not worth a re-encode if the crop barely trims the image.
  if (width >= meta.width * 0.92 && height >= meta.height * 0.92) {
    return { changed: false, faces: faces.length, reason: 'crop region is nearly the whole image' };
  }

  const format = meta.format === 'png' || meta.format === 'webp' ? meta.format : 'jpeg';
  const partPath = `${filePath}.part`;
  try {
    await sharp(fs.readFileSync(filePath))
      .extract({ left: Math.round(left), top: Math.round(top), width, height })
      // A face only the upside-down pass could see is upside down in the file;
      // turn the crop the right way up rather than keeping a useless frame.
      .rotate(main.rotation ? 360 - main.rotation : 0)
      // Match the cap's quality: sharp defaults JPEG to 80, and a crop followed
      // by a cap would otherwise re-encode 80-then-92 and lose detail for no
      // reason on an image that was only meant to be trimmed.
      .toFormat(format, format === 'jpeg' ? { quality: JPEG_QUALITY, mozjpeg: true } : {})
      .toFile(partPath);
    fs.renameSync(partPath, filePath);
  } catch (err) {
    fs.rmSync(partPath, { force: true });
    throw err;
  }

  return { changed: true, filePath, faces: faces.length, kept: 1, width, height };
}

/**
 * Measure how much of an image is flat background, as two fractions: pixels
 * that are essentially black, and the share taken by the single most common
 * colour.
 *
 * Wikis are full of composite plates — dye charts, item grids, sprite sheets —
 * laid out on a black backdrop, and they are poison in a training set. They
 * read very differently from a real screenshot: measured over one character's
 * BG3 images, the dye chart came out 63% near-black while every genuine
 * screenshot sat at 5% or less.
 *
 * A high dominant-colour share on its own is not damning — an official render
 * cut out on white is exactly what you want — so callers should treat that as
 * something to look at rather than something to drop.
 */
async function measureBackground(filePath) {
  const { data, info } = await sharp(fs.readFileSync(filePath))
    .resize(64, 64, { fit: 'fill' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const counts = new Map();
  let nearBlack = 0;

  for (let i = 0; i < data.length; i += 3) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    if (Math.max(r, g, b) < 16) nearBlack++;
    // Quantise to 16 levels a channel so near-identical background pixels count
    // as one colour rather than a thousand.
    const key = `${r >> 4}_${g >> 4}_${b >> 4}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }

  const pixels = info.width * info.height;
  return { nearBlack: nearBlack / pixels, dominant: Math.max(...counts.values()) / pixels };
}

module.exports = {
  JPEG_QUALITY,
  LONG_SIDE_FACTOR,
  looksLikeImage,
  fileLooksLikeImage,
  findExisting,
  downloadImage,
  capImage,
  measureBackground,
  detectFaces,
  cropToMainCharacter,
};
