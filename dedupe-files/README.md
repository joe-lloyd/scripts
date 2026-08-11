# dedupe-files

Finds duplicate files in a folder tree by content (SHA-256) and reports how much space the redundant copies waste. Optionally relocates the duplicates into `out/duplicates/` — it never deletes anything.

## Requirements

None — plain Node, no packages.

## Usage

1. Drop files/folders into `in/` (or point it at any folder)
2. From the repo root run: `npm run dedupe-files:scan` (or `npm run dedupe-files:scan -- "C:\some\folder"`, add `-- --move` to relocate duplicates)
3. Report appears in the console and `out/dedupe-report.txt`; with `--move`, duplicates land in `out/duplicates/`

## Notes

- Read-only by default: without `--move` the scan touches nothing except the report file, and even `--move` only relocates files — nothing is ever deleted.
- Keep-first rule: within each duplicate group the paths are sorted (shortest path first, then alphabetical) and the first one is marked `[keep]`; only the `[dup]` entries are moved.
- Size-then-hash strategy: files are grouped by byte size first, and only groups with more than one member are SHA-256 hashed (streamed, so large files are never loaded into memory).
- Skipped during the scan: `.gitkeep` files, symlinks, and any directory named `node_modules`, `.git`, `archive`, or `temp`.
