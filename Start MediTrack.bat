@echo off
REM MediTrack launcher for Windows. Double-click to start.
title MediTrack
cd /d "%~dp0server"
echo Starting MediTrack...

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo MediTrack needs Node.js, which isn't installed yet.
  echo Opening the download page. Install the LTS version, then double-click Start MediTrack again.
  start "" "https://nodejs.org/en/download"
  pause
  exit /b 1
)

for /f %%v in ('node -p "process.versions.node.split('.')[0]"') do set NODE_MAJOR=%%v
if %NODE_MAJOR% LSS 22 (
  echo.
  echo Your Node.js is too old ^(version %NODE_MAJOR%^). MediTrack needs version 22 or newer.
  echo Opening the download page. Install the LTS version, then try again.
  start "" "https://nodejs.org/en/download"
  pause
  exit /b 1
)

if not exist .env copy .env.example .env >nul

if not exist node_modules\better-sqlite3 (
  echo First-time setup: installing ^(this takes a minute or two^)...
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo.
    echo Setup failed. Check your internet connection and try again.
    pause
    exit /b 1
  )
)

set MEDITRACK_OPEN_BROWSER=1
node index.js
pause
