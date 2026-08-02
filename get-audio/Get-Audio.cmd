@echo off
REM Double-click to process every entry in urls.txt.
REM Or drag a video file / paste a URL as an argument:
REM     Get-Audio.cmd "https://youtu.be/XXXX"
REM     Get-Audio.cmd "C:\path\to\video.mp4"

setlocal
set "HERE=%~dp0"

if "%~1"=="" (
    powershell -NoProfile -ExecutionPolicy Bypass -File "%HERE%Get-Audio.ps1"
) else (
    powershell -NoProfile -ExecutionPolicy Bypass -File "%HERE%Get-Audio.ps1" -Url "%~1"
)

echo.
pause
