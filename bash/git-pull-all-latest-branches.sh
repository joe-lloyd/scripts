#!/usr/bin/env bash
set -euo pipefail

REPO_URL="https://experience-spaces.googlesource.com/apps/Boba2"
MAIN_BRANCH="main"  # change this if your main branch is called differently

git show-ref --verify --quiet "refs/heads/$MAIN_BRANCH" || { echo "❌ Local branch '$MAIN_BRANCH' not found." >&2; exit 1; }

echo "📡 Listing all Gerrit change refs from ${REPO_URL}..."
git ls-remote "${REPO_URL}" | { grep "refs/changes/" || true; } | { grep -v "/meta$" || true; } | while read -r sha ref; do
  change_num=$(echo "$ref" | awk -F'/' '{print $(NF-1)}')
  patch_num=$(echo "$ref" | awk -F'/' '{print $NF}')
  branch="cr-${change_num}-${patch_num}"

  if git show-ref --verify --quiet "refs/heads/${branch}"; then
    echo "⏩ ${branch} already exists, skipping"
  else
    echo "⬇️  Fetching ${branch} (${ref})"
    if git fetch "${REPO_URL}" "${ref}"; then
      git branch "${branch}" FETCH_HEAD
    else
      echo "⚠️  Failed to fetch ${ref}, skipping" >&2
    fi
  fi
done

echo "🧹 Cleaning up old patch branches..."

# Delete branches that are already merged into main
# (-d is safe here: we just verified these branches are merged)
git branch --merged "$MAIN_BRANCH" | { grep '^  cr-' || true; } | while read -r merged_branch; do
  echo "🗑️  Deleting merged branch: $merged_branch"
  git branch -d "$merged_branch"
done

# Delete older patch branches, keeping only the latest per CR
branches=$(git for-each-ref --format='%(refname:short)' 'refs/heads/cr-*' || true)
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
