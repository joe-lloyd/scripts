#!/usr/bin/env bash
set -euo pipefail

# Get directory of this script (works even if run from elsewhere)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="${SCRIPT_DIR}/config.env"

# Load configuration
if [[ ! -f "$CONFIG_FILE" ]]; then
  echo "❌ Config file not found at $CONFIG_FILE"
  exit 1
fi
# shellcheck disable=SC1090
source "$CONFIG_FILE"

if [[ -z "${REPO_URL:-}" ]]; then
  echo "❌ REPO_URL not defined in config"
  exit 1
fi

if [[ -z "${AFTER_DATE:-}" ]]; then
  echo "❌ AFTER_DATE not defined in config"
  exit 1
fi

echo "📡 Listing all Gerrit change refs from ${REPO_URL}..."

git ls-remote "${REPO_URL}" | grep "refs/changes/" | grep -v "/meta$" | while read -r sha ref; do
  # Get commit date
  commit_date=$(git ls-remote "${REPO_URL}" "${ref}" | awk '{print $1}' | xargs -I {} git show -s --format=%ci {} 2>/dev/null || echo "")

  # Skip if no date found
  if [[ -z "$commit_date" ]]; then
    continue
  fi

  # Compare commit date to AFTER_DATE
  if [[ $(date -d "$commit_date" +%s) -lt $(date -d "$AFTER_DATE" +%s) ]]; then
    continue
  fi

  change_num=$(echo "$ref" | awk -F'/' '{print $(NF-1)}')
  patch_num=$(echo "$ref" | awk -F'/' '{print $NF}')
  branch="cr-${change_num}-${patch_num}"

  if git show-ref --verify --quiet "refs/heads/${branch}"; then
    echo "⏩ ${branch} already exists, skipping"
  else
    echo "⬇️  Fetching ${branch} (${ref})"
    git fetch "${REPO_URL}" "${ref}" && git branch "${branch}" FETCH_HEAD
  fi
done

echo "✅ All recent change refs (after ${AFTER_DATE}) have been fetched locally."
echo "   You can now explore with:"
echo "   git log --graph --decorate --oneline --all"
