# strip-exif

Removes all metadata (EXIF, GPS location, XMP, IPTC) from images so you can share photos without leaking where or when they were taken. Drop images in, get clean same-format copies out.

## Requirements

Run `npm install` at the repo root (uses sharp).

## Usage

1. Drop images into `in/`
2. From the repo root run: `npm run strip-exif:strip`
3. Clean copies appear in `out/`

## Notes

Orientation is preserved: the EXIF Orientation tag is applied by physically rotating the pixels before the tag is stripped, so photos never come out sideways. Images are re-encoded in their original format at high quality (JPEG 95 with mozjpeg, WebP 95, AVIF 70, PNG/TIFF defaults). Original files in `in/` are never modified.
