# Get Audio

Pull the audio out of a video — from a URL or a local file. Set a URL, run, done.

Only grab material you have the rights to use.

## Prerequisites

None. On first run the script downloads `ffmpeg` and `yt-dlp` into `tools\`
(~160 MB, once). If either is already on this machine — including under
`Downloads\ADStool\tools` — it reuses that copy instead of downloading again.

Unlike the other tools in this repo, this one is PowerShell, not Node. There is
nothing to `npm install`.

## Usage

**Batch:** put URLs in `urls.txt`, one per line, then double-click `Get-Audio.cmd`.
Each entry's audio lands in `out\`, named after the video title.

**One-off:** drag a video file onto `Get-Audio.cmd`, or run it directly:

```powershell
# full audio track (the default)
.\Get-Audio.ps1 -Url "https://youtu.be/XXXX"

# 29-second clip from a random position
.\Get-Audio.ps1 -Url "https://youtu.be/XXXX" -Duration 29

# 29 seconds starting at 12:05, named yourself
.\Get-Audio.ps1 -Url "https://youtu.be/XXXX" -Duration 29 -Start 12:05 -Name intro

# a local file, as mono mp3
.\Get-Audio.ps1 -Url "C:\Users\joell\Videos\clip.mp4" -Format mp3 -Mono

# several at once
.\Get-Audio.ps1 -Url "https://youtu.be/A","https://youtu.be/B" -Duration 15
```

## Options

| flag | default | what it does |
|---|---|---|
| `-Url` | `urls.txt` | one or more URLs or local paths |
| `-Duration` | `0` | seconds to take; `0` means the whole track |
| `-Start` | random | `90`, `1:30`, or `0:01:30` |
| `-Format` | `wav` | `wav`, `mp3`, `m4a`, `flac` |
| `-BitDepth` | `24` | `16`, `24`, or `32` (float); `wav`/`flac` only |
| `-Rate` | source | output sample rate; omit to keep the source's |
| `-Mono` | off | downmix to one channel |
| `-Name` | video title | output base name |
| `-OutDir` | `out\` | where files land |
| `-UpdateTools` | — | refresh yt-dlp |

## About quality

YouTube never serves lossless audio. The best it has for a given video is
whatever lossy stream was encoded at upload — usually Opus around 100 kbps or
AAC around 130 kbps. That is the ceiling, and no setting here can raise it.

What the script *can* do is avoid throwing quality away below that ceiling:

- The stream is downloaded **as-is and never re-encoded** on the way in. An
  earlier version transcoded it to AAC first, which spent a whole lossy
  generation for no benefit.
- The source **sample rate passes through untouched** unless you ask for a
  different one with `-Rate`. Resampling 48 kHz Opus to 44.1 kHz, or the
  reverse, is a lossy step you rarely want.
- Decoding lands in **24-bit PCM** by default, so nothing is lost quantising
  the decoder's output.

To see what you're working with, the script prints the source stream before it
converts:

```
source: opus vbr, 48000 Hz, 2ch
-> claire.wav  (7.97 MB, 24-bit, 48000 Hz)
```

Note that WAV file size tells you nothing about quality — a 63 MB WAV decoded
from a 100 kbps Opus stream holds exactly 100 kbps worth of detail. Use
`-Format flac` to keep identical audio at roughly half the size.

## Behaviour worth knowing

- **Random start** only applies when `-Duration` is set *and* the source is
  longer than it. A shorter source, or no duration, gets you the whole track.
- **`-Start` past the end** is clamped back so you still get a full-length clip
  instead of a truncated one.
- **Existing files are never overwritten** — a second run writes `name (2).wav`.
- **One bad URL doesn't stop a batch.** Failures are listed at the end.

## If downloads start failing

YouTube changes things and yt-dlp has to keep up:

```powershell
.\Get-Audio.ps1 -UpdateTools
```

That refreshes yt-dlp in place and fixes most download breakage.

## Layout

```
Get-Audio.ps1          main script
Get-Audio.cmd          double-click / drag-and-drop launcher
urls.txt               batch list
lib\Install-Tools.ps1  finds or fetches ffmpeg + yt-dlp
tools\                 downloaded tools (gitignored, created on first run)
out\                   output (gitignored)
```
