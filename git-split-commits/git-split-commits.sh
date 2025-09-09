#!/bin/bash
#
# git-split-commits (v2 - Corrected)
#
# Splits each commit on the current branch into its own separate, local branch
# for individual review and submission to Gerrit.
#

set -e # Exit immediately if a command exits with a non-zero status.

# --- Configuration ---
BRANCH_PREFIX="feature"

# --- Validation ---
if [[ -z "$1" ]]; then
  echo "❌ Error: You must specify the target branch."
  echo "Usage: $0 <target_branch>"
  echo "Example: $0 main"
  exit 1
fi

TARGET_BRANCH=$1
ORIGINAL_BRANCH=$(git rev-parse --abbrev-ref HEAD)

if ! git rev-parse --verify $TARGET_BRANCH > /dev/null 2>&1; then
    echo "❌ Error: Target branch '$TARGET_BRANCH' not found."
    exit 1
fi

echo "➡️  Splitting commits between '$TARGET_BRANCH' and '$ORIGINAL_BRANCH'..."

# --- Main Logic ---
COMMITS=$(git rev-list --reverse $TARGET_BRANCH..HEAD)

if [[ -z "$COMMITS" ]]; then
  echo "⚠️ No new commits to split on this branch."
  exit 0
fi

for commit_sha in $COMMITS; do
  subject=$(git show -s --format=%s $commit_sha)
  sanitized_subject=$(echo "$subject" | tr '[:upper:]' '[:lower:]' | tr -s '[:punct:][:space:]' '-' | sed 's/^-*//;s/-*$//')
  short_sha=$(echo $commit_sha | cut -c1-7)
  branch_name="${BRANCH_PREFIX}/${sanitized_subject:0:50}-${short_sha}"

  echo "-----------------------------------------------------"
  echo "Processing commit $short_sha..."
  
  # Create the new branch starting from the target branch.
  git branch "$branch_name" "$TARGET_BRANCH"
  
  # --- FIX STARTS HERE ---
  # 1. Switch to the newly created branch.
  git switch "$branch_name"
  
  # 2. Cherry-pick the single commit onto this new branch.
  git cherry-pick "$commit_sha"
  # --- FIX ENDS HERE ---

  echo "✅ Created and switched to branch: $branch_name"
done

# --- Cleanup ---
echo "-----------------------------------------------------"
echo "🎉 All done! Switching back to your original branch '$ORIGINAL_BRANCH'."
git switch "$ORIGINAL_BRANCH"