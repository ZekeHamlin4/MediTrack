#!/bin/bash
# MediTrack installer for Mac. Double-click once.
# It sets MediTrack up to start by itself when you log in, restart if it
# crashes, and keep the Mac from idle-sleeping while it runs.
# It never deletes your data. To undo, double-click "Uninstall MediTrack.command".

REPO_DIR="$(cd "$(dirname "$0")" && pwd)"
SERVER_DIR="$REPO_DIR/server"
LABEL="com.meditrack.server"
AGENT_DIR="$HOME/Library/LaunchAgents"
PLIST="$AGENT_DIR/$LABEL.plist"
LOG_DIR="$HOME/Library/Logs/MediTrack"
URL="http://localhost:3000"

pause_and_exit() {
  read -n 1 -s -r -p "Press any key to close this window."
  echo ""
  exit "$1"
}

clear
echo "Installing MediTrack..."
echo ""

if [ "$(uname)" != "Darwin" ]; then
  echo "This installer is for Mac only."
  pause_and_exit 1
fi

cd "$SERVER_DIR" || { echo "Can't find the server folder next to this file."; pause_and_exit 1; }

# 1. Same checks as "Start MediTrack.command": Node 22+, .env, npm install.
if ! command -v node >/dev/null 2>&1; then
  echo "MediTrack needs Node.js, which isn't installed yet."
  echo "Opening the download page. Install the LTS version, then double-click Install MediTrack again."
  open "https://nodejs.org/en/download"
  pause_and_exit 1
fi

NODE_MAJOR=$(node -p "process.versions.node.split('.')[0]")
if [ "$NODE_MAJOR" -lt 22 ]; then
  echo "Your Node.js is too old (version $NODE_MAJOR). MediTrack needs version 22 or newer."
  echo "Opening the download page. Install the LTS version, then try again."
  open "https://nodejs.org/en/download"
  pause_and_exit 1
fi

if [ ! -f .env ]; then cp .env.example .env; fi

if [ ! -d node_modules ] || [ package.json -nt node_modules ]; then
  echo "Installing the parts MediTrack needs (this takes a minute or two)..."
  if ! npm install --no-audit --no-fund; then
    echo ""
    echo "Setup failed. Check your internet connection and try again."
    pause_and_exit 1
  fi
  touch node_modules
fi

# Full path to node, so it still works when started by macOS at login.
NODE_BIN="$(command -v node)"
case "$NODE_BIN" in /*) ;; *) NODE_BIN="$(cd "$(dirname "$NODE_BIN")" && pwd)/$(basename "$NODE_BIN")";; esac

# 2. If MediTrack is already running from the "Start MediTrack" window, it must be closed first.
UID_NUM="$(id -u)"
if ! launchctl print "gui/$UID_NUM/$LABEL" >/dev/null 2>&1; then
  if curl -s -o /dev/null --max-time 2 "$URL"; then
    echo "MediTrack is already running in another window."
    echo "Close that window (or press Control+C in it), then double-click Install MediTrack again."
    pause_and_exit 1
  fi
fi

# 3. Write the LaunchAgent (the macOS "start at login" file).
xml_escape() {
  printf '%s' "$1" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g'
}
mkdir -p "$AGENT_DIR" "$LOG_DIR"

cat > "$PLIST.tmp" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$(xml_escape "$NODE_BIN")</string>
    <string>$(xml_escape "$SERVER_DIR/index.js")</string>
  </array>
  <key>WorkingDirectory</key>
  <string>$(xml_escape "$SERVER_DIR")</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>$(xml_escape "$LOG_DIR/meditrack.log")</string>
  <key>StandardErrorPath</key>
  <string>$(xml_escape "$LOG_DIR/meditrack-error.log")</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>MEDITRACK_KEEP_AWAKE</key>
    <string>1</string>
    <key>MEDITRACK_LOG_DIR</key>
    <string>$(xml_escape "$LOG_DIR")</string>
  </dict>
</dict>
</plist>
EOF
mv "$PLIST.tmp" "$PLIST"

# 4. Load it (unload an older copy first), then wait for MediTrack to answer.
launchctl bootout "gui/$UID_NUM/$LABEL" >/dev/null 2>&1
sleep 1
if ! launchctl bootstrap "gui/$UID_NUM" "$PLIST"; then
  echo ""
  echo "macOS would not start MediTrack in the background."
  echo "Try once more. If it still fails, share this file with whoever helps you with MediTrack:"
  echo "  $LOG_DIR/meditrack-error.log"
  pause_and_exit 1
fi

echo "Starting MediTrack in the background..."
READY=0
for _ in $(seq 1 30); do
  if curl -s -o /dev/null --max-time 2 "$URL"; then READY=1; break; fi
  sleep 1
done

if [ "$READY" != "1" ]; then
  echo ""
  echo "MediTrack didn't answer after 30 seconds."
  echo "Details are in: $LOG_DIR/meditrack-error.log"
  pause_and_exit 1
fi

open "$URL"

LAN_IP="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null)"
SETUP_CODE=""
if curl -s --max-time 3 "$URL/api/setup/status" | grep -q '"needs_setup":true'; then
  SETUP_CODE="$(grep -o 'setup code: [0-9-]*' "$LOG_DIR/meditrack.log" 2>/dev/null | tail -1 | awk '{print $3}')"
fi

cat <<'EOT'

  MediTrack is installed and running.

  - It starts by itself when you log in to this Mac.
  - If it ever crashes, macOS restarts it.
  - It keeps the Mac from idle-sleeping while it runs. The screen can still turn off.
  - You can close this window. MediTrack keeps running.

  Next steps (once):
  1. Keep the Mac awake: see "Keep the Mac awake" in the README
     (Battery or Energy setting; MacBook lid open and charger plugged in).
  2. After the Mac restarts, log in once so MediTrack comes back.
  3. Phones: secure access from anywhere (Tailscale) comes in a later step.
EOT
if [ -n "$LAN_IP" ]; then
  echo "     Until then, a phone on the same Wi-Fi can open: http://$LAN_IP:3000"
fi
cat <<'EOT'

EOT
if [ -n "$SETUP_CODE" ]; then
  echo "  FIRST-TIME SETUP: the browser asks for a setup code. Your code is:  $SETUP_CODE"
  echo "  (It also appeared as a notification. A new code is made each time MediTrack restarts,"
  echo "   until setup is done. The latest one is in $LOG_DIR/meditrack.log)"
  echo ""
fi
cat <<'EOT'
  To remove the background service, double-click "Uninstall MediTrack.command".
  Your data is never deleted.

EOT
pause_and_exit 0
