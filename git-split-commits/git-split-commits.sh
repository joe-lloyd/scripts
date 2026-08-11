#!/usr/bin/env bash
#
# git-split-commits (v2 - Corrected)
#
# Splits each commit on the current branch into its own separate, local branch
# for individual review and submission to Gerrit.
#

set -euo pipefail

# --- Configuration ---
BRANCH_PREFIX="feature"

# --- Validation ---
if [[ -z "${1:-}" ]]; then
  echo "❌ Error: You must specify the target branch." >&2
  echo "Usage: $0 <target_branch>" >&2
  echo "Example: $0 main" >&2
  exit 1
fi

TARGET_BRANCH=$1
ORIGINAL_BRANCH=$(git rev-parse --abbrev-ref HEAD)

if [[ "$ORIGINAL_BRANCH" == "HEAD" ]]; then
  echo "❌ Error: You are on a detached HEAD. Check out a branch first." >&2
  exit 1
fi

# If anything fails mid-run (e.g. a cherry-pick conflict), abort the
# cherry-pick and return to the original branch instead of stranding the
# repo on a half-built feature branch.
trap 'git cherry-pick --abort 2>/dev/null; git switch "$ORIGINAL_BRANCH" 2>/dev/null' ERR

# Require a clean working tree before creating/switching branches.
git diff-index --quiet HEAD -- || { echo "❌ Working tree not clean; commit or stash first." >&2; exit 1; }

if ! git rev-parse --verify "$TARGET_BRANCH" > /dev/null 2>&1; then
    echo "❌ Error: Target branch '$TARGET_BRANCH' not found." >&2
    exit 1
fi

echo "➡️  Splitting commits between '$TARGET_BRANCH' and '$ORIGINAL_BRANCH'..."

# --- Main Logic ---
COMMITS=$(git rev-list --reverse --no-merges "$TARGET_BRANCH..HEAD")

if [[ -z "$COMMITS" ]]; then
  echo "⚠️ No new commits to split on this branch."
  exit 0
fi

for commit_sha in $COMMITS; do
  subject=$(git show -s --format=%s "$commit_sha")
  sanitized_subject=$(echo "$subject" | tr '[:upper:]' '[:lower:]' | tr -s '[:punct:][:space:]' '-' | sed 's/^-*//;s/-*$//')
  short_sha=$(echo "$commit_sha" | cut -c1-7)
  branch_name="${BRANCH_PREFIX}/${sanitized_subject:0:50}-${short_sha}"

  echo "-----------------------------------------------------"
  echo "Processing commit $short_sha..."

  if git show-ref --verify --quiet "refs/heads/$branch_name"; then
    echo "⚠️  Branch '$branch_name' already exists, skipping commit $short_sha." >&2
    continue
  fi

  # Create the new branch starting from the target branch.
  git branch "$branch_name" "$TARGET_BRANCH"

  # 1. Switch to the newly created branch.
  git switch "$branch_name"

  # 2. Cherry-pick the single commit onto this new branch.
  git cherry-pick "$commit_sha"

  echo "✅ Created and switched to branch: $branch_name"
done

# --- Cleanup ---
echo "-----------------------------------------------------"
echo "🎉 All done! Switching back to your original branch '$ORIGINAL_BRANCH'."
git switch "$ORIGINAL_BRANCH"
