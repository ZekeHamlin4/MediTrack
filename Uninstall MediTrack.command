#!/bin/bash
# Stops MediTrack from running in the background and starting at login.
# It NEVER deletes your data (the database stays in the server folder).

LABEL="com.meditrack.server"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"

clear
echo "Removing the MediTrack background service..."
launchctl bootout "gui/$(id -u)/$LABEL" >/dev/null 2>&1
rm -f "$PLIST"

cat <<'EOT'

  Done. MediTrack is stopped and won't start at login any more.
  Your data was NOT deleted.

  To use MediTrack again, double-click "Start MediTrack.command"
  (or "Install MediTrack.command" to make it start by itself again).

EOT
read -n 1 -s -r -p "Press any key to close this window."
echo ""
