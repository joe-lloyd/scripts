#!/bin/bash
# Add N spare desktops (Spaces) by clicking Mission Control's "+" button.
# macOS has no API for creating Spaces, so this UI-scripts the Dock process.
# Requires Accessibility permission for your terminal
# (System Settings > Privacy & Security > Accessibility).
#
# Usage:
#   ./add-spare-desktops.sh --list        show the + buttons and their screen positions
#   ./add-spare-desktops.sh 4             add 4 desktops on display 1 (leftmost + button)
#   ./add-spare-desktops.sh 4 2           add 4 desktops on display 2

set -euo pipefail

MODE="${1:-}"
[ -z "$MODE" ] && { sed -n '2,11p' "$0" | sed 's/^# \{0,1\}//'; exit 1; }

if [ "$MODE" = "--list" ]; then N=0; LIST=1; else N="$MODE"; LIST=0; fi
DISPLAY_IDX="${2:-1}"

osascript - "$N" "$DISPLAY_IDX" "$LIST" <<'APPLESCRIPT'
on run argv
    set n to (item 1 of argv) as integer
    set displayIdx to (item 2 of argv) as integer
    set listOnly to (item 3 of argv) as integer

    -- open Mission Control so the Spaces bar (and its + button) exists
    do shell script "open -b com.apple.exposelauncher"
    delay 1.2

    tell application "System Events" to tell process "Dock"
        -- find every "add desktop" button; one per display's Spaces bar
        set addBtns to {}
        set allElems to entire contents
        repeat with e in allElems
            try
                if class of e is button and description of e is "add desktop" then
                    set end of addBtns to e
                end if
            end try
        end repeat

        if (count of addBtns) is 0 then
            key code 53 -- esc, leave Mission Control
            error "No 'add desktop' button found - Mission Control layout may differ; run --list and send me the output"
        end if

        -- sort buttons left-to-right by x position so displayIdx is stable
        set sorted to {}
        repeat with b in addBtns
            set pos to position of b
            set end of sorted to {x:(item 1 of pos), btn:b}
        end repeat
        repeat with i from 1 to (count of sorted) - 1
            repeat with j from 1 to (count of sorted) - i
                if x of item j of sorted > x of item (j + 1) of sorted then
                    set tmp to item j of sorted
                    set item j of sorted to item (j + 1) of sorted
                    set item (j + 1) of sorted to tmp
                end if
            end repeat
        end repeat

        if listOnly is 1 then
            set out to ""
            repeat with i from 1 to count of sorted
                set out to out & "display " & i & ": + button at x=" & (x of item i of sorted) & linefeed
            end repeat
            key code 53
            return out
        end if

        if displayIdx > (count of sorted) then
            key code 53
            error "Only " & (count of sorted) & " display(s) with a + button; asked for display " & displayIdx
        end if

        set target to btn of item displayIdx of sorted
        repeat n times
            click target
            delay 0.5
        end repeat
    end tell

    delay 0.3
    tell application "System Events" to key code 53 -- esc
    return "Added " & n & " desktop(s) on display " & displayIdx
end run
APPLESCRIPT
