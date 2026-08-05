#!/bin/bash

AFTER_DATE="2026-01-26"
OUTPUT_FILE="gerrit_git_report.csv"

# 1. Ensure we have the latest refs from Gerrit
echo "Fetching latest refs from origin..."
git fetch origin --prune

echo "Processing commits after $AFTER_DATE..."
echo "CommitHash,Date,ChangeID,Status,Subject" > "$OUTPUT_FILE"

# 2. Get all remote refs, but only the 'magic' gerrit ones
# We sort them to ensure the highest patch set (the "final" one) comes last
git for-each-ref --format='%(refname)' refs/remotes/origin/changes/ | \
    sort -V | \
    awk -F'/' '{ 
        # Group by Change Number (the 4th part of the ref)
        # Keeping only the last one seen (highest patch set)
        change[$4] = $0 
    } 
    END { 
        for (c in change) print change[c] 
    }' | \
    while read -r ref; do

    # 3. Extract details from the commit, one field per query so
    # multi-line commit bodies can't bleed into the other fields
    HASH=$(git log -1 --after="$AFTER_DATE" --format="%H" "$ref")

    # Skip if commit is older than AFTER_DATE
    [ -z "$HASH" ] && continue

    DATE=$(git log -1 --format="%as" "$HASH")
    SUBJECT=$(git log -1 --format="%s" "$HASH" | tr ',' ';')

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