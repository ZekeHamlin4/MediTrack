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
| M1 Data foundation and migration | **Done** |
| M2 + M3 Sign-in and permission checks | Next |
| M10 Phone access over Tailscale | Not started |
| M11 Documents | Not started |
| M12 (email) + M18 Provider email alerts | Not started |
| M16 Nightly encrypted backup | Not started |

---

## M1. Data foundation and in-place upgrade (done)

### What changed
- **New `server/migrations.js`:** numbered database upgrades. The database stores its version in `PRAGMA user_version` (0 = before M1, now 1).
  - Each upgrade runs in one transaction: if anything fails, **nothing is changed** and MediTrack doesn't start (it prints a plain message).
  - **Before upgrading a database that has data, a full copy is saved next to it**: `server/meditrack-before-v1-<date>-<time>.db`. It is not encrypted (same as the database itself) and is ignored by git.
  - A database from a newer MediTrack is refused instead of being opened.
- **Upgrade v0 → v1** (from spec section 8, limited to what Phase 1a needs now):
  1. one household row (`organizations`)
  2. accounts: `users` gets `org_id`, `title`, `password_hash`, `is_home_admin`, `active`, `failed_logins`, `locked_until`, `last_login_at`. **All old users are deactivated and their plain-text PINs cleared** (they never had passwords; the home admin adds people again in M2).
  3. the child moves from `patient_profile` into the new `patients` table. The name is split at the first space ("Mary Ann Smith" → "Mary" + "Ann Smith"), so joining them gives back exactly the old name. The old `patient_profile` table is **kept untouched**.
  4. `supplies`, `scan_log`, `providers`, `tasks`, `outbox` get `patient_id` (filled in for every old row) and `version`.
  5. new tables: `patients`, `patient_members` (one patient admin per patient), `sessions` (only hashed tokens will be stored), `audit_log`, `settings` (`signups_open` = 0).
- **No demo data on fresh installs:** the 5 demo users and 35 demo supplies are no longer added. Existing supplies are kept as they are (they may hold real counts now).
- **`server/db.js`:** opens the database, runs the upgrade, adds small helpers (current patient, audit-log write, settings). `MEDITRACK_DB_PATH` can point to another file (used for testing).
- **Existing screens:** the profile/setup wizard now reads and writes the `patients` row; new supplies, scans, providers, tasks and drafts are saved with the patient's id; edits raise `version`. The old Users screen lists only active people and **no longer stores PINs**.
- **Server start/stop** is recorded in settings and the audit log (no health data).
- **New tests:** `server/test/migrations.test.js` (run with `cd server && npm test`).

### How Zeke can try it (on the Mac)
1. **Optional but wise:** copy `server/meditrack.db` somewhere safe first (MediTrack also makes its own copy).
2. Get the new version and restart MediTrack: if you used the installer, double-click `Install MediTrack.command` again (it restarts the background copy); otherwise close the Start window and double-click `Start MediTrack.command`. It runs the "installing" step once more because a settings file changed; that's normal.
3. The log (`~/Library/Logs/MediTrack/meditrack.log`, or the Start window) says "Upgrading the MediTrack database. A copy of the old one was saved first: …" and "Database upgraded to version 1".
4. Open MediTrack. Care Team, Tasks, Supplies, drafts and the child's profile should look exactly as before.
5. The **Users** screen is now empty and the "Logged by" list on Scan is empty: the old demo users were switched off on purpose. Real accounts come with sign-in (next step).
6. A new file `server/meditrack-before-v1-….db` is there. Keep it until you're happy everything is still there, then you can delete it.

### What Zeke must do
- Nothing new to install.

### How it was tested
- **Real pre-M1 database:** ran the previous code (from git) on its own copy, added a profile, a provider with departments, a task with steps, a draft, a scan, a custom supply and a user with a PIN through its API, then stopped it the way macOS does (SIGTERM, leaving the `-wal` file in place). Upgraded a copy with the new code:
  - all **47 old rows compared column by column**: identical, except the cleared PINs (and one supply quantity I changed on purpose after the upgrade)
  - the safety copy matched the old database exactly
  - 6 old users deactivated, 0 PINs left, every row in the 5 tables has `patient_id`, 1 patient, 1 household, no broken links
  - restarted: no second upgrade, no second copy, no duplicate patient
  - adding/editing supplies, scans, providers, tasks, drafts and the profile works; new rows get `patient_id`, edits raise `version`; the name round-trips
  - audit log: `database_upgraded`, `server_start`, `server_stop` (SIGTERM and SIGINT)
- **Headless Chrome** on the upgraded database: Care Team, Supplies and Tasks screens render with the old data, no page errors (the CDN libraries were served from local copies of the same packages because the build machine can't reach the CDN).
- **Fresh install:** version 1, no users, no supplies, one empty patient; the setup wizard's profile save and "onboarded" work.
- **`npm test`:** 6 tests pass (fresh install, upgrade keeps every row, second run does nothing, a failed upgrade changes nothing, newer database refused, name split).

### Known gaps (on purpose; they come with later steps)
- From spec section 8's upgrade list, these wait for their steps: **setup code → home admin account**, making that account the patient admin and **confirming the name split and DOB** (M2 first run); "mark the inbox as seen" (M12); first encrypted backup (M16). "Pick alert items" (low-stock push) is not in Phase 1a.
- Tables added by the step that first uses them (as new numbered upgrades), so they aren't guessed now: documents (M11), email connection, seen provider emails, push subscriptions (M12/M18), backups settings (M16), password-reset tokens (M2 if needed). Not in Phase 1a: invites, join requests, admin transfers, AI consent and usage.
- Lists are not filtered by patient yet; that comes with the permission checks (M3, `/api/patients/:pid/…`). With one patient this changes nothing.
- Barcodes are still unique across the whole install (spec: per patient). Fine with one patient; fix when a second patient is possible.
- The old Users screen can still add a name without a login; M2 replaces it with Settings → Add person.

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
- **"Online since" in Settings:** since M1 the start/stop times are recorded (settings `server_started_at` / `server_stopped_at`, audit lines `server_start` / `server_stop`). The Settings screen that shows them comes later.
- **Setup code in a macOS notification** comes with sign-in (M2).
- **Checking the mailbox right away after downtime + "emails arrived while offline" summary** comes with provider email alerts (M12/M18).
- The installer does not run a "client build" yet: there is none until M13's bundling, which is not in Phase 1a.
- If Node is later reinstalled in a different place (for example via Homebrew), run `Install MediTrack.command` again so the LaunchAgent points to the new `node`.
- Windows: the `.bat` launcher is unchanged; Windows setup is not part of Phase 1.
