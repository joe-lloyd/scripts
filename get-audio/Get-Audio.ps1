<#
.SYNOPSIS
Pull audio out of a video -- from a URL or a local file.

.DESCRIPTION
Default is the full audio track. Give -Duration to take a clip instead;
without -Start it picks a random start that fits inside the source.

Quality: the source stream is downloaded without re-encoding and decoded
straight to 24-bit PCM at its native sample rate, so nothing is lost below
what the site itself served. See README.md for what that ceiling actually is.

Tools (ffmpeg, yt-dlp) are located or downloaded automatically on first run.

.EXAMPLE
.\Get-Audio.ps1
Reads every URL in urls.txt and saves full audio for each into out\.

.EXAMPLE
.\Get-Audio.ps1 -Url "https://youtu.be/XXXX"

.EXAMPLE
.\Get-Audio.ps1 -Url "https://youtu.be/XXXX" -Duration 29
29-second clip from a random position.

.EXAMPLE
.\Get-Audio.ps1 -Url "https://youtu.be/XXXX" -Duration 29 -Start 12:05 -Name intro

.EXAMPLE
.\Get-Audio.ps1 -Url "C:\clips\video.mp4" -Format mp3 -Mono

.EXAMPLE
.\Get-Audio.ps1 -UpdateTools
Refresh yt-dlp. Run this if downloads suddenly start failing.
#>
[CmdletBinding()]
param(
    [Alias('Source')][string[]]$Url,
    [string]$OutDir,
    [ValidateSet('wav','mp3','m4a','flac')][string]$Format = 'wav',
    [double]$Duration = 0,          # 0 = whole track
    [string]$Start,                 # seconds, or mm:ss / hh:mm:ss
    [string]$Name,                  # output base name; default = video title
    [int]$Rate = 0,                 # 0 = keep the source rate (no resampling)
    [ValidateSet('16','24','32')][string]$BitDepth = '24',
    [switch]$Mono,
    [switch]$UpdateTools
)

$ErrorActionPreference = 'Stop'

# Windows PowerShell 5.1 decodes child-process stdout with the OEM codepage,
# which mangles non-ASCII titles coming back from yt-dlp. Force UTF-8 (and
# pass --encoding utf-8 to yt-dlp below so both sides agree).
[Console]::OutputEncoding = [Text.Encoding]::UTF8

$root = $PSScriptRoot
. (Join-Path $root 'lib\Install-Tools.ps1')

$tools = Get-AudioTools -ProjectRoot $root -Update:$UpdateTools
if ($UpdateTools -and -not $Url) { Write-Host "tools ready."; return }

# ffmpeg and yt-dlp both log to stderr; under PS 5.1 that would otherwise abort
$ErrorActionPreference = 'Continue'

if (-not $OutDir) { $OutDir = Join-Path $root 'out' }
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

# no -Url given: fall back to urls.txt
if (-not $Url) {
    $listFile = Join-Path $root 'urls.txt'
    if (-not (Test-Path -LiteralPath $listFile)) { throw "no -Url given and urls.txt not found" }
    $Url = @(Get-Content -LiteralPath $listFile |
             ForEach-Object { $_.Trim() } |
             Where-Object { $_ -and -not $_.StartsWith('#') })
    if (-not $Url) { throw "urls.txt has no entries (blank lines and #comments are skipped)" }
    Write-Host "$($Url.Count) entr$(if($Url.Count -eq 1){'y'}else{'ies'}) from urls.txt"
}

function ConvertTo-Seconds {
    param([string]$v)
    if (-not $v) { return $null }
    if ($v -match '^[\d.]+$') { return [double]$v }
    $parts = $v -split ':'
    [array]::Reverse($parts)
    $s = 0.0; $mult = 1.0
    foreach ($p in $parts) { $s += [double]$p * $mult; $mult *= 60 }
    return $s
}

function Get-StreamInfo {
    param($Ffprobe, [string]$Path)
    $raw = & $Ffprobe -v error -select_streams a:0 `
                      -show_entries stream=codec_name,sample_rate,channels,bit_rate `
                      -of default=noprint_wrappers=1 $Path
    $h = @{}
    foreach ($line in $raw) { if ($line -match '^([^=]+)=(.*)$') { $h[$matches[1]] = $matches[2] } }
    return $h
}

function Get-SafeName {
    param([string]$s)
    $clean = $s -replace '[\\/:*?"<>|]', '' -replace '\s+', ' '
    $clean = $clean.Trim()
    if ($clean.Length -gt 80) { $clean = $clean.Substring(0, 80).Trim() }
    if (-not $clean) { $clean = 'audio' }
    return $clean
}

$results = @()
$n = 0

foreach ($u in $Url) {
    $n++
    Write-Host ""
    Write-Host "[$n/$($Url.Count)] $u"
    $tmp = $null

    try {
        if ($u -match '^https?://') {
            $title = (& $tools.YtDlp --no-warnings --encoding utf-8 --print "%(title)s" $u 2>$null | Select-Object -First 1)
            if (-not $title) { $title = "audio" }
            Write-Host "  title: $title"

            $tmp = Join-Path $env:TEMP ("getaudio_" + [guid]::NewGuid().ToString('N'))
            New-Item -ItemType Directory -Force -Path $tmp | Out-Null

            # Deliberately no -x / --audio-format here. YouTube only ever serves
            # lossy audio (Opus or AAC); re-encoding that into another lossy
            # format costs a codec generation and buys nothing. Take the stream
            # as-is and let ffmpeg decode it straight to PCM below.
            # --ffmpeg-location matters: yt-dlp does not inherit PATH here.
            $dlOut = & $tools.YtDlp -f "bestaudio/best" `
                                    --ffmpeg-location (Split-Path $tools.Ffmpeg) `
                                    --encoding utf-8 `
                                    -o (Join-Path $tmp 'src.%(ext)s') --no-playlist --no-warnings $u 2>&1
            $dlOut | Where-Object { $_ -match 'ERROR|\[download\]\s+100%' } | ForEach-Object { "    $_" }
            if ($LASTEXITCODE -ne 0) {
                $tail = (@($dlOut | Select-Object -Last 10) | ForEach-Object { "$_" }) -join "`n"
                throw "yt-dlp failed (exit $LASTEXITCODE):`n$tail"
            }

            $got = Get-ChildItem -LiteralPath $tmp -File | Select-Object -First 1
            if (-not $got) { throw "download produced no file" }
            $work = $got.FullName
            $base = if ($Name) { $Name } else { Get-SafeName $title }
        }
        else {
            if (-not (Test-Path -LiteralPath $u)) { throw "not found: $u" }
            $work = (Resolve-Path -LiteralPath $u).Path
            $base = if ($Name) { $Name } else { [IO.Path]::GetFileNameWithoutExtension($work) }
        }

        $total = [double](& $tools.Ffprobe -v error -show_entries format=duration -of "csv=p=0" $work)
        if (-not $total -or $total -le 0) { throw "could not read a duration" }

        $src = Get-StreamInfo -Ffprobe $tools.Ffprobe -Path $work
        $srcRate = [int]$src['sample_rate']
        $kbps = if ($src['bit_rate'] -match '^\d+$') { "$([math]::Round([double]$src['bit_rate']/1000)) kbps" } else { 'vbr' }
        Write-Host ("  source: {0} {1}, {2} Hz, {3}ch" -f $src['codec_name'], $kbps, $srcRate, $src['channels'])

        $startSec = ConvertTo-Seconds $Start
        $take     = $Duration

        if ($take -le 0) {
            $startSec = if ($null -ne $startSec) { $startSec } else { 0 }
            $take     = $total - $startSec
            Write-Host ("  length {0}s -> full track" -f [math]::Round($total,2))
        }
        else {
            if ($null -eq $startSec) {
                if ($total -gt $take) {
                    $startSec = [math]::Round((Get-Random -Minimum 0.0 -Maximum ($total - $take)), 2)
                    Write-Host ("  length {0}s -> random {1}s clip from {2}s" -f [math]::Round($total,2), $take, $startSec)
                } else {
                    $startSec = 0; $take = $total
                    Write-Host ("  length {0}s is shorter than -Duration -> taking all of it" -f [math]::Round($total,2))
                }
            }
            elseif ($startSec + $take -gt $total) {
                $startSec = [math]::Max(0, $total - $take)
                Write-Host ("  -Start runs past the end, clamped to {0}s" -f [math]::Round($startSec,2))
            }
            else {
                Write-Host ("  length {0}s -> {1}s clip from {2}s" -f [math]::Round($total,2), $take, $startSec)
            }
        }

        $dest = Join-Path $OutDir "$base.$Format"
        $i = 2
        while (Test-Path -LiteralPath $dest) { $dest = Join-Path $OutDir "$base ($i).$Format"; $i++ }

        $ffArgs = @('-hide_banner','-y','-v','error','-ss',$startSec,'-i',$work,'-t',$take,'-vn')
        switch ($Format) {
            'wav'  { $ffArgs += @('-c:a', $(switch ($BitDepth) { '16' {'pcm_s16le'} '24' {'pcm_s24le'} '32' {'pcm_f32le'} })) }
            'flac' { $ffArgs += @('-c:a','flac','-compression_level','8','-sample_fmt', $(if ($BitDepth -eq '16') {'s16'} else {'s32'})) }
            'mp3'  { $ffArgs += @('-c:a','libmp3lame','-q:a','0') }
            'm4a'  { $ffArgs += @('-c:a','aac','-b:a','256k') }
        }
        # resample only when asked -- by default the source rate passes through untouched
        if ($Rate -gt 0) { $ffArgs += @('-ar',$Rate) }
        if ($Mono) { $ffArgs += @('-ac','1') }
        $ffArgs += $dest

        # ffmpeg with -y creates $dest before encoding, so the file existing
        # proves nothing -- trust the exit code and clean up any partial file.
        $ffOut = & $tools.Ffmpeg @ffArgs 2>&1
        if ($LASTEXITCODE -ne 0) {
            Remove-Item -LiteralPath $dest -ErrorAction SilentlyContinue
            $tail = (@($ffOut | Select-Object -Last 10) | ForEach-Object { "$_" }) -join "`n"
            throw "ffmpeg failed (exit $LASTEXITCODE):`n$tail"
        }
        if (-not (Test-Path -LiteralPath $dest)) { throw "ffmpeg produced no output" }

        $f = Get-Item -LiteralPath $dest
        $outRate  = if ($Rate -gt 0) { $Rate } else { $srcRate }
        $outDepth = if ($Format -in @('wav','flac')) { "$BitDepth-bit, " } else { '' }
        Write-Host ("  -> {0}  ({1} MB, {2}{3} Hz)" -f $f.Name, [math]::Round($f.Length/1MB,2), $outDepth, $outRate) -ForegroundColor Green
        $results += [pscustomobject]@{ Source=$u; Out=$f.FullName; MB=[math]::Round($f.Length/1MB,2); Ok=$true }
    }
    catch {
        Write-Host "  FAILED: $($_.Exception.Message)" -ForegroundColor Red
        $results += [pscustomobject]@{ Source=$u; Out=''; MB=0; Ok=$false }
    }
    finally {
        if ($tmp -and (Test-Path -LiteralPath $tmp)) { Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue }
    }
}

$good = @($results | Where-Object Ok)
Write-Host ""
Write-Host "$($good.Count)/$($results.Count) done -> $OutDir"
if ($good.Count -lt $results.Count) {
    Write-Host "if downloads are failing, try:  .\Get-Audio.ps1 -UpdateTools" -ForegroundColor Yellow
}
