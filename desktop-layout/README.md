# desktop-layout

Pins apps to fixed macOS desktops (Spaces), with a different map for
1-screen (MacBook only) and 2-screen (MacBook + LG) setups. Run it once
after plugging/unplugging the monitor; macOS then opens every app on its
assigned desktop, permanently.

## How it works

- Writes native `com.apple.spaces` app-bindings — the same thing as
  right-clicking a Dock icon > Options > Assign To Desktop, but for the
  whole map at once.
- Reads the live desktop list per display from SkyLight's
  `SLSCopyManagedDisplaySpaces` — the `com.apple.spaces` plist keeps
  stale/merged monitor configs around and can't be trusted for ordering.
- Disables "Automatically rearrange Spaces based on most recent use"
  (`com.apple.dock mru-spaces`) so the desktop order stays fixed.
- Restarts the Dock to apply. No SIP changes, no window manager. One
  private framework is used — SkyLight, read-only, just to list the
  current Spaces; all writes go through plain `defaults`. Survives
  reboots and macOS updates.

## Setup (one-time)

1. **Desktop counts.** The script makes counts match the layout exactly:
   it creates missing desktops and removes extras from the right (via
   Mission Control's AX actions — needs Accessibility permission).
   Windows on removed desktops migrate to a remaining one. Temp desktops
   you add by hand get trimmed again on the next run.
2. **One-click button.** Build the Dock app once and drag it to the Dock:
   ```sh
   osacompile -o "Fix Desktops.app" FixDesktops.applescript
   ```
   First click: approve the System Events prompt and add "Fix Desktops"
   under System Settings > Privacy & Security > Accessibility.
3. **Personal Chrome.** Same-app windows can't be split across desktops,
   so the personal profile (joe.lloyd.22.24@gmail.com) lives in
   **Chrome Beta** (separate bundle id = separate binding):
   `brew install --cask google-chrome@beta`, then sign the personal
   profile in there and remove it from regular Chrome.
4. First `--relaunch` run triggers one macOS permission prompt per app
   ("Terminal wants to control X") — approve once each.

## Usage

```sh
./fix-desktops.py --dry-run    # preview, changes nothing
./fix-desktops.py              # write bindings for current screen count
./fix-desktops.py --relaunch   # also quit+reopen apps to move them now
```

Edit the `ONE_SCREEN` / `TWO_SCREEN` tables at the top of the script to
change the map, then rerun.

## Helper scripts

- `add-spare-desktops.sh N [display]` — add N temporary desktops by
  clicking Mission Control's "+" button (`--list` shows the buttons per
  display). Note: the main script trims spares again on its next run.
- `count-windows.swift` — count real windows per app across all Spaces
  (`swift count-windows.swift`, no permissions needed); handy when
  deciding which apps can share a desktop.

## Limitations (macOS, not the script)

- Bindings are per app, not per window: all VS Code windows share one
  desktop (Antigravity is a separate app, so it gets its own). True
  per-window placement needs yabai with partial SIP disable — not worth
  it; the API breaks on every macOS update.
- Already-open windows don't teleport when bindings are written; either
  `--relaunch` or let apps pick up their desktop at next launch.
- Creating and removing desktops has no public API — the script
  UI-scripts Mission Control instead: it clicks the + button to add
  missing desktops and performs `AXRemoveDesktop` to trim extras from
  the right (windows on a removed desktop migrate to a neighbour).
  Matches English AX labels ("Desktop N"), so it needs an
  English-language macOS UI.
- Finder and 1Password are deliberately unbound so their windows appear
  on whatever desktop you're using.
