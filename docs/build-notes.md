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
| M2 + M3 Sign-in and permission checks | **Done** (needs checking on Zeke's Mac and phone) |
| Fix 1: nothing typed twice at first run | **Done** |
| Fix 2: provider search by ZIP, nearest first | **Done** (needs a real-registry check on Zeke's Mac) |
| Fix 3: search shown every time a provider is added | Not started |
| Reset home admin password (Mac tool) | Not started (after the 3 fixes) |
| M10 Phone access over Tailscale | After the fixes |
| M11 Documents | Not started |
| M12 (email) + M18 Provider email alerts | Not started |
| M16 Nightly encrypted backup | Not started |

---

## Zeke's decisions (Nov 16, after testing sign-in on his Mac)
1. Sessions lasting **30 days from last use** are fine.
2. **Skip the quick PIN** for now.
3. **Yes** to a "reset admin password" tool run on the Mac. Build it as its own step **after** Fixes 1-3.
4. Before M10, three fixes, **one at a time**, each with test steps:
   - Fix 1: nothing should be entered twice at first run; prefill what MediTrack already knows.
   - Fix 2: provider search by ZIP, nearest locations first. Zeke approves how "nearest" works **before** it's built.
   - Fix 3: after saving a provider, "add another" should show the search again, with "type it in myself" as a backup.

---

## Fix 2. Provider search near a ZIP, nearest first (done)

Zeke approved the plan on Nov 16: **25 miles** by default with a **"Search wider (50 miles)"** button; **every office is its own row**, sorted nearest first (not grouped); **straight-line** distance between ZIP centers is fine.

### What changed
- The provider search (Care Team → "Find providers near me", and step 2 of the setup wizard) now has two buttons: **Near a ZIP code** and **By city and state**.
  - "Near a ZIP code" is chosen first when the child's profile has a ZIP, and the ZIP is filled in from the profile.
  - City and state search works exactly as before: same request to the registry, same results.
- **How "nearest" works:**
  1. MediTrack finds every ZIP within 25 miles (or 50) using a bundled list of ZIP centers.
  2. It asks the NPI registry for those areas (by the first 3 ZIP digits, so it also crosses state lines). It asks for up to 3 pages of 200 per area.
  3. It keeps practice offices only (a mailing address nearby doesn't count). Each office, including extra practice locations of the same provider, is its own row.
  4. It measures straight-line miles from the center of the family's ZIP to the center of the office's ZIP, drops offices beyond the limit, and sorts nearest first.
  5. Each row shows "about N miles" (or "less than 1 mile"). The same office returned twice is shown once.
- **Messages:**
  - Unknown ZIP: "We can't place ZIP … on the map (it may be a PO-box-only ZIP). Try a nearby ZIP, or search by city and state."
  - No internet or the registry is down: "Provider search needs the internet right now … type the provider in yourself."
  - More than 600 matches in an area: "There were more matches than MediTrack can show at once. Add a company name to narrow the search."
- **What goes to the registry:** the ZIP's first 3 digits plus `*`, the provider type (or the company name) and page numbers. No patient information. No cost, no API key.
- **ZIP data:** `server/data/zip-centroids.csv` (33,791 ZIP areas, about 0.9 MB), loaded when the first ZIP search runs.
  - **Source:** US Census Bureau **2022** Gazetteer, ZIP Code Tabulation Areas national file (public domain).
  - **Taken from** the npm package **us-zips 2022.9.1** (MIT licence, © 2021 Blake Knight), which packages that Census file. The Census website was blocked from the build machine.
  - Source, date and licence text are in `server/data/zip-centroids-SOURCE.txt`.
- **Files:** new `server/nearby.js`, `server/data/zip-centroids.csv`, `server/data/zip-centroids-SOURCE.txt`, `server/test/nearby.test.js`; changed `server/care.js` (new route `GET /api/lookup/nearby`, sign-in required), `client/care.jsx` (search screen).

### How Zeke can test it (on the Mac, with the real registry)
1. Restart MediTrack so it picks up the new version (double-click `Install MediTrack.command` again, or close and reopen the Start window).
2. Sign in and open **Care Team** → **Find providers near me**.
3. **Near a ZIP code** should already be selected, with your ZIP filled in (if the child's profile has one). Otherwise type your 5-digit ZIP.
4. Leave "Looking for" on **DME / Medical Supply** and press **Search**. Expect a list "… found within 25 miles of [ZIP], nearest first", each row with "about N miles", the closest at the top. Check that a company you know shows up near the top with the right address.
5. Press **Search wider (50 miles)**: more results, farther ones at the bottom.
6. Type a company you use in **Company name** (e.g. Apria) and search again. Each of its offices should be its own row, nearest first.
7. Tick one office and press **Add 1 selected to care team**. It appears in Care Team with that office's phone and fax.
8. Type `00000` as the ZIP and search: a plain "can't place ZIP" message.
9. Press **By city and state**, pick your city and state, and search: it should work as before.
10. Please tell the builder if the counts look odd (very few results, or the "more matches than MediTrack can show" message for a plain DME search).

### How it was tested
- `npm test`: **28 of 28 pass**. The 11 new tests use a pretend registry:
  - nearest first with correct miles, offices beyond 25 miles dropped and shown at 50
  - the 3-digit ZIP areas asked for, and only ZIP, type and paging sent
  - a company with 3 offices (one 99 miles away, dropped) plus a branch with its own NPI: 3 separate rows, nearest first
  - a nearby mailing address doesn't count
  - 450 results → 3 pages and all kept; 700 results → stops at 600 and shows the "more matches" note
  - the same office twice → shown once
  - company name search sends the name instead of the type
  - Cincinnati search includes northern Kentucky
  - unknown ZIP / bad ZIP → message, nothing sent
  - registry unreachable or HTTP error → "needs the internet" message
  - ZIP list loads and Columbus → Cincinnati is about 100 miles
  - **city and state search sends exactly the same request as before** and returns the same fields
- **Do the tests catch mistakes?** Removing the 25-mile cut-off made 3 tests fail; removing the nearest-first sort made 1 fail. Both were put back.
- **Browser (headless Chrome, phone size, pretend registry):**
  - In the setup wizard with ZIP 43215, "Near a ZIP code" was pre-selected and the ZIP filled in.
  - 25 miles: 4 offices, nearest first ("less than 1 mile" … "about 12 miles"). The company with two offices showed 2 rows.
  - 50 miles: 5 rows, the farthest "about 39 miles".
  - Ticked both offices → both added to Care Team.
  - ZIP 00000 → message. City and state search still returns results.
  - No page errors.

### Only checkable against the real registry (uncertain until Zeke tries it)
- The registry couldn't be reached from the build machine, so the request format is based on its documentation. Things to confirm:
  - that a ZIP ending in `*` (e.g. `432*`) is accepted
  - that `skip` paging works
  - that extra offices come back as `practiceLocations`
  - how results look when a ZIP search matches mailing addresses (we filter those out)
- If the wildcard isn't accepted, the search will show the "registry" error message. The fix would be to ask by exact 5-digit ZIPs instead.
- Speed: a 25-mile search makes about 3 to 10 registry requests (4 at a time). It should take a few seconds; untested on a real connection.
- ZIP data is from 2022. New ZIPs since then show the "can't place ZIP" message.
- Straight-line distance between ZIP centers is accurate to a few miles. Mail-order DME companies with no nearby office won't rank as near.

---

## Fix 1. Nothing typed twice at first run (done)

### What was typed twice
I compared the account form (first run) with the child's setup screens:
- **Account form:** setup code, your name, title, email, password, 18+.
- **Setup wizard step 1 (new installs):** child's name, birth date, **your name**, your phone, **your email**, address, insurance, diagnoses, equipment.
- **"Check your child's details" (upgraded installs):** first name, last name, birth date. These come already filled from the old profile; nothing is retyped.

So the repeats were **"Your name"** and **"Your email"**.

### What changed
- When the home admin account is created, MediTrack copies its name and email into the child's profile ("Your name", "Your email"). The wizard now shows them **already filled in**, and they can still be changed there.
- It **never overwrites** something already in the profile. On an upgraded install, an existing parent name stays; only empty fields are filled.
- Title ("Dad") isn't asked on the child's screens, so there's nothing to copy.
- Files: `server/auth.js`, `server/test/auth.test.js`.

### How Zeke can test it (on the Mac, without touching his real data)
His real MediTrack is already set up, so try it on a throw-away test copy:
1. Open **Terminal** (Applications → Utilities → Terminal).
2. Type `cd ` (with a space), drag the MediTrack **server** folder onto the Terminal window, and press Return.
3. Paste this and press Return:
   `MEDITRACK_DB_PATH=/tmp/mt-test.db PORT=3001 node index.js`
   The window shows a **setup code** (a notification also appears). Your real MediTrack keeps running; this test copy uses port 3001 and a separate test database.
4. In the browser, open `http://localhost:3001`. Enter the code, your name, email and a password, tick 18+, then **Create my account**. Tap **Done** on the checklist.
5. On "Welcome to MediTrack, step 1", **Your name** and **Your email** should already be filled in with what you just typed.
6. When finished, go back to Terminal and press **Control + C**. Then paste `rm /tmp/mt-test.db*` and press Return to delete the test copy.

### How it was tested
- `npm test`: **17 of 17 pass**. New checks: after setup, the profile has the account's name and email; on a profile that already has a parent name, the name is kept and only the empty email is filled.
- Headless Chrome, **fresh install**: the wizard opened with "Your name" = the account name and "Your email" = the account email, "Your phone" empty. The wizard finished and the app loaded with no page errors.
- Headless Chrome, **upgraded pre-M1 database**: the full flow still works (child details, all tabs, adding a nurse, nurse sign-in), with no page errors. Afterwards the profile kept its old parent name "Test Parent" and gained the account email in the empty "Your email" field.

### Known gaps
- Zeke's real install was set up before this fix, so his profile isn't filled in after the fact. He can type his email once in the profile if it's empty.

---

## M2 + M3. Sign-in and permission checks (done)

### What changed
**Sign-in (M2), Phase 1a version**
- **First run:** when there's no home admin yet, MediTrack makes an 8-digit **setup code** each time it starts. It shows the code in the log/Start window, as a Mac notification, and at the end of `Install MediTrack.command`. The setup screen asks for the code, then name, title, email, password (10+ characters) and "I am 18 or older". After 5 wrong codes a new code is made.
  - That account becomes the **home admin** and the **patient admin** of the child.
  - Next comes the "Keep this Mac awake" checklist. Then, on an upgraded install, "Check your child's details" (first name, last name, birth date) confirms the name split from M1. A new install goes on to the existing setup wizard.
- **Sign in** with email + password. A wrong email and a wrong password get the same answer.
- **Lockout:** 5 wrong passwords lock the account for 15 minutes. The home admin can unlock it sooner.
- **Settings → People** (home admin only): add a person (name, title, email, temporary password) with the trust note in orange, unlock, set a temporary password, turn off / turn back on. A person who has a temporary password must choose their own before anything else works. Every active account is a member of the child (Phase 1a rule).
- **My account:** signed-in devices (sign out any of them), change password (signs out your other devices), sign out.
- **Security:** passwords hashed with scrypt (random salt). Session tokens are random, and only their SHA-256 hash is stored. The cookie is `HttpOnly`, `SameSite=Lax`, and `Secure` over HTTPS (the Tailscale address). Sessions end after **30 days without use** (the spec doesn't set a length, so this is my default). Database upgrade v2 adds `must_change_password`.
- Old pre-M1 users: if Zeke adds someone with the same email as an old (switched-off) user, that old record is reused, so their past scan history stays linked.

**Permission checks (M3)**
- **Every API call** needs a signed-in account, except setup status, setup (needs the code), sign-in and sign-out. Not signed in → **401**. Not allowed (Settings for non-admins, or before choosing own password) → **403**. Missing, or another patient's data → **404**.
- Patient data moved to **`/api/patients/<id>/…`** with a membership check. Every query only touches that patient's rows, and links (a task's provider, a draft's task) must point to the same patient.
- **`cors()` removed** (and the `cors` package). **Same-origin check:** any request that changes something must come from MediTrack's own page (Origin or Referer must match the address used). The Tailscale address passed on by `tailscale serve` is accepted.
- "Logged by" on scans is now always the signed-in person (fixes the impersonation gap). The "Logged by" picker and the old Users screen (plain-text PINs) are gone.
- **Assistant hidden** (Phase 1a rule): the tab, the "Ask assistant" buttons and its server routes are off. `server/assistant.js` is kept, not connected.
- **Audit log** lines: setup, sign-in (ok / failed / blocked while locked), lockout, unlock, sign-out, device signed out, password changed, temporary password, account added / off / on, email sent. Never passwords or health details.
- Small fixes in code this step touched: deleting a draft or record that doesn't exist now says "not found" (it used to say "deleted"); server errors no longer show internal messages.

**Files:** new `server/auth.js`, `server/app.js` (the API with all checks in one place), `server/supplies.js` (supply routes moved out of `index.js`), `client/account.jsx`; changed `server/index.js`, `care.js`, `email.js`, `macos.js`, `migrations.js`, `package.json`/`package-lock.json`, `client/index.html`, `client/care.jsx`, `Install MediTrack.command`, `README.md`; new tests `server/test/auth.test.js`.

### How Zeke can try it (on the Mac)
1. Optional: copy `server/meditrack.db` somewhere safe.
2. Get the new version. Double-click `Install MediTrack.command` again (or use `Start MediTrack.command`).
3. At the end of the Install window, note the **setup code** (also in a Mac notification, and in `~/Library/Logs/MediTrack/meditrack.log`). With the Start window, it's printed there.
4. MediTrack opens in the browser and asks for the code. Enter it and create **your** account (use a password you'll remember; 10+ characters).
5. Read the keep-awake checklist → **Done**. Then check your child's first/last name and birth date → **Looks right**.
6. Check Care Team, Tasks, Supplies: everything should be as before.
7. **Settings → People → + Add person**: add yourself a test "Nurse" with a test email and a temporary password.
8. **Sign out** (top right). Sign in as the test nurse: it asks to choose a new password, then shows the app without the Settings tab.
9. Try a wrong password 5 times: the 6th try says the account is locked. Sign in as yourself, Settings → People → **Unlock**.
10. On a phone on the same Wi-Fi (http://<Mac's address>:3000) you can sign in too. (Phone access from anywhere over HTTPS is the next step.)

### What Zeke must do
- Nothing to install. Keep the setup code private until setup is done (anyone who can open MediTrack and has the code could create the home admin).
- If he forgets his own password before adding anyone else: there's no reset by email yet. Recovery is in "Known gaps" below.

### How it was tested
- **`npm test`: 16 of 16 pass**: 10 new sign-in/permission tests plus the 6 database tests.
  - Every route in every router (found automatically) answers 401 without sign-in. The old `/api/users` and the assistant answer 404.
  - Same-origin: no Origin → 403, another website → 403 (even with a valid cookie), same-site Referer → OK, Tailscale forwarded host → OK.
  - Cookie flags (HttpOnly, SameSite=Lax, Secure over HTTPS), and only hashes are stored.
  - Setup: wrong code, 5 wrong codes make a new one, short password, 18+, runs only once.
  - Temporary password → 403 until changed. Nurse can't use Settings. Scans are logged as the signed-in person.
  - Another patient's data → 404 by list, by id, edit and delete. Linking to it → 400.
  - Lockout after 5, refused while locked even with the right password, works again after 15 minutes, admin unlock; unknown email and wrong password look the same.
  - Sessions: expiry, 30 days and refreshed on use, sign-out, sign out another device, turned-off account. The admin can't turn themselves off. Temporary password reset.
  - Audit lines are present and contain no passwords.
- **Do the tests catch mistakes?** I removed the sign-in check: the "every route" test failed. I removed the same-origin check: its test failed. Both were put back.
- **Headless Chrome, phone-size screen, on an upgraded pre-M1 database:** wrong setup code message → account → checklist → child details (showed "Testkid" / "Mary Example", fixed to "Testkid Mary" / "Example") → all tabs load with the old data. Settings shows the trust note; added the nurse; My account device list; sign out. The nurse's wrong password gets the message, then the "choose your password" screen, then the app without Settings. No page errors.
- **Fresh install in Chrome:** setup → checklist → the existing setup wizard → Care Team.
- **Installer (with stand-ins for Mac commands):** prints the setup code at the end, matching the log.
- **Not tested on a real Mac or phone:** the notification, Safari on iPhone, cookies over the Tailscale HTTPS address.

### Known gaps
- **Quick PIN per device** (spec M2, optional) is **not built**. The Phase 1a "done when" list doesn't need it. Say if you want it.
- **Forgot password by email** needs the connected mailbox (M12). For now the home admin sets a temporary password.
- **If the home admin forgets their own password** and there's no one else: there is no in-app way back yet. Restoring the copy made before the upgrade loses the account setup but not the data. A proper Mac-side "reset home admin" tool can be added; tell me if you want it now.
- The same-origin check trusts the address the browser used, plus the Tailscale forwarded address. **Check it on the phone in M10.**
- Lists aren't filtered by "patient chosen" on screen (no patient switcher in 1a; one patient is chosen automatically).
- `server/assistant.js` still uses the old (pre-M3) data calls. It must be updated when the assistant comes back in M12.
- Times shown in the old screens may still be off by the time-zone difference (spec bug 4b.4, for M8).

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
