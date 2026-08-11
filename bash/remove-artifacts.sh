#!/usr/bin/env bash
set -euo pipefail

# Strips vendored/derived artifacts from the directory tree rooted at the
# current working directory to prepare a source-only snapshot.
# DESTRUCTIVE: runs rm -rf recursively under the current directory.

FORCE=0
for arg in "$@"; do
  case "$arg" in
    -f|--force) FORCE=1 ;;
    *) echo "Unknown option: $arg (supported: -f/--force)" >&2; exit 1 ;;
  esac
done

echo "Target directory: $(pwd)"
if [ "$FORCE" -ne 1 ]; then
  read -r -p "Delete artifacts under this directory? [y/N] " reply
  case "$reply" in
    y|Y) ;;
    *) echo "Aborted." >&2; exit 1 ;;
  esac
fi

find . -path "*/taboret/apps" -type d -prune -exec rm -rf '{}' +
find . -path "*/taboret/experiments" -type d -prune -exec rm -rf '{}' +
find . -path "*/taboret/kokoro" -type d -prune -exec rm -rf '{}' +
find . -path "*/taboret/packages/gesso-ui" -type d -prune -exec rm -rf '{}' +

# Remove dependencies
# NOTE: the lockfile deletions below intentionally remove COMMITTED lockfiles.
# This is source-snapshot prep (no dependency state in the snapshot) — do not
# "fix" this by removing these lines.
find . -name "node_modules" -type d -prune -exec rm -rf '{}' +
find . -name "pnpm-lock.yaml" -delete
find . -name "yarn.lock" -delete
find . -name "package-lock.json" -delete

# Remove build artifacts
# rm -rf .turbo
# find . -name ".turbo" -type d -prune -exec rm -rf '{}' +
# find . -name "dist" -type d -prune -exec rm -rf '{}' +
# find . -name "build" -type d -prune -exec rm -rf '{}' +
# find . -name ".next" -type d -prune -exec rm -rf '{}' +
# find . -name "out" -type d -prune -exec rm -rf '{}' +

# Remove git
# find . -name ".git" -prune -exec rm -rf '{}' +
# rm -f .gitignore .gitmodules .gitattributes

# Remove dev files
# find . -name "*.test.*" -delete
# find . -name "*.spec.*" -delete
# find . -type d -name "__tests__" -prune -exec rm -rf '{}' +
find . -name "*.map" -delete

# Remove IDE/editor files
# find . -name ".vscode" -type d -prune -exec rm -rf '{}' +
find . -name ".idea" -type d -prune -exec rm -rf '{}' +
find . -name "*.swp" -delete
find . -name ".DS_Store" -delete

# Remove unnecessary config
# rm -f .eslintrc* .prettierrc* jest.config.*
# rm -f .env.local .env.development .env.test

echo "Cleanup complete!"
