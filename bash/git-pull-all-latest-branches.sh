#!/usr/bin/env bash
set -euo pipefail

REPO_URL="https://experience-spaces.googlesource.com/apps/Boba2"
MAIN_BRANCH="main"  # change this if your main branch is called differently

echo "📡 Listing all Gerrit change refs from ${REPO_URL}..."
git ls-remote "${REPO_URL}" | grep "refs/changes/" | grep -v "/meta$" | while read -r sha ref; do
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

echo "🧹 Cleaning up old patch branches..."
# Delete branches that are already merged into main
git branch --merged "$MAIN_BRANCH" | grep '^  cr-' | while read -r merged_branch; do
  echo "🗑️  Deleting merged branch: $merged_branch"
  git branch -D "$merged_branch"
done

# Delete older patch branches, keeping only the latest per CR
branches=$(git for-each-ref --format='%(refname:short)' refs/heads/cr-* || true)
echo "$branches" | awk -F'-' '
{
  cr = $2; patch = $3;
  if (patch > latest_patch[cr]) {
    latest_patch[cr] = patch;
  }
  branches[cr, patch] = $0;
}
END {
  for (key in branches) {
    split(key, parts, SUBSEP);
    cr = parts[1];
    patch = parts[2];
    if (patch < latest_patch[cr]) {
      print branches[key];
    }
  }
}
' | while read -r old_branch; do
  echo "🗑️  Deleting old patch branch: $old_branch"
  git branch -D "$old_branch"
done

echo "✅ Done. Only the latest unmerged patch branches remain."
echo "   You can explore with:"
echo "   git log --graph --decorate --oneline --all"
