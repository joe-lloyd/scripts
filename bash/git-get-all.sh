#!/usr/bin/env bash
set -euo pipefail

# Get directory of this script (works even if run from elsewhere)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="${SCRIPT_DIR}/config.env"

# Load configuration
if [[ ! -f "$CONFIG_FILE" ]]; then
  echo "❌ Config file not found at $CONFIG_FILE" >&2
  exit 1
fi
# shellcheck disable=SC1090
source "$CONFIG_FILE"

if [[ -z "${REPO_URL:-}" ]]; then
  echo "❌ REPO_URL not defined in config" >&2
  exit 1
fi

if [[ -z "${AFTER_DATE:-}" ]]; then
  echo "❌ AFTER_DATE not defined in config" >&2
  exit 1
fi

# Compute the cutoff epoch once (GNU date first, BSD/macOS fallback)
AFTER_EPOCH=$(date -d "$AFTER_DATE" +%s 2>/dev/null || date -j -f %Y-%m-%d "$AFTER_DATE" +%s)

echo "📡 Listing all Gerrit change refs from ${REPO_URL}..."

git ls-remote "${REPO_URL}" | { grep "refs/changes/" || true; } | { grep -v "/meta$" || true; } | while read -r sha ref; do
  change_num=$(echo "$ref" | awk -F'/' '{print $(NF-1)}')
  patch_num=$(echo "$ref" | awk -F'/' '{print $NF}')
  branch="cr-${change_num}-${patch_num}"

  if git show-ref --verify --quiet "refs/heads/${branch}"; then
    echo "⏩ ${branch} already exists, skipping"
    continue
  fi

  # Fetch the ref FIRST: we cannot read a commit's date before its object
  # exists locally.
  echo "⬇️  Fetching ${branch} (${ref})"
  if ! git fetch "${REPO_URL}" "${ref}"; then
    echo "⚠️  Failed to fetch ${ref}, skipping" >&2
    continue
  fi

  # Skip changes older than AFTER_DATE
  commit_epoch=$(git show -s --format=%ct FETCH_HEAD)
  if [[ "$commit_epoch" -lt "$AFTER_EPOCH" ]]; then
    echo "⏩ ${branch} is older than ${AFTER_DATE}, skipping"
    continue
  fi

  git branch "${branch}" FETCH_HEAD
done

echo "✅ All recent change refs (after ${AFTER_DATE}) have been fetched locally."
echo "   You can now explore with:"
echo "   git log --graph --decorate --oneline --all"
