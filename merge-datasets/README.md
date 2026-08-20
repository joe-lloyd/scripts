# merge-datasets

Gathers the character datasets produced by `scrape-booru` and `scrape-wiki` into
one place, `out/<character>/` — a single folder per character, both sources
combined, ready to point a trainer at.

Sources are only ever read. Delete a bad image from its character folder and
re-run — that is the intended way to correct the merge.

## Requirements

Node 18+. No dependencies beyond the standard library.

## Usage

```
npm run merge-datasets:merge
```

```
out/
  shadowheart/
    Shadowheart_grief.jpg
    Shadowheart_grief.txt
    ...
  tifa_lockhart/
    10167384.jpg
    10167384.txt
    ...
```

| Flag | Default | What it does |
|---|---|---|
| `--out <dir>` | `out/` | Write somewhere else |
| `--per-character <n>` | 0 (all) | Cap how many images each character contributes |
| `--only <a,b,c>` | all | Merge just these characters (substring match) |
| `--repeats <n>` | 0 | Prefix folders `<n>_` for kohya repeat counts |
| `--flat` | off | Put everything in one folder instead |
| `--clean` | off | Empty the output folder first |

## Layouts

One folder per character is the default. kohya and sd-scripts read a leading
number on a folder as "repeat this many times per epoch", so for a multi-concept
LoRA:

```
npm run merge-datasets:merge -- --repeats 10 --per-character 30
```

```
out/
  10_shadowheart/
  10_tifa_lockhart/
```

`--flat` puts every image in one directory instead, prefixed with its character
(`shadowheart__Shadowheart_grief.jpg`) so a booru post id cannot collide with a
wiki file name. Useful for a single-concept run, or a trainer that just wants a
pile of image/caption pairs.

## Notes

- **One character, two folders.** A character usually has a folder from each
  tool, and the names rarely match: the booru tag carries the series
  (`shadowheart__baldur_s_gate` against the wiki's `shadowheart`), and the two
  sources disagree about Japanese name order — boorus file surname-first
  (`fujibayashi_kyou`, `gasai_yuno`, `shimizu_hinako`) while the wikis use
  given-name-first. Both cases are matched and merged under the shorter name,
  which also makes the better trigger word.
- **Caption pairs travel together.** An image whose `.txt` is missing is still
  copied, but reported in the summary — an uncaptioned image in an otherwise
  captioned set trains poorly, so it is worth chasing.
- **Byte-identical duplicates are skipped**, by sha1, so the same file appearing
  in two character folders lands once.
- Re-running is incremental: files already in the output are left alone. Use
  `--clean` to rebuild from scratch after deleting things from the sources.
- Folders starting with `_` are ignored — that is where the contact sheets and
  quarantined files live, not datasets.
