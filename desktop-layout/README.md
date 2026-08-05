# desktop-layout

Pins apps to fixed macOS desktops (Spaces), with a different map for
1-screen (MacBook only) and 2-screen (MacBook + LG) setups. Run it once
after plugging/unplugging the monitor; macOS then opens every app on its
assigned desktop, permanently.

## How it works

- Writes native `com.apple.spaces` app-bindings — the same thing as
  right-clicking a Dock icon > Options > Assign To Desktop, but for the
  whole map at once.
- Detects the current display setup from the Spaces plist (stale monitor
  configs carry a `Collapsed Space` marker, live ones don't).
- Disables "Automatically rearrange Spaces based on most recent use"
  (`com.apple.dock mru-spaces`) so the desktop order stays fixed.
- Restarts the Dock to apply. No SIP changes, no private APIs, no window
  manager — survives reboots and macOS updates.

## Setup (one-time)

1. **Desktop counts.** The 1-screen layout needs 10 desktops on the
   MacBook screen; the 2-screen layout needs 6 on the MacBook and 7 on
   the LG. The script checks and tells you exactly how many to add
   (Mission Control > hover top-right > +).
2. **Personal Chrome.** Same-app windows can't be split across desktops,
   so the personal profile (joe.lloyd.22.24@gmail.com) lives in
   **Chrome Beta** (separate bundle id = separate binding):
   `brew install --cask google-chrome@beta`, then sign the personal
   profile in there and remove it from regular Chrome.
3. First `--relaunch` run triggers one macOS permission prompt per app
   ("Terminal wants to control X") — approve once each.

## Usage

```sh
./fix-desktops.py --dry-run    # preview, changes nothing
./fix-desktops.py              # write bindings for current screen count
./fix-desktops.py --relaunch   # also quit+reopen apps to move them now
```

Edit the `ONE_SCREEN` / `TWO_SCREEN` tables at the top of the script to
change the map, then rerun.

## Limitations (macOS, not the script)

- Bindings are per app, not per window: all VS Code windows share one
  desktop (Antigravity is a separate app, so it gets its own). True
  per-window placement needs yabai with partial SIP disable — not worth
  it; the API breaks on every macOS update.
- Already-open windows don't teleport when bindings are written; either
  `--relaunch` or let apps pick up their desktop at next launch.
- Creating/removing desktops has no public API — one-time manual step.
- Finder and 1Password are deliberately unbound so their windows appear
  on whatever desktop you're using.
