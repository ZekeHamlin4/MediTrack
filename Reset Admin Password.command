#!/bin/bash
# MediTrack: reset the home admin password. Double-click on the Mac that runs MediTrack.
# Use it if you forgot your MediTrack password and nobody else can set a temporary one.
# It changes only that password (and signs that account out everywhere). Your data is not touched.
cd "$(dirname "$0")/server" || exit 1
clear

pause_and_exit() {
  read -n 1 -s -r -p "Press any key to close this window."
  echo ""
  exit "$1"
}

if [ "$(uname)" != "Darwin" ]; then
  echo "This tool is for the Mac that runs MediTrack."
  pause_and_exit 1
fi

# Only from the Mac's own screen and keyboard, not from another computer.
if [ -n "$SSH_CONNECTION" ] || [ -n "$SSH_TTY" ]; then
  echo "For safety, run this by double-clicking it on the Mac itself, not over a remote connection."
  pause_and_exit 1
fi

if ! command -v node >/dev/null 2>&1 || [ ! -d node_modules ]; then
  echo "MediTrack isn't installed on this Mac yet. Double-click Install MediTrack first."
  pause_and_exit 1
fi

node reset-admin.js
pause_and_exit $?
