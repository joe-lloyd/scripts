# scrape-wiki

Builds a character image dataset from a game wiki — official renders,
promotional art and in-game screenshots, i.e. the character as the game actually
draws them. The companion to `scrape-booru`, which is fan art by construction and
drifts towards anime styling for characters that are not drawn that way.

Anything running MediaWiki works, because they all expose the same `api.php`:
Fandom, wiki.gg, bg3.wiki, mariowiki.com.

Wiki images are copyrighted game assets. What you train on them is your call.

## Requirements

Node 18+ and the repo root `npm install` (uses sharp; `--crop` also uses
TensorFlow.js, which installs as a plain npm package with nothing to compile).
No API key.

## Usage

```
npm run scrape-wiki:scrape
```

It asks which wiki (five presets, or type any address), then the character —
searching the wiki so you pick a real page rather than guessing the title — then
how many images, then confirms.

Non-interactive:

```
npm run scrape-wiki:scrape -- --wiki bg3.wiki --page Shadowheart
npm run scrape-wiki:scrape -- --wiki cyberpunk.fandom.com --page "Panam Palmer" --limit 25
npm run scrape-wiki:scrape -- --wiki eldenring.wiki.gg --page Ranni --min-size 768
```

| Flag | Default | What it does |
|---|---|---|
| `--wiki <host>` | asked | `bg3.wiki`, `cyberpunk.fandom.com`, or a full `api.php` URL |
| `--page <title>` | asked | Exact article title; needs `--wiki` too |
| `--character <name>` | from page title | Folder name and caption trigger word |
| `--limit <n>` | 40 | How many images to keep (1–500) |
| `--min-size <px>` | 512 | Reject images smaller than this on the short side |
| `--max-size <px>` | 1024 | Cap the short side; `0` keeps the wiki original |
| `--out <dir>` | `out/<character>/` | Write somewhere else |
| `--caption "<text>"` | `official art` | Caption text after the character name |
| `--no-captions` | off | Skip the `.txt` caption files |
| `--crop` | off | Crop out a second person when one is in frame |
| `--resize-only` | off | Crop/cap images already on disk, no downloading |

## What it filters out

A wiki holds far more furniture than art — icons, UI chrome, item sprites,
equipment charts — so candidates are filtered before and after downloading:

- **Wrong format** — only jpeg, png and webp.
- **Too small** — under `--min-size` on the short side.
- **Banner-shaped** — anything past 3:1.
- **File name** — `icon`, `logo`, `map`, `sprite`, `dyed`, `swatch`, `comparison`,
  and similar. `concept`, `render`, `portrait` and `promotional` are kept.
- **Byte-identical duplicates**, by the wiki's own sha1.
- **Composite plates** — measured after download, not guessed from the name. An
  image whose backdrop is more than 40% near-black is an item grid or sprite
  sheet, and is discarded. (One real example: a BG3 dye chart measured 63%
  near-black; every genuine screenshot of that character measured 5% or less.)
  An image that is over half one flat colour is *kept* but flagged in the log —
  that is usually an official render cut out on white, which is exactly what you
  want, but occasionally a composite.

It typically halves-to-thirds the candidate list. Have a look through the folder
before training anyway: a screenshot can legitimately contain two characters, or
show yours from too far away, and no filter here can tell.

## Cropping out extra people

Wiki screenshots often catch a companion or an NPC in frame, which teaches a
LoRA the wrong face. `--crop` detects faces, keeps the largest one — the shot's
subject, in practice — and crops so the frame stops short of any other face:

```
npm run scrape-wiki:scrape -- --wiki bg3.wiki --page Shadowheart --crop
npm run scrape-wiki:scrape -- --resize-only --crop            # every folder in out/
npm run scrape-wiki:scrape -- --resize-only --crop --out scrape-booru/out/yuna__ff10
```

It only acts when there is a real decision to make: two or more faces, with the
second big enough to be a subject rather than a background extra. One face, no
face, or a crop that would barely trim anything leaves the file untouched, and
running it twice changes nothing the second time.

The image is also checked upside down, because the detector only recognises
upright faces and promotional art likes to invert one character. A face found
only in that pass is upside down in the file, so the crop is turned the right
way up as it is written — which is what rescued a Yuna/Tidus piece where Yuna
was inverted and therefore invisible to the detector at any confidence
threshold.

Treat it as best-effort. Against game renders and illustration it still misses
faces in profile, in shadow, or pressed close to the kept one — a two-person
shot can come back reporting one face and go through uncropped. The padding
around the kept face is a full-body guess, not a measurement. Check the contact
sheet afterwards.

### When detection cannot help

Some frames have no detectable second face at all: background dancers lit from
behind, a companion turned away, someone whose head is out of shot. For those,
crop by hand:

```
npm run scrape-wiki:crop -- scrape-wiki/out/yuna/Yuna-tidus-love.jpg right:53% top:12%
npm run scrape-wiki:crop -- scrape-wiki/out/yuna/dancers.jpg box:400,0,225,575
```

Specs apply left to right: `right:40%`, `left:10%`, `top:5%`, `bottom:12%`,
`center:60%`, or `box:x,y,w,h`. It edits in place via a `.part` file and
re-encodes JPEG at the same quality as the cap.

Worth checking what the crop leaves you: trimming a distant group shot down to
one character can produce a 225px-wide strip whose face is only ~50px across,
which is too small to train on. Deleting that image beats keeping a bad crop of
it.

## Reviewing a pull

Judging 40 images one file at a time is miserable, so lay them out as one
numbered grid:

```
npm run scrape-wiki:sheet -- scrape-wiki/out/shadowheart scrape-wiki/out/_review/sheet.jpg
```

The numbers printed to the terminal match the cells, so a bad cell maps
straight to the file to delete (remove the image and its `.txt`; the manifest
prunes itself on the next run). Folders starting with `_` are skipped by
`--resize-only`, so `out/_review/` is a safe place to keep sheets.

## Output

Identical in shape to `scrape-booru`, so both can feed one training run:

```
out/shadowheart/
  Shadowheart_grief.jpg      named after the wiki's file page
  Shadowheart_grief.txt      caption: "Shadowheart, official art"
  manifest.json              source page, dimensions, licence and credit per image
```

## Notes

- Expect tens of images, not hundreds — wikis are far smaller than boorus. Three
  angles are searched to make the most of them: the article's own images, its
  `/Gallery` subpage, and a file-namespace search on the title.
- The file-namespace search uses the bare character name, not the full page
  title: searching `Yuna (Final Fantasy X-2 party member)` makes "Final Fantasy
  X-2", "party" and "member" search terms too, which on a big franchise wiki
  matches almost anything — measured on that page, roughly one result in seven
  was actually Yuna. Searching `Yuna` alone found more real candidates and far
  less noise.
- Requests are paced at one a second. Wikis answer bursts with an HTML challenge
  page instead of JSON; if you still hit it, the tool says so and waiting a
  minute clears it.
- Files are named after the wiki file page and existing ones are skipped, so
  rerunning tops a dataset up. A file on disk that is not a valid image gets
  replaced rather than skipped.
- Captions here are `<character>, official art` rather than a tag list, since a
  wiki has no tags. Keep this dataset in its own folder if you want to train the
  in-game look separately from the booru fan art, or caption both with a style
  word so you can steer between them.
- The manifest records each image's source page, licence and credit where the
  wiki provides them.
