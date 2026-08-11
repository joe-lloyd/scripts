#!/usr/bin/env bash
set -euo pipefail

AFTER_DATE="2026-01-26"
OUTPUT_FILE="gerrit_git_report.csv"

# 1. Ensure we have the latest refs from Gerrit
echo "Fetching latest refs from origin..."
git fetch origin --prune

echo "Processing commits after $AFTER_DATE..."
echo "CommitHash,Date,ChangeID,Status,Subject" > "$OUTPUT_FILE"

# Compute the cutoff epoch once (GNU date first, BSD/macOS fallback)
AFTER_EPOCH=$(date -d "$AFTER_DATE" +%s 2>/dev/null || date -j -f %Y-%m-%d "$AFTER_DATE" +%s)

# 2. Get all remote refs, but only the 'magic' gerrit ones
# We sort them to ensure the highest patch set (the "final" one) comes last.
# Refs look like refs/remotes/origin/changes/<shard>/<change>/<patch>,
# so the change number is the second-to-last path segment.
git for-each-ref --format='%(refname)' refs/remotes/origin/changes/ | \
    sort -V | \
    awk -F'/' '{
        # Group by Change Number (second-to-last part of the ref)
        # Keeping only the last one seen (highest patch set)
        change[$(NF-1)] = $0
    }
    END {
        for (c in change) print change[c]
    }' | \
    while read -r ref; do

    # 3. Take the tip commit of the ref unconditionally and compare its
    # committer date against the cutoff ourselves (with clock skew between
    # commits, `git log --after` can return an ancestor's hash instead).
    HASH=$(git rev-parse "$ref")
    COMMIT_EPOCH=$(git show -s --format=%ct "$HASH")

    # Skip if commit is older than AFTER_DATE
    if [ "$COMMIT_EPOCH" -lt "$AFTER_EPOCH" ]; then
        continue
    fi

    DATE=$(git log -1 --format="%as" "$HASH")

    # Escape embedded double quotes for CSV; the field is quoted in the
    # output, so commas inside the subject are fine as-is.
    SUBJECT=$(git log -1 --format="%s" "$HASH")
    SUBJECT="${SUBJECT//\"/\"\"}"

    # Extract Change-Id from the body (sed keeps this portable to BSD/macOS)
    CHANGE_ID=$(git log -1 --format="%b" "$HASH" | sed -n 's/^Change-Id: *\([A-Za-z0-9]*\).*/\1/p' | head -n 1)

    # 4. Determine Status
    # We check if the commit hash exists in the local 'main' branch history
    if git merge-base --is-ancestor "$HASH" origin/main 2>/dev/null; then
        STATUS="Merged"
    else
        STATUS="Open/Abandoned"
    fi

    echo "$HASH,$DATE,$CHANGE_ID,$STATUS,\"$SUBJECT\"" >> "$OUTPUT_FILE"
done

echo "Done! Data written to $OUTPUT_FILE"
