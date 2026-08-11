<#
Locate ffmpeg / ffprobe / yt-dlp, downloading them into <project>\tools if needed.

Dot-source this, then call Get-AudioTools:

    . "$PSScriptRoot\lib\Install-Tools.ps1"
    $tools = Get-AudioTools -ProjectRoot $PSScriptRoot

Search order per tool: the project's own tools\ folder, then a few known
locations on this machine, then PATH, and only then the internet.

For ffmpeg/ffprobe that order is, precisely: $env:FFMPEG_PATH / $env:FFPROBE_PATH,
get-audio\tools\ffmpeg, the repo's shared <repo>\tools folder (recursively —
`npm run setup:ffmpeg` puts builds there), the repo's node_modules copies from
the ffmpeg-static / ffprobe-static packages (root `npm install`), the
Downloads\ADStool cache, PATH, and only then a download. The two binaries are
resolved independently, since the npm packages each ship only one of them.
#>

function Get-AudioTools {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$ProjectRoot,
        [switch]$Update
    )

    $toolDir = Join-Path $ProjectRoot 'tools'
    New-Item -ItemType Directory -Force -Path $toolDir | Out-Null

    # the rest of the repo shares ffmpeg through <repo>\tools and node_modules,
    # so look there before pulling down our own 160 MB copy
    $repoRoot    = Split-Path -Parent ($ProjectRoot.TrimEnd('\', '/'))
    $ownFfmpeg   = Join-Path $toolDir 'ffmpeg'
    $sharedTools = Join-Path $repoRoot 'tools'
    $nodeModules = Join-Path $repoRoot 'node_modules'
    $adsCache    = Join-Path $env:USERPROFILE 'Downloads\ADStool\tools\ffmpeg'

    $knownYtDlp = @(
        (Join-Path $toolDir 'yt-dlp.exe'),
        (Join-Path $env:USERPROFILE 'Downloads\ADStool\tools\yt-dlp.exe')
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

    # static-build archives nest the exe under a bin\ subfolder, so search the tree
    function Find-InTree {
        param([string]$Dir, [string]$Name)
        if (-not $Dir -or -not (Test-Path -LiteralPath $Dir)) { return $null }
        $hit = Get-ChildItem -LiteralPath $Dir -Recurse -File -Filter $Name -ErrorAction SilentlyContinue |
               Where-Object { $_.Name -ieq $Name } | Select-Object -First 1
        if ($hit) { return $hit.FullName }
        return $null
    }

    function New-ToolHit {
        param([string]$Path, [string]$Source)
        if (-not $Path) { return $null }
        [pscustomobject]@{ Path = (Resolve-Path -LiteralPath $Path).Path; Source = $Source }
    }

    # ffmpeg and ffprobe are resolved independently: ffmpeg-static ships only
    # ffmpeg and ffprobe-static only ffprobe, so they may come from different places
    function Find-FfTool {
        param([ValidateSet('ffmpeg', 'ffprobe')][string]$Name, [string]$EnvVarName)

        $exe = "$Name.exe"

        # 1. explicit override wins over everything
        $override = [Environment]::GetEnvironmentVariable($EnvVarName)
        if ($override -and (Test-Path -LiteralPath $override -PathType Leaf)) {
            return New-ToolHit -Path $override -Source "`$env:$EnvVarName"
        }

        # 2. this tool's own downloaded copy
        $own = Join-Path $ownFfmpeg $exe
        if (Test-Path -LiteralPath $own) { return New-ToolHit -Path $own -Source 'get-audio\tools' }

        # 3. the repo's shared tools folder (npm run setup:ffmpeg)
        $shared = Find-InTree -Dir $sharedTools -Name $exe
        if ($shared) { return New-ToolHit -Path $shared -Source "the repo's shared tools folder" }

        # 4. whatever the repo's npm packages already installed
        if ($Name -eq 'ffmpeg') {
            $pkg = Join-Path $nodeModules 'ffmpeg-static\ffmpeg.exe'
            if (Test-Path -LiteralPath $pkg) { return New-ToolHit -Path $pkg -Source "the repo's node_modules (ffmpeg-static)" }
        } else {
            $pkgBin = Join-Path $nodeModules 'ffprobe-static\bin'
            $arch = switch ($env:PROCESSOR_ARCHITECTURE) {
                'AMD64' { 'x64' }   'ARM64' { 'arm64' }
                'x86'   { 'ia32' }  default { 'x64' }
            }
            $preferred = Join-Path $pkgBin "win32\$arch\$exe"
            $pkg = if (Test-Path -LiteralPath $preferred) { $preferred } else { Find-InTree -Dir $pkgBin -Name $exe }
            if ($pkg) { return New-ToolHit -Path $pkg -Source "the repo's node_modules (ffprobe-static)" }
        }

        # 5. the older local cache
        $cached = Join-Path $adsCache $exe
        if (Test-Path -LiteralPath $cached) { return New-ToolHit -Path $cached -Source 'the Downloads\ADStool cache' }

        # 6. PATH
        $onPath = Find-Existing -Candidates @() -OnPath $Name
        if ($onPath) { return New-ToolHit -Path $onPath -Source 'PATH' }

        return $null
    }

    # ---- ffmpeg + ffprobe ----
    $ffmpegHit  = Find-FfTool -Name 'ffmpeg'  -EnvVarName 'FFMPEG_PATH'
    $ffprobeHit = Find-FfTool -Name 'ffprobe' -EnvVarName 'FFPROBE_PATH'
    if ($ffmpegHit)  { Write-Host "Using ffmpeg from $($ffmpegHit.Source)" }
    if ($ffprobeHit) { Write-Host "Using ffprobe from $($ffprobeHit.Source)" }
    $ffmpeg  = if ($ffmpegHit)  { $ffmpegHit.Path }  else { $null }
    $ffprobe = if ($ffprobeHit) { $ffprobeHit.Path } else { $null }

    # Get-Audio.ps1 probes duration and stream info with ffprobe, so a missing
    # ffprobe blocks just as hard as a missing ffmpeg - and the archive has both
    if (-not $ffmpeg -or -not $ffprobe) {
        $missing = @(); if (-not $ffmpeg) { $missing += 'ffmpeg' }; if (-not $ffprobe) { $missing += 'ffprobe' }
        Write-Host "$($missing -join ' and ') not found - downloading ffmpeg (about 160 MB, one time)..."
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
                  if ((Get-Item -LiteralPath $zip).Length -gt 10MB) { $ok = $true; break } }
            catch { Write-Host "  mirror failed: $($_.Exception.Message)" }
        }
        if (-not $ok) { throw "could not download ffmpeg" }

        if (Test-Path -LiteralPath $tmp) { Remove-Item -LiteralPath $tmp -Recurse -Force }
        Expand-Archive -LiteralPath $zip -DestinationPath $tmp -Force
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
        # keep anything already resolved above; only fill in what was missing
        if (-not $ffmpeg) { $ffmpeg = Join-Path $dest 'ffmpeg.exe' }
        if (-not $ffprobe) {
            $p = Join-Path $dest 'ffprobe.exe'
            if (-not (Test-Path -LiteralPath $p)) { throw "ffprobe.exe not present in the archive" }
            $ffprobe = $p
        }
    }

    # ---- yt-dlp ----
    $ytdlp = Find-Existing -Candidates $knownYtDlp -OnPath 'yt-dlp'
    if (-not $ytdlp -or $Update) {
        $dest = Join-Path $toolDir 'yt-dlp.exe'
        Write-Host $(if ($ytdlp) { "updating yt-dlp..." } else { "yt-dlp not found - downloading..." })
        $ProgressPreference = 'SilentlyContinue'
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        # download to a temp name first: an interrupted transfer must not leave
        # a truncated yt-dlp.exe behind that poisons every later run
        $partial = "$dest.download"
        try {
            Invoke-WebRequest -Uri 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe' `
                              -OutFile $partial -UseBasicParsing -TimeoutSec 600
            Move-Item -LiteralPath $partial -Destination $dest -Force
            $ytdlp = $dest
        } catch {
            Remove-Item -LiteralPath $partial -Force -ErrorAction SilentlyContinue
            if (-not $ytdlp) { throw "could not download yt-dlp: $($_.Exception.Message)" }
            Write-Warning "update failed, keeping the existing copy"
        }
    }

    return [pscustomobject]@{ Ffmpeg = $ffmpeg; Ffprobe = $ffprobe; YtDlp = $ytdlp }
}
