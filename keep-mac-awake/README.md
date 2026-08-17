# keep-mac-awake

macOS only. Keeps a MacBook running with the lid closed, so it can sit shut in
the background running long jobs — remote coding sessions, builds, syncs.

While the lid is shut, volume and display brightness are set to zero. When it
opens, both are restored to exactly what they were.

## Requirements

- macOS (Apple Silicon or Intel), and an admin password — `on`/`off` call `sudo`.
- Xcode command line tools (`xcode-select --install`): `on` compiles the
  brightness helper into `bin/` on first run. Nothing else to install.

## Usage

```bash
./keep-awake.sh on       # lid can now be closed; asks for your password
./keep-awake.sh off      # back to normal
./keep-awake.sh status
```

Optional alias:

```bash
alias awake='~/Projects/MyProjects/scripts/keep-mac-awake/keep-awake.sh'
```

## How it works

| Piece | Job |
| --- | --- |
| `pmset -a disablesleep 1` | Stops lid close from triggering sleep. No external display or charger trick needed. |
| lid watcher | Background loop, polls the lid sensor every 2s. On close: saves volume + brightness, zeroes both. On open: restores them. |
| `bin/brightnessctl` | Reads and writes built-in display brightness. |
| reset LaunchDaemon | Clears `disablesleep` at boot. |

State lives in `~/.keep-mac-awake/`.

## On/off, never half-on

`pmset disablesleep` is written to `/Library/Preferences/com.apple.PowerManagement.plist`,
so on its own it survives a reboot — leaving a machine that never sleeps with
nothing managing brightness or volume.

To avoid that, `on` installs `/Library/LaunchDaemons/com.keep-mac-awake.reset.plist`,
which runs `pmset -a disablesleep 0` at every boot. The daemon file is written
but deliberately not bootstrapped: loading it immediately would run it
immediately and undo the setting being made. launchd picks it up at next boot.

Net effect: a reboot always lands in the OFF state. Run `on` again to resume.

To remove the daemon entirely:

```bash
sudo rm /Library/LaunchDaemons/com.keep-mac-awake.reset.plist
```

## Why a custom brightness helper

Homebrew's `brightness` uses the public IOKit display API, which fails on
Apple Silicon built-in panels:

```
failed to get brightness of display 0x1 (error -536870201)
```

`src/brightnessctl.c` uses `DisplayServicesGetBrightness` /
`DisplayServicesSetBrightness` from the DisplayServices private framework
instead, resolved at runtime with `dlsym` so a future macOS that drops those
symbols fails with a clear message rather than refusing to launch.

## Notes

- Verified on Apple Silicon (M-series, macOS 26). The DisplayServices path
  should work on Intel too, but is untested there.
- **Keep it plugged in.** With no sleep floor the battery drains at full rate,
  and a closed lid under load means no airflow.
- Wi-Fi stays up, so remote connections hold.
- Two bugs worth knowing about if you edit this: `ioreg ... | grep -q` inverts
  the lid reading under `set -o pipefail` (SIGPIPE kills `ioreg`, pipefail
  reports failure), and `disablesleep` never appears in `pmset -g custom` — it
  shows as `SleepDisabled` in plain `pmset -g`.
