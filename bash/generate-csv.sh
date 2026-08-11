#!/usr/bin/env bash
set -euo pipefail

# Output file name
OUTPUT_FILE="project_history.csv"

# Check if we are in a git repository (works from subdirectories and worktrees)
git rev-parse --git-dir >/dev/null 2>&1 || { echo "Error: This directory is not inside a git repository." >&2; exit 1; }

echo "Generating CSV..."

# Write the CSV Header
echo "Date,Title,Description" > "$OUTPUT_FILE"

# Loop through every commit hash
# We use a loop to safely handle special characters (quotes, commas, newlines)
git log --format="%H" | while read -r hash; do

  # Get the date (ISO 8601 format YYYY-MM-DD)
  date=$(git show -s --format="%cd" --date=short "$hash")

  # Get the Title (%s) and escape existing double quotes
  title=$(git show -s --format="%s" "$hash")
  title="${title//\"/\"\"}"

  # Get the Description (%b) and escape existing double quotes
  description=$(git show -s --format="%b" "$hash")
  description="${description//\"/\"\"}"

  # Write to file, wrapping fields in quotes to handle commas and newlines
  echo "\"$date\",\"$title\",\"$description\"" >> "$OUTPUT_FILE"

done

echo "Done! Commit history saved to $OUTPUT_FILE"
