# scrape-booru

Builds a character image dataset for LoRA training from Gelbooru. Run it, type a
character name, pick the tag it means, and the images land in `out/<character>/`
with one `.txt` caption file per image — the layout kohya_ss / sd-scripts expect.

Only pull material you have the rights to train on, and keep the volume sane —
this is one image at a time with a pause between, on purpose.

## Requirements

Node 18+ and the repo root `npm install` (uses sharp for the size cap; `--crop`
also uses TensorFlow.js, a plain npm package with nothing to compile).

## Usage

From the repo root:

```
npm run scrape-booru:scrape
```

It then asks, in order:

1. **Which character?** — searches Gelbooru's tag list and shows matching tags with
   their post counts, so you pick the exact tag rather than guessing the spelling
   (`2b_(nier:automata)`, not `2b`). Nothing matching? It just asks again.
2. **How many images?** — default 40.
3. **Content rating** — general only (default), general + sensitive, or any.
4. **Order** — highest score first (default) or newest first.

Then it confirms the query and downloads.

Skip the questions entirely by passing a tag:

```
npm run scrape-booru:scrape -- --tag hatsune_miku --limit 60
npm run scrape-booru:scrape -- --tag makima_(chainsaw_man) --rating any --sort newest
npm run scrape-booru:scrape -- --tag ganyu_(genshin_impact) --extra "solo simple_background -comic"
```

| Flag | Default | What it does |
|---|---|---|
| `--tag <name>` | asked | Character tag; supplying it runs non-interactively |
| `--limit <n>` | 40 | How many images to fetch (1–1000) |
| `--rating general\|safe\|any` | `general` | `safe` means general + sensitive |
| `--style any\|official\|3d\|real` | `any` | Narrow towards official art / 3D renders |
| `--sort score\|newest` | `score` | Post ordering |
| `--extra "<tags>"` | `solo -comic` | Extra query tags; `--extra ""` clears them |
| `--out <dir>` | `out/<tag>/` | Write somewhere else |
| `--max-size <px>` | 1024 | Cap the short side; `0` keeps the booru original |
| `--no-captions` | off | Skip the `.txt` caption files |
| `--crop` | off | Crop out a second person when one is in frame |
| `--resize-only` | off | Crop/cap images already on disk, no downloading |

## Art style

Gelbooru is fan art by default, which for a game character means a lot of anime
styling regardless of how the character actually looks. `--style` narrows the
query to Gelbooru's own official-art tags:

| `--style` | Tags added |
|---|---|
| `any` (default) | none |
| `official` | `{official_art ~ game_cg ~ screenshot}` |
| `3d` | `{3d ~ screenshot}` |
| `real` | `{3d ~ official_art ~ game_cg ~ screenshot}` |

How much this leaves depends entirely on the character. Measured post counts:
`tifa_lockhart` keeps 1,690 with `--style real`, `princess_peach` 60, but
`panam_palmer` 25, `judy_alvarez` 13 and `shadowheart_(baldur's_gate)` 7. For
anyone outside the A-list, `scrape-wiki` is the better source of in-game looks —
this flag is a refinement, not a replacement.

## Size cap

Booru originals run to 3000-4000px and tens of MB a folder, which trainers
discard and upload endpoints reject with HTTP 413. Every image is therefore
capped on the way in: short side to 1024, long side to 1536, re-encoded as JPEG
q92, never upscaled. In practice a 40-image set lands around 10-15 MB instead of
280 MB.

Sets downloaded before, or with a bigger cap than you want now, are fixed in
place — no downloading, no credentials needed:

```
npm run scrape-booru:scrape -- --resize-only                  # every folder in out/
npm run scrape-booru:scrape -- --resize-only --max-size 768   # smaller, for a tighter limit
npm run scrape-booru:scrape -- --resize-only --out scrape-booru/out/bowsette
```

It skips images already within the cap, so running it twice costs nothing and
never re-compresses the same file. Folders whose name starts with `_` are left
alone. `--max-size 0` on a download keeps the full-resolution original.

## Cropping out extra people

`--crop` finds the faces in an image, keeps the largest, and crops so the frame
stops short of any other face — for art with a second character in shot, which
otherwise teaches the LoRA the wrong face:

```
npm run scrape-booru:scrape -- --tag "yuna_(ff10)" --crop
npm run scrape-booru:scrape -- --resize-only --crop
```

It leaves an image alone unless there are two or more faces and the second is
big enough to be a subject, so it is safe to run over a whole folder, and
running it twice changes nothing the second time. It is best-effort — a real-
face detector against illustration misses faces in profile or in shadow — so
check the results (`npm run scrape-wiki:sheet` lays a folder out as one
numbered grid).

## Output

```
out/hatsune_miku/
  10422339.jpg        image, named after its Gelbooru post id (capped, JPEG)
  10422339.txt        caption: "hatsune miku, 1girl, twintails, ..."
  manifest.json       post id, score, rating and source URL for every image
```

## Notes

- Captions are comma-separated with underscores turned into spaces, and the
  character tag comes first so it works as the trigger word.
- Files are named after the post id and existing ones are skipped, so rerunning
  tops a dataset up instead of re-downloading it. Raise `--limit` and run again
  to grow it; the manifest keeps entries from previous runs.
- Video and animated posts (mp4/webm/gif) are filtered out — only png, jpg, jpeg
  and webp are kept. Capping re-encodes them all to JPEG, so a `.png` becomes a
  `.jpg` (the caption keeps the same stem, and the manifest follows the rename).
- Queries over 100 images page automatically. A narrow tag combination simply
  returns fewer images than asked for and says so.
- Downloads retry three times with a backoff; a partial file is written as
  `.part` and only renamed once complete, so an interrupted run never leaves a
  truncated image behind. Failures are logged, the batch continues, and the exit
  code is 1 if anything failed.
- Every download is checked against the JPEG/PNG/WebP/GIF magic bytes before it
  is kept. Gelbooru's image hosts answer a request without a `Referer` header
  with an HTML "Image View" page and a 200 status, which otherwise saves happily
  as a `.jpg` that nothing can open — the tool sends the referer, and refuses to
  write anything that is not an image. A rerun also re-checks files already on
  disk and replaces any that fail that test.
- **API credentials:** anonymous requests work but are rate-limited, and Gelbooru
  sometimes refuses them outright (you will see a "non-JSON response" error). Get
  a key from Gelbooru's Account Options → API Access Credentials and set both:

  ```powershell
  $env:GELBOORU_API_KEY = "..."
  $env:GELBOORU_USER_ID = "..."
  ```
