<#
Locate ffmpeg / ffprobe / yt-dlp, downloading them into <project>\tools if needed.

Dot-source this, then call Get-AudioTools:

    . "$PSScriptRoot\lib\Install-Tools.ps1"
    $tools = Get-AudioTools -ProjectRoot $PSScriptRoot

Search order per tool: the project's own tools\ folder, then a few known
locations on this machine, then PATH, and only then the internet.
#>

function Get-AudioTools {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$ProjectRoot,
        [switch]$Update
    )

    $toolDir = Join-Path $ProjectRoot 'tools'
    New-Item -ItemType Directory -Force -Path $toolDir | Out-Null

    # other places these may already exist, so we don't re-download 160 MB
    $knownFfmpegDirs = @(
        (Join-Path $toolDir 'ffmpeg'),
        'C:\Users\joell\Downloads\ADStool\tools\ffmpeg'
    )
    $knownYtDlp = @(
        (Join-Path $toolDir 'yt-dlp.exe'),
        'C:\Users\joell\Downloads\ADStool\tools\yt-dlp.exe'
    )

    function Find-Existing {
        param([string[]]$Candidates, [string]$OnPath)
        foreach ($c in $Candidates) { if (Test-Path -LiteralPath $c) { return (Resolve-Path -LiteralPath $c).Path } }
        if ($OnPath) {
            $cmd = Get-Command $OnPath -ErrorAction SilentlyContinue
            if ($cmd) { return $cmd.Source }
        }
        return $null
    }

    # ---- ffmpeg + ffprobe ----
    $ffmpeg = $null; $ffprobe = $null
    foreach ($d in $knownFfmpegDirs) {
        $a = Join-Path $d 'ffmpeg.exe'; $b = Join-Path $d 'ffprobe.exe'
        if ((Test-Path -LiteralPath $a) -and (Test-Path -LiteralPath $b)) { $ffmpeg = $a; $ffprobe = $b; break }
    }
    if (-not $ffmpeg) { $ffmpeg = Find-Existing -Candidates @() -OnPath 'ffmpeg' }
    if (-not $ffprobe) { $ffprobe = Find-Existing -Candidates @() -OnPath 'ffprobe' }

    if (-not $ffmpeg -or -not $ffprobe) {
        Write-Host "ffmpeg not found - downloading (about 160 MB, one time)..."
        $ProgressPreference = 'SilentlyContinue'
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        $zip = Join-Path $toolDir 'ffmpeg.zip'
        $tmp = Join-Path $toolDir 'ffmpeg_tmp'
        $urls = @(
            'https://github.com/BtbN/FFmpeg-Builds/releases/latest/download/ffmpeg-master-latest-win64-gpl.zip',
            'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip'
        )
        $ok = $false
        foreach ($u in $urls) {
            try { Invoke-WebRequest -Uri $u -OutFile $zip -UseBasicParsing -TimeoutSec 900
                  if ((Get-Item $zip).Length -gt 10MB) { $ok = $true; break } }
            catch { Write-Host "  mirror failed: $($_.Exception.Message)" }
        }
        if (-not $ok) { throw "could not download ffmpeg" }

        if (Test-Path -LiteralPath $tmp) { Remove-Item -LiteralPath $tmp -Recurse -Force }
        Expand-Archive -Path $zip -DestinationPath $tmp -Force
        $found = Get-ChildItem -LiteralPath $tmp -Recurse -Filter ffmpeg.exe | Select-Object -First 1
        if (-not $found) { throw "ffmpeg.exe not present in the archive" }
        $dest = Join-Path $toolDir 'ffmpeg'
        New-Item -ItemType Directory -Force -Path $dest | Out-Null
        foreach ($n in @('ffmpeg.exe','ffprobe.exe')) {
            $s = Join-Path $found.Directory.FullName $n
            if (Test-Path -LiteralPath $s) { Copy-Item -LiteralPath $s -Destination $dest -Force }
        }
        Remove-Item -LiteralPath $tmp -Recurse -Force
        Remove-Item -LiteralPath $zip -Force
        $ffmpeg  = Join-Path $dest 'ffmpeg.exe'
        $ffprobe = Join-Path $dest 'ffprobe.exe'
    }

    # ---- yt-dlp ----
    $ytdlp = Find-Existing -Candidates $knownYtDlp -OnPath 'yt-dlp'
    if (-not $ytdlp -or $Update) {
        $dest = Join-Path $toolDir 'yt-dlp.exe'
        Write-Host $(if ($ytdlp) { "updating yt-dlp..." } else { "yt-dlp not found - downloading..." })
        $ProgressPreference = 'SilentlyContinue'
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        try {
            Invoke-WebRequest -Uri 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe' `
                              -OutFile $dest -UseBasicParsing -TimeoutSec 600
            $ytdlp = $dest
        } catch {
            if (-not $ytdlp) { throw "could not download yt-dlp: $($_.Exception.Message)" }
            Write-Warning "update failed, keeping the existing copy"
        }
    }

    return [pscustomobject]@{ Ffmpeg = $ffmpeg; Ffprobe = $ffprobe; YtDlp = $ytdlp }
}
