#!/usr/bin/env bash
# Keep this Mac running with the lid closed. Volume and brightness drop to
# zero while the lid is shut, and are restored when it opens.
#
#   ./keep-awake.sh on | off | status
#
# `pmset disablesleep` is written to disk and would otherwise survive a
# reboot, so `on` also drops a LaunchDaemon that clears it at boot. That keeps
# the machine in one of two states only: fully on, or fully off.
set -euo pipefail
cd "$(dirname "$0")"

S=~/.keep-mac-awake
B=./bin/brightnessctl
DAEMON=/Library/LaunchDaemons/com.keep-mac-awake.reset.plist
mkdir -p "$S"

# No pipe here on purpose: `... | grep -q` kills ioreg with SIGPIPE on match,
# and `set -o pipefail` turns that into a failure, inverting the result.
lid() {
  case "$(ioreg -r -k AppleClamshellState -d 4)" in
    *'"AppleClamshellState" = Yes'*) echo closed ;;
    *) echo open ;;
  esac
}

save() {
  osascript -e 'output volume of (get volume settings)' > "$S/vol"
  osascript -e 'output muted of (get volume settings)'  > "$S/muted"
  $B > "$S/bright"
  osascript -e 'set volume output volume 0' -e 'set volume output muted true'
  $B 0
}

restore() {
  [ -f "$S/bright" ] || return 0
  $B "$(cat "$S/bright")"
  osascript -e "set volume output volume $(cat "$S/vol")"
  grep -q true "$S/muted" || osascript -e 'set volume output muted false'
  rm -f "$S/vol" "$S/muted" "$S/bright"
}

watch() {
  local prev cur
  prev=$(lid)
  while :; do
    cur=$(lid)
    if [ "$cur" != "$prev" ]; then
      if [ "$cur" = closed ]; then save; else restore; fi
      prev=$cur
    fi
    sleep 2
  done
}

# Written, never bootstrapped: loading it now would run it now and immediately
# undo the setting we are about to make. launchd picks it up at next boot.
install_reset_daemon() {
  [ -f "$DAEMON" ] && return 0
  sudo tee "$DAEMON" >/dev/null <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.keep-mac-awake.reset</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/bin/pmset</string>
    <string>-a</string>
    <string>disablesleep</string>
    <string>0</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
</dict>
</plist>
PLIST
  sudo chown root:wheel "$DAEMON"
  sudo chmod 644 "$DAEMON"
}

case "${1:-status}" in
  on)
    [ -x $B ] || { mkdir -p bin && clang -O2 -o $B src/brightnessctl.c; }
    install_reset_daemon
    sudo pmset -a disablesleep 1
    pkill -f 'keep-awake.sh watch' 2>/dev/null || true
    nohup ./keep-awake.sh watch >/dev/null 2>&1 &
    echo "ON — lid can be closed. Reboot resets to OFF."
    ;;
  off)
    pkill -f 'keep-awake.sh watch' 2>/dev/null || true
    restore
    sudo pmset -a disablesleep 0
    echo "OFF — normal lid-close sleep restored."
    ;;
  watch) watch ;;
  status)
    # Field-exact: `pmset -g` prints one blob, so a glob like *SleepDisabled*1*
    # also matches the `standby 1` line further down and always reports disabled.
    case "$(pmset -g | awk '$1 == "SleepDisabled" { print $2 }')" in
      1) echo "sleep   : disabled" ;;
      *) echo "sleep   : normal (lid close will sleep — run \`$0 on\`)" ;;
    esac
    pgrep -qf 'keep-awake.sh watch' && echo "watcher : running" || echo "watcher : stopped"
    echo "lid     : $(lid)"
    [ -f "$DAEMON" ] && echo "reset   : installed" || echo "reset   : not installed"
    ;;
  *) echo "usage: $0 {on|off|status}" >&2; exit 1 ;;
esac
