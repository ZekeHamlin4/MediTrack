#!/bin/bash
# MediTrack launcher for Mac. Double-click to start.
cd "$(dirname "$0")/server" || exit 1
clear
echo "Starting MediTrack..."

if ! command -v node >/dev/null 2>&1; then
  echo ""
  echo "MediTrack needs Node.js, which isn't installed yet."
  echo "Opening the download page. Install the LTS version, then double-click Start MediTrack again."
  open "https://nodejs.org/en/download"
  read -n 1 -s -r -p "Press any key to close this window."
  exit 1
fi

NODE_MAJOR=$(node -p "process.versions.node.split('.')[0]")
if [ "$NODE_MAJOR" -lt 22 ]; then
  echo ""
  echo "Your Node.js is too old (version $NODE_MAJOR). MediTrack needs version 22 or newer."
  echo "Opening the download page. Install the LTS version, then try again."
  open "https://nodejs.org/en/download"
  read -n 1 -s -r -p "Press any key to close this window."
  exit 1
fi

if [ ! -f .env ]; then cp .env.example .env; fi

if [ ! -d node_modules ] || [ package.json -nt node_modules ]; then
  echo "First-time setup: installing (this takes a minute or two)..."
  if ! npm install --no-audit --no-fund; then
    echo ""
    echo "Setup failed. Check your internet connection and try again."
    read -n 1 -s -r -p "Press any key to close this window."
    exit 1
  fi
  touch node_modules
fi

MEDITRACK_OPEN_BROWSER=1 node index.js
read -n 1 -s -r -p "MediTrack stopped. Press any key to close this window."
