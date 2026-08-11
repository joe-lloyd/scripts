@echo off
REM Double-click to process every entry in urls.txt.
REM Or drag one or more video files onto this, or paste URLs as arguments:
REM     Get-Audio.cmd "https://youtu.be/XXXX" "https://youtu.be/YYYY"
REM     Get-Audio.cmd "C:\path\to\video.mp4"
REM Quote URLs -- unquoted & or = would be eaten by cmd.

setlocal
set "HERE=%~dp0"

if "%~1"=="" (
    powershell -NoProfile -ExecutionPolicy Bypass -File "%HERE%Get-Audio.ps1"
) else (
    REM powershell -File cannot take an array argument, so run once per item
    for %%F in (%*) do (
        powershell -NoProfile -ExecutionPolicy Bypass -File "%HERE%Get-Audio.ps1" -Url "%%~F"
    )
)

echo.
pause
