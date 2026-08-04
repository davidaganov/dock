@echo off
REM Rebuilds ONLY the Windows tray launcher (C# WinForms).
REM NOT needed after changing server.js / public/* — those load live from disk.
REM Run this when you change tray/*.cs, or once if EXE is missing.
REM start-win.bat tray auto-builds when EXE does not exist.

cd /d "%~dp0"

where dotnet >nul 2>&1
if errorlevel 1 (
  echo .NET SDK not found. Install from https://dotnet.microsoft.com/download
  pause
  exit /b 1
)

echo Building Dock tray launcher...
dotnet build tray -c Release
if errorlevel 1 (
  pause
  exit /b 1
)

echo.
echo Done: tray\bin\Release\net10.0-windows\Dock.exe
echo Tip: for UI/server changes just restart Node (start-win.bat console / refresh browser).
echo Run start-win.bat to launch in system tray.
