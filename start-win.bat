@echo off
setlocal EnableExtensions
cd /d "%~dp0"

set "MODE=%~1"
if "%MODE%"=="" set "MODE=tray"

if /i "%MODE%"=="tray" goto :tray
if /i "%MODE%"=="server" goto :server
if /i "%MODE%"=="console" goto :console

echo Usage: start-win.bat [tray^|server^|console]
echo   tray     - system tray (default)
echo   server   - Node server only (used by tray EXE)
echo   console  - visible server window + browser
exit /b 1

:init_node
where node >nul 2>&1
if not errorlevel 1 exit /b 0

if exist "%USERPROFILE%\scoop\shims" set "PATH=%USERPROFILE%\scoop\shims;%PATH%"
if exist "%USERPROFILE%\scoop\apps\fnm\current" set "PATH=%USERPROFILE%\scoop\apps\fnm\current;%PATH%"
if exist "%LOCALAPPDATA%\fnm" set "PATH=%LOCALAPPDATA%\fnm;%PATH%"
if exist "%ProgramFiles%\nodejs" set "PATH=%ProgramFiles%\nodejs;%PATH%"
if exist "%LOCALAPPDATA%\Programs\node" set "PATH=%LOCALAPPDATA%\Programs\node;%PATH%"

where fnm >nul 2>&1
if not errorlevel 1 (
  for /f "tokens=*" %%i in ('fnm env --use-on-cd --shell cmd 2^>nul ^| findstr /b /i "SET "') do set %%i
  if defined FNM_DIR if exist "%FNM_DIR%\aliases\default\node.exe" set "PATH=%FNM_DIR%\aliases\default;%PATH%"
)

if exist "%USERPROFILE%\scoop\persist\fnm\aliases\default\node.exe" (
  set "PATH=%USERPROFILE%\scoop\persist\fnm\aliases\default;%PATH%"
)

if exist "%APPDATA%\nvm\nvm.exe" (
  for /f "tokens=*" %%i in ('"%APPDATA%\nvm\nvm.exe" current 2^>nul') do (
    if exist "%APPDATA%\nvm\%%i\node.exe" set "PATH=%APPDATA%\nvm\%%i;%PATH%"
  )
)

if exist "%USERPROFILE%\.volta\bin\node.exe" set "PATH=%USERPROFILE%\.volta\bin;%PATH%"

where node >nul 2>&1
exit /b %errorlevel%

:tray
set "EXE=%~dp0tray\bin\Release\net10.0-windows\Dock.exe"
if not exist "%EXE%" (
  if not exist "%~dp0build-tray.bat" (
    echo build-tray.bat not found.
    pause
    exit /b 1
  )
  call "%~dp0build-tray.bat"
  if errorlevel 1 exit /b 1
  if not exist "%EXE%" (
    echo Failed to build Dock.exe
    pause
    exit /b 1
  )
)
start "" "%EXE%"
exit /b 0

:server
call :init_node
if errorlevel 1 (
  echo Node.js not found in PATH.
  echo Install from https://nodejs.org or via fnm / nvm / volta, then retry.
  exit /b 1
)
node server.js
exit /b %errorlevel%

:console
call :init_node
if errorlevel 1 (
  echo Node.js not found in PATH.
  echo Install from https://nodejs.org or via fnm / nvm / volta.
  pause
  exit /b 1
)

curl -s -o nul http://127.0.0.1:3848/ 2>nul
if not errorlevel 1 (
  echo Server already running, opening browser...
  start http://127.0.0.1:3848
  exit /b 0
)

echo Starting Dock...
start "Dock" cmd /k "%~f0" server
timeout /t 2 /nobreak >nul
start http://127.0.0.1:3848
exit /b 0
