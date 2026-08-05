#!/usr/bin/env python3
"""Pin apps to macOS desktops (Spaces) for 1-screen and 2-screen setups.

Writes native app->desktop bindings (the same mechanism as Dock icon >
Options > Assign To Desktop), detects whether the external monitor is
connected, and applies the matching layout. No SIP changes, no window
manager, macOS itself enforces the placement at every app launch.

Live desktop lists come from SkyLight's SLSCopyManagedDisplaySpaces —
the com.apple.spaces defaults plist keeps stale/merged monitor configs
and cannot be trusted for ordering (learned the hard way).

Usage:
  ./fix-desktops.py            apply bindings for the current display setup
  ./fix-desktops.py --dry-run  show what would be written, change nothing
  ./fix-desktops.py --relaunch also quit + reopen bound apps so they snap
                               into place now instead of at next launch
"""

import argparse
import ctypes
import os
import plistlib
import subprocess
import sys
import time
from ctypes import Structure, byref, c_double, c_int, c_long, c_ulong, c_uint32, c_void_p

# --- Layout config -----------------------------------------------------------
# Desktops are listed left to right. Each entry is a list of app keys that
# share that desktop. Edit here, rerun the script.

APPS = {
    "spotify": "com.spotify.client",
    "obsidian": "md.obsidian",
    "slack": "com.tinyspeck.slackmacgap",
    "chrome": "com.google.chrome",
    "chrome-personal": "com.google.chrome.beta",  # Chrome Beta = personal profile
    "vscode": "com.microsoft.vscode",
    "antigravity": "com.google.antigravity-ide",
    "gitkraken": "com.axosoft.gitkraken",
    "gitgud": "com.joelloyd.gitgud",
    "outlook": "com.microsoft.outlook",
    "teams": "com.microsoft.teams2",
    "figma": "com.figma.desktop",
    "iterm": "com.googlecode.iterm2",
    "docker": "com.docker.docker",
    "activity-monitor": "com.apple.activitymonitor",
    "system-settings": "com.apple.systempreferences",
    "loom": "com.loom.desktop",
}

ONE_SCREEN = {
    "macbook": [
        ["spotify"],                       # D1
        ["obsidian"],                      # D2
        ["slack"],                         # D3
        ["chrome", "chrome-personal"],     # D4
        ["vscode"],                        # D5
        ["antigravity"],                   # D6
        ["gitkraken", "gitgud"],           # D7
        ["outlook"],                       # D8
        ["teams"],                         # D9
        ["figma", "iterm", "docker",       # D10 - dump
         "activity-monitor", "system-settings", "loom"],
    ],
}

TWO_SCREEN = {
    "macbook": [
        ["spotify"],                       # D1
        ["slack"],                         # D2
        ["chrome-personal"],               # D3
        ["outlook"],                       # D4
        ["teams"],                         # D5
        ["activity-monitor",               # D6 - dump
         "system-settings", "loom"],
    ],
    "external": [
        ["figma"],                         # D1
        ["obsidian"],                      # D2
        ["chrome"],                        # D3
        ["vscode"],                        # D4
        ["antigravity"],                   # D5
        ["gitkraken", "gitgud"],           # D6
        ["iterm", "docker"],               # D7 - dump
    ],
}

# Apps never quit by --relaunch even when bound (data loss / self-kill risk).
RELAUNCH_SKIP = {"com.docker.docker"}

# -----------------------------------------------------------------------------

CF = ctypes.CDLL("/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation")
CG = ctypes.CDLL("/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics")
SKYLIGHT = ctypes.CDLL("/System/Library/PrivateFrameworks/SkyLight.framework/SkyLight")
COLORSYNC = ctypes.CDLL("/System/Library/Frameworks/ColorSync.framework/ColorSync")


class CGRect(Structure):
    _fields_ = [("x", c_double), ("y", c_double), ("w", c_double), ("h", c_double)]


def _cf_to_python(cf_ref):
    """Serialize a CF property list object to bytes and parse with plistlib."""
    CF.CFPropertyListCreateData.restype = c_void_p
    CF.CFPropertyListCreateData.argtypes = [c_void_p, c_void_p, c_long, c_ulong, c_void_p]
    CF.CFDataGetBytePtr.restype = ctypes.POINTER(ctypes.c_ubyte)
    CF.CFDataGetBytePtr.argtypes = [c_void_p]
    CF.CFDataGetLength.restype = c_long
    CF.CFDataGetLength.argtypes = [c_void_p]
    data = CF.CFPropertyListCreateData(None, cf_ref, 200, 0, None)  # binary v1.0
    if not data:
        data = CF.CFPropertyListCreateData(None, cf_ref, 100, 0, None)  # xml
    if not data:
        raise RuntimeError("CFPropertyListCreateData failed")
    raw = ctypes.string_at(CF.CFDataGetBytePtr(data), CF.CFDataGetLength(data))
    return plistlib.loads(raw)


def main_display_uuid():
    CG.CGMainDisplayID.restype = c_uint32
    COLORSYNC.CGDisplayCreateUUIDFromDisplayID.restype = c_void_p
    COLORSYNC.CGDisplayCreateUUIDFromDisplayID.argtypes = [c_uint32]
    CF.CFUUIDCreateString.restype = c_void_p
    CF.CFUUIDCreateString.argtypes = [c_void_p, c_void_p]
    CF.CFStringGetCString.restype = ctypes.c_bool
    CF.CFStringGetCString.argtypes = [c_void_p, ctypes.c_char_p, c_long, c_uint32]
    uuid_ref = COLORSYNC.CGDisplayCreateUUIDFromDisplayID(CG.CGMainDisplayID())
    s = CF.CFUUIDCreateString(None, uuid_ref)
    buf = ctypes.create_string_buffer(64)
    CF.CFStringGetCString(s, buf, 64, 0x08000100)  # kCFStringEncodingUTF8
    return buf.value.decode()


def live_screens():
    """{'macbook': [space uuids...], 'external': [...]} from SkyLight —
    the actual Mission Control state, in left-to-right desktop order."""
    SKYLIGHT.SLSMainConnectionID.restype = c_int
    SKYLIGHT.SLSCopyManagedDisplaySpaces.restype = c_void_p
    SKYLIGHT.SLSCopyManagedDisplaySpaces.argtypes = [c_int]
    displays = _cf_to_python(
        SKYLIGHT.SLSCopyManagedDisplaySpaces(SKYLIGHT.SLSMainConnectionID())
    )
    main_uuid = main_display_uuid()
    screens = {}
    for d in displays:
        ident = d.get("Display Identifier", "")
        # user-visible desktops only (type 0 = standard, skips fullscreen apps)
        spaces = [s["uuid"] for s in d.get("Spaces", []) if s.get("type") == 0]
        key = "macbook" if ident in (main_uuid, "Main") else "external"
        screens[key] = spaces
    return screens


def display_bounds():
    """[{main: bool, minx, maxx}] for every active display."""
    CG.CGDisplayBounds.restype = CGRect
    CG.CGDisplayBounds.argtypes = [c_uint32]
    ids = (c_uint32 * 16)()
    cnt = c_uint32()
    CG.CGGetActiveDisplayList(16, ids, byref(cnt))
    out = []
    for i in range(cnt.value):
        r = CG.CGDisplayBounds(ids[i])
        out.append(
            {"main": bool(CG.CGDisplayIsMain(ids[i])), "minx": r.x, "maxx": r.x + r.w}
        )
    return out


# Clicks Mission Control's "add desktop" button n times, but only the button
# sitting inside the given x range (= the target display's Spaces bar).
ADD_DESKTOP_SCRIPT = '''
on run argv
    set n to (item 1 of argv) as integer
    set minX to (item 2 of argv) as integer
    set maxX to (item 3 of argv) as integer
    do shell script "open -b com.apple.exposelauncher"
    delay 1.2
    tell application "System Events" to tell process "Dock"
        set target to missing value
        repeat with e in entire contents
            try
                if class of e is button and description of e is "add desktop" then
                    set bx to item 1 of (position of e)
                    if bx >= minX and bx < maxX then
                        set target to e
                        exit repeat
                    end if
                end if
            end try
        end repeat
        if target is missing value then
            key code 53
            error "no add-desktop button found in x range " & minX & ".." & maxX
        end if
        repeat n times
            click target
            delay 0.5
        end repeat
    end tell
    delay 0.3
    tell application "System Events" to key code 53
end run
'''


def ensure_desktops(layout, screens, dry_run):
    """Create only the missing desktops per screen. Returns True if any
    were added (caller must re-read SkyLight)."""
    displays = display_bounds()
    bounds = {
        "macbook": next((d for d in displays if d["main"]), None),
        "external": next((d for d in displays if not d["main"]), None),
    }
    added = False
    for screen_key, desktops in layout.items():
        spaces = screens.get(screen_key)
        display = bounds.get(screen_key)
        if spaces is None or display is None:
            continue
        have, need = len(spaces), len(desktops)
        name = "MacBook screen" if screen_key == "macbook" else "external screen"
        if have >= need:
            if have > need:
                print(f"{name}: {have} desktops, layout uses {need} - "
                      f"{have - need} spare (unbound; delete in Mission Control if unwanted)")
            continue
        deficit = need - have
        if dry_run:
            print(f"{name}: {have} desktops, needs {need} - would create {deficit}")
            continue
        print(f"{name}: {have} desktops, needs {need} - creating {deficit}...")
        subprocess.run(
            ["osascript", "-e", ADD_DESKTOP_SCRIPT, str(deficit),
             str(int(display["minx"])), str(int(display["maxx"]))],
            check=True, capture_output=True, text=True,
        )
        added = True
    return added


def build_bindings(layout, screens):
    bindings = {}
    problems = []
    for screen_key, desktops in layout.items():
        spaces = screens.get(screen_key)
        if spaces is None:
            problems.append(f"no live display found for '{screen_key}'")
            continue
        if len(desktops) > len(spaces):
            name = "MacBook screen" if screen_key == "macbook" else "external screen"
            problems.append(
                f"{name} still has {len(spaces)} desktops but the layout needs "
                f"{len(desktops)} - desktop creation may have failed; check "
                f"Accessibility permission for your terminal and rerun"
            )
            continue
        for i, app_keys in enumerate(desktops):
            for key in app_keys:
                bindings[APPS[key]] = spaces[i]
    return bindings, problems


def verify_bindings(expected):
    """Read the bindings back and compare - Dock silently prunes entries
    it doesn't accept, so trust nothing."""
    raw = subprocess.run(
        ["defaults", "export", "com.apple.spaces", "-"],
        capture_output=True, check=True,
    ).stdout
    actual = plistlib.loads(raw).get("app-bindings", {})
    missing = {k: v for k, v in expected.items() if actual.get(k) != v}
    return missing


def describe(layout, bindings):
    lines = []
    for screen_key, desktops in layout.items():
        name = "MacBook screen" if screen_key == "macbook" else "External screen"
        lines.append(f"{name}:")
        for i, app_keys in enumerate(desktops):
            apps = ", ".join(app_keys)
            bound = all(APPS[k] in bindings for k in app_keys)
            lines.append(f"  D{i + 1}: {apps}{'' if bound else '  (NOT bound)'}")
    return "\n".join(lines)


def app_running(bundle_id):
    result = subprocess.run(
        ["lsappinfo", "find", f"bundleid={bundle_id}"],
        capture_output=True, text=True,
    )
    return bool(result.stdout.strip())


def relaunch(bundle_ids):
    inside_iterm = os.environ.get("TERM_PROGRAM") == "iTerm.app"
    running = []
    for bid in bundle_ids:
        if bid in RELAUNCH_SKIP:
            continue
        if inside_iterm and bid == "com.googlecode.iterm2":
            print("  skipping iTerm2 - the script is running inside it")
            continue
        if app_running(bid):
            running.append(bid)

    for bid in running:
        print(f"  quitting {bid}")
        subprocess.run(
            ["osascript", "-e", f'tell application id "{bid}" to quit'],
            capture_output=True,
        )
    time.sleep(5)
    for bid in running:
        print(f"  reopening {bid}")
        subprocess.run(["open", "-b", bid], capture_output=True)
        time.sleep(1)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--relaunch", action="store_true")
    args = parser.parse_args()

    screens = live_screens()
    layout = TWO_SCREEN if "external" in screens else ONE_SCREEN
    mode = "2-screen" if layout is TWO_SCREEN else "1-screen"
    print(f"Detected {len(screens)} screen(s) -> applying {mode} layout\n")

    # Create only what's missing; existing desktops are counted first.
    if ensure_desktops(layout, screens, args.dry_run):
        time.sleep(1)
        screens = live_screens()
    print()

    bindings, problems = build_bindings(layout, screens)
    print(describe(layout, bindings), "\n")

    for p in problems:
        print(f"PROBLEM: {p}")
    if problems:
        sys.exit(1)

    if args.dry_run:
        print("Dry run - nothing written.")
        return

    # Replace the whole bindings dict: this script owns the map.
    cmd = ["defaults", "write", "com.apple.spaces", "app-bindings", "-dict"]
    for bid, uuid in bindings.items():
        cmd += [bid, uuid]
    subprocess.run(cmd, check=True)

    # Stop macOS from reshuffling desktop order by recent use.
    subprocess.run(
        ["defaults", "write", "com.apple.dock", "mru-spaces", "-bool", "false"],
        check=True,
    )

    subprocess.run(["killall", "Dock"], check=True)
    time.sleep(2)

    missing = verify_bindings(bindings)
    if missing:
        print("WARNING: Dock dropped these bindings (app not installed?):")
        for bid in missing:
            print(f"  {bid}")
    print("Bindings written and verified. Apps snap to their desktop at launch.")

    if args.relaunch:
        print("\nRelaunching bound apps so they move now:")
        relaunch(sorted(set(bindings)))
        print("Done.")
    else:
        print("Tip: rerun with --relaunch to move already-open apps now.")


if __name__ == "__main__":
    main()
