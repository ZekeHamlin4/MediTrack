# MediTrack build notes (Phase 1a)

Build order used: section 5 of `docs/design-spec.md` says "Build in this order",
limited to what Phase 1a needs: **M0** (Mac setup) → **M1** (migrations) →
**M2 + M3** (sign-in, permissions) → **M10** (Tailscale) → **M11** (documents) →
**M12 email part + M18** (provider email alerts) → **M16 backups** (+ **M13**
web app shell and **M17** audit-log writes where each step needs them).

## Status

| Step | Status |
|---|---|
| M0 Mac install, auto-start, stay awake | **Done** (needs checking on Zeke's Mac) |
| M1 Data foundation and migration | Next |
| M2 + M3 Sign-in and permission checks | Not started |
| M10 Phone access over Tailscale | Not started |
| M11 Documents | Not started |
| M12 (email) + M18 Provider email alerts | Not started |
| M16 Nightly encrypted backup | Not started |

---

## M0. Mac install, auto-start, stay awake (done)

### What changed
- **New `Install MediTrack.command`** (repo root, double-click once):
  - same checks as the Start launcher (Node 22+, `server/.env`, `npm install`)
  - stops if MediTrack is already running in a Start window ("close that window first")
  - writes `~/Library/LaunchAgents/com.meditrack.server.plist`: full path to `node` and `server/index.js`, working folder `server/`, start at login, restart if it stops, logs to `~/Library/Logs/MediTrack/`, `MEDITRACK_KEEP_AWAKE=1`
  - loads it with `launchctl bootstrap`, waits up to 30 s for MediTrack to answer, opens `http://localhost:3000`, prints plain next steps
- **New `Uninstall MediTrack.command`:** unloads and removes the LaunchAgent. Never deletes data.
- **`Start MediTrack.command`:** if the background service is loaded, it just opens the browser.
- **New `server/macos.js`**, used by `server/index.js` at start-up:
  - keep-awake: on a Mac with `MEDITRACK_KEEP_AWAKE=1`, runs `/usr/bin/caffeinate -i -s -w <MediTrack's pid>`. It ends by itself when MediTrack stops.
  - log rotation: when a log file passes 5 MB it keeps one `.old` copy and empties the current file (checked at start and every 6 hours). Logs hold no health data.
- **README:** "Run MediTrack in the background" and "Keep the Mac awake" sections (Battery/Energy settings, lid open + charger, log in after restarts, macOS update setting, FileVault).

### How Zeke can try it (on the Mac)
1. If a "Start MediTrack" window is open, close it.
2. Double-click `Install MediTrack.command`. The first time macOS may block it: right-click → **Open** → **Open**.
3. Wait for "MediTrack is installed and running." MediTrack opens in the browser. Close the window.
4. Check it stays up: open `http://localhost:3000` again. It should still work with no Terminal window open.
5. Check keep-awake: open **Activity Monitor**, search for `caffeinate`. It should be listed.
   (Or in Terminal: `pmset -g assertions | grep caffeinate`.)
6. Check auto-start: restart the Mac, log in, wait a minute, open `http://localhost:3000`.
7. Check crash restart (optional): in Terminal, `pkill -f "server/index.js"`; after about 10 seconds the page loads again.
8. Double-click `Start MediTrack.command`: it should just open the browser.
9. To undo: double-click `Uninstall MediTrack.command`. The page stops loading; your data is still there next time you start.

### What Zeke must do on the Mac (once)
- Install Node.js LTS (22 or newer) from nodejs.org if it isn't there.
- System Settings, as listed in the README "Keep the Mac awake" section. Menu names vary by macOS version: please tell the builder if one is named differently on your Mac.
- MacBook: keep the lid open and the charger plugged in.

### How it was tested (on a Linux build machine, not a Mac)
- `bash -n` on all three `.command` files.
- Ran the installer end to end with stand-in versions of the Mac-only commands (`launchctl`, `open`, `ipconfig`, `uname`): it wrote a valid plist (read back with Python's `plistlib`), "started" the server from the plist's own settings, waited for it, and printed the next steps. Also checked: Start opens the browser when the service is loaded; Uninstall removes the plist; Install refuses while a manual copy is running.
- Unit checks for `server/macos.js`: `caffeinate` is started only on a Mac with the setting on, with the right flags and pid; log rotation keeps a `.old` copy and empties files over the limit.
- Started the server normally and checked the existing screens' data still load (Supplies, Care Team, Tasks, Dashboard, profile).
- **Not tested on a real Mac.** `launchctl`, `caffeinate`, the LaunchAgent at login and the System Settings names must be checked on Zeke's Mac (steps above).

### Known gaps (come with later steps)
- **Offline screen on phones** needs the service worker (M13 web app shell); added with the Tailscale/phone step.
- **"Online since" in Settings and server start/stop in the audit log** need the database upgrade (M1) and the audit log (M17); added with those steps.
- **Setup code in a macOS notification** comes with sign-in (M2).
- **Checking the mailbox right away after downtime + "emails arrived while offline" summary** comes with provider email alerts (M12/M18).
- The installer does not run a "client build" yet: there is none until M13's bundling, which is not in Phase 1a.
- If Node is later reinstalled in a different place (for example via Homebrew), run `Install MediTrack.command` again so the LaunchAgent points to the new `node`.
- Windows: the `.bat` launcher is unchanged; Windows setup is not part of Phase 1.
