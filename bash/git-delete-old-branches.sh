#!/usr/bin/env bash
set -euo pipefail

MAIN_BRANCH="main"  # Change this if your main branch has a different name

echo "🧹 Cleaning up old CR branches..."

# 1️⃣ Delete branches that are already merged into main
git branch --merged "$MAIN_BRANCH" | grep '^  cr-' | while read -r merged_branch; do
  echo "🗑️  Deleting merged branch: $merged_branch"
  git branch -D "$merged_branch"
done

# 2️⃣ Delete older patch branches, keeping only the latest per CR
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

echo "✅ Cleanup done. Only the latest unmerged patch branches remain."
