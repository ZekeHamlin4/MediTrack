# MediTrack Design Spec

Status: draft for builder. Owner sign-off needed on "Open decisions" (end of file).
Scope: evolve the existing app. Do not rewrite it. Reuse existing components, endpoints and tables wherever possible.

---

## 1. Current state

**Stack**
- Server: Node 22+, Express 4, `better-sqlite3` (file `server/meditrack.db`), `nodemailer` (SMTP), `imapflow` (IMAP), `@anthropic-ai/sdk` (assistant).
- Client: one page, `client/index.html` + `client/care.jsx`. React 18 **development** build, Babel standalone (JSX compiled in the browser) and Quagga (barcode) all loaded from public CDNs (unpkg, cdnjs), unpinned, no integrity hashes.
- Runs on one home computer via `Start MediTrack.bat` / `.command`. Phones reach it over plain `http://<LAN-IP>:3000` on home Wi-Fi.
- One family / one child per install (`patient_profile` is a single row, id = 1).

**Screens today (9 tabs in a scrolling top bar, visible after setup)**
| Tab | What it does |
|---|---|
| Setup wizard (first run only) | 3 steps: family info (child, DOB, parent contact, address, insurance/Medicaid IDs, diagnoses, equipment) → add care team (manual form or NPI registry search) → done. "Skip setup" marks onboarding done. |
| Care Team (default) | Provider cards: phone/fax/email/account #, department directory (e.g. "Resupply, press 2"), tips, notes, favorite star, tap-to-call, copy buttons, "Show what to say" (built-in scripts per provider type), "Ask assistant", edit, delete. Search + type filter. "Find providers near me" (NPI registry). |
| Assistant | Claude chat with tools: search/save providers, NPI lookup, create/update tasks, draft emails, read inbox, read supply levels, call tips, web search (on by default). Side panel: Outbox (drafts: edit, Send via SMTP or "Open in my email app", copy, discard) and Inbox (last 15 emails, "Ask assistant about this"). Assistant never sends email itself. Conversation is lost when you leave the tab. |
| Tasks | Checklists with status (open / in progress / waiting / done), provider, due date, steps. Add, change status, tick steps, delete. |
| Dashboard | Counts (supply types, total items, low stock), low-stock table, category chips, last 10 scans. |
| Supplies | Inventory table, search, category filter, low-stock filter, inline quantity edit, add/edit modal, delete. |
| Scan | Camera barcode scan (Quagga) or manual code entry → log add / remove / check with quantity, notes, and a "Logged by" dropdown (any user or Anonymous). |
| Portal | Read-only supply table "for caregivers and family". `?view=portal` only selects this tab; every other tab is still one tap away. |
| Activity | Last 200 scan log entries. |
| Users | List users, add (name, email, role), remove. |

**Data today**: `users`, `supplies`, `scan_log`, `patient_profile`, `providers`, `tasks`, `outbox`. On first start the server seeds 5 demo users and 35 demo supplies.

**Roles today**: `family`, `nurse`, `doctor`, `admin` exist only as a label on the user record. There is no login and no permission check anywhere.

---

## 2. Target users

| User | Context | Needs from the app |
|---|---|---|
| **Family caregiver** (parent/guardian) | Runs the household, orders supplies, fights with insurance. Mostly on phone, often tired or interrupted. | Know what is running low before it runs out; one place for every provider number and account #; draft emails/scripts fast; track multi-step requests (prior auth, new equipment); control who sees what. |
| **Home nurse** (day/night shift, agency) | Uses supplies at the bedside, often on the family's tablet or own phone. | Log what was used in 2 taps; see low stock and tell the family; find the DME/doctor number in an emergency. Should **not** see the parent's email, insurance IDs, or edit the care team. |
| **Doctor / clinic staff** | Occasional, remote or in-clinic. | Read-only view of supply levels and usage history (e.g. to justify a prescription quantity). No editing. (Whether doctors log in at all is an open decision.) |
| **Admin** | In a home install this is usually a parent or a tech-savvy relative. | Create and deactivate accounts, reset PINs, set up email/AI, back up and restore data. |

---

## 3. Gaps and problems

### 3a. Security (blocking for real use)
1. **No login.** Anyone on the Wi-Fi who opens the address sees and changes everything: child's diagnoses, insurance and Medicaid IDs, the parent's inbox, and can send email as the parent.
2. **Roles are not enforced.** The "read-only" Portal is just a tab; all API endpoints accept any request.
3. **Open CORS** (`app.use(cors())`). Any web page visited on a computer or phone on the same network can read `/api/profile`, `/api/email/inbox`, etc. from `localhost:3000` / the LAN address and send mail via `/api/outbox/:id/send`.
4. **PINs stored in plain text** in a column called `pin_hash`; seed users have known PINs (`0000`, `1234`, ...). PINs are never checked. Add User form has no PIN field.
5. **Anyone can log as anyone**: Scan's "Logged by" is a free dropdown with "Anonymous".
6. **Plain HTTP on the LAN.** Health data crosses Wi-Fi unencrypted. Also, browsers block the camera on non-HTTPS pages, so **camera scanning does not work on phones** in the recommended setup (only on the host computer via `localhost`).
7. **Third-party scripts from CDNs**, unpinned (`react@18`, latest Babel), no SRI. A compromised CDN would run code with full access to the data. App also fails without internet.
8. **AI data sharing is implicit.** Every assistant request sends the full family profile (diagnoses, insurance/Medicaid IDs, DOB, address) to the Claude API; `read_inbox` sends the parent's email contents; web search is on by default. Only the README mentions this.
9. Server accepts the whole chat history from the client, including assistant/tool messages, without checks.
10. `.env` holds the email app password in plain text (acceptable for a home install, but must be documented).

### 3b. Broken or buggy
1. **Deleting a supply or user that has scan history fails** (foreign key on `scan_log`, no ON DELETE rule) with a 500. The Supplies and Users screens ignore errors and show "deleted" anyway. The `api` helper in `index.html` never checks `r.ok`, so save failures also look like success.
2. **Inline quantity edits bypass the log.** Changing a number in the Supplies table writes `quantity` directly; no `scan_log` row, no who/when.
3. **Timestamps are UTC without a zone marker** (`CURRENT_TIMESTAMP`), but the client parses them as local time, so "5m ago" style times are off by the UTC offset.
4. **No way to edit the family profile after setup**, even though the wizard says "edit your info any time". "Skip setup" leaves it empty forever.
5. Tasks: the add form has no description field; the title, steps and due date can't be edited after creation.
6. Supply categories are hard-coded in the client (`CATS`); categories added any other way don't appear in filters.
7. Built-in call scripts say "my son" / "his". They should use the child's name or neutral wording.
8. The 35 demo supplies and 5 demo users are seeded into every real install.

### 3c. Confusing
1. 9 tabs on a scrolling bar; on a phone half are off-screen. Dashboard, Portal and Activity overlap with Supplies.
2. Header subtitle "Pediatric Care / Trach / Vent / G-Tube" is static decoration.
3. Tab "icons" are single letters (unused) and many buttons are small (`btn-sm` ~28px tall) for a phone.
4. The assistant can save/update providers and tasks without a confirm step. It only tells you afterwards with a badge.
5. No backup. Data lives in one file inside the unzipped folder; downloading a new version into a new folder "loses" it.

---

## 4. MVP feature list

All items are required before a real family uses MediTrack. Build in this order.

**M1. Accounts and login**
- First-run wizard step 1 creates the first account (role `admin`, name + PIN). No seeded users.
- Login screen: pick your name from a list of active users, enter PIN. PIN = 6 digits minimum (see Open decision 2).
- PINs hashed with Node `crypto.scrypt` + per-user salt. Never returned by any API.
- 5 wrong PINs → account locked 15 minutes. Admin can unlock / reset PIN.
- Session: random 32-byte token in an `HttpOnly`, `SameSite=Strict` cookie, stored in `sessions` table. Idle timeout: 30 min for nurse/doctor, 12 h for family/admin (see Open decision 3). "Sign out" in the menu.
- Users are **deactivated**, not deleted (keeps history intact).

**M2. Server-side permissions** (enforced on every `/api` route, not just hidden in the UI)

| Capability | Admin | Family | Nurse | Doctor |
|---|---|---|---|---|
| View supplies, low stock, supply history | yes | yes | yes | yes |
| Log use / restock / count (scan or manual) | yes | yes | yes | no |
| Add, edit, archive supply items and thresholds | yes | yes | no | no |
| View care team names + phone/fax/departments | yes | yes | yes | yes |
| View account #s, provider notes | yes | yes | no | no |
| Add / edit / delete providers, NPI search | yes | yes | no | no |
| Tasks: view | yes | yes | see Open decision 5 | no |
| Tasks: create / edit / delete | yes | yes | no | no |
| Family profile (insurance IDs, diagnoses) | yes (edit) | yes (edit) | child name + DOB only | child name + DOB only |
| Assistant, Outbox, Inbox, send email | yes | yes | no | no |
| Manage users, settings, backup | yes | no | no | no |

- Unauthenticated requests get 401; forbidden ones 403. Only `/api/auth/*` and static files are public.
- Remove `cors()`. Add a same-origin check (reject state-changing requests whose `Origin` header is present and not the app's own origin).

**M3. Trustworthy supply log**
- Every quantity change (scan, manual adjust, inline edit, edit modal) writes a `scan_log` row with the **logged-in user** and an action: `add`, `remove`, `check`, or new `adjust` (direct set, with optional reason).
- Remove the "Logged by" dropdown.
- Supplies are **archived**, not deleted. Archived items are hidden from lists but kept in history.

**M4. Fix the bugs in 3b**: error handling in the `index.html` API helper (show the server's error message), timestamps (store/return ISO-8601 UTC with `Z`, display local), editable profile screen, task edit (title, description, provider, due date, steps), categories loaded from server, neutral call-script wording (use `[child's name]` placeholders, no he/his).

**M5. Clean first run**
- Wizard: (1) create your account → (2) family info → (3) care team → (4) supplies: "Start from a common trach / vent / G-tube list" (the existing 35 items, quantities set to 0, user fills counts) or "Start empty" → (5) done.
- No demo data in a real install.

**M6. Phone-usable scanning**
- Keep live camera scan where the page is a secure context (localhost or HTTPS).
- Where it isn't (plain HTTP on LAN), show a "Take photo of barcode" button (`<input type="file" accept="image/*" capture="environment">` decoded with Quagga's single-image decode). Manual entry stays.
- If HTTPS on the LAN is chosen (Open decision 1), live scan works everywhere and this becomes a fallback.

**M7. AI and email consent**
- Before first assistant use (family/admin), show a one-time notice: what is sent to the AI provider (messages, family profile, looked-up providers, emails it reads, supply list) and that web search may be used. Buttons: "Turn on assistant" / "Not now". Store the choice.
- Settings (admin): toggle assistant on/off; toggle web search; toggle "include diagnoses in assistant context" (default per Open decision 6).
- Assistant `save_provider` on an **existing** provider requires the user to confirm in the UI before the change is saved (show old vs new values). Creating tasks and drafts stays automatic (they are reviewable and deletable).
- Server rebuilds trust boundaries: it only accepts `user` text messages from the client plus the server's own stored copy of prior assistant turns for that session (store conversation per session in memory; discard on sign-out/restart).

**M8. Local-only front-end libraries**
- Serve React (production build), ReactDOM, Babel standalone and Quagga from `client/vendor/` with pinned versions. No CDN requests. (Pre-compiling JSX is a Later item.)

**M9. Backup and restore** (admin)
- "Download backup" → a copy of the database file (use SQLite online backup API) named `meditrack-backup-YYYY-MM-DD.db`, with a warning that it contains health information.
- "Restore from backup" → upload file, confirm, replace DB, restart required message.
- README section: how to move to a new version without losing data.

**M10. Navigation that fits a phone** (see Screens).

**M11. Audit log** for sensitive actions: login success/fail, user created/deactivated/PIN reset, profile edited, provider created/edited/deleted (including by assistant), email sent, backup downloaded/restored. Admin can view it.

---

## 5. Later features (not MVP)

- Resupply schedule per item: insurance-allowed quantity per month and next eligible order date; "order now" reminder.
- Expiration dates / lot numbers on supplies; go-bag / emergency checklist.
- Link supplies to the DME provider that ships them; one-tap "draft resupply email" for all low items from that provider.
- Usage report for doctors/insurance (monthly use per item, printable PDF) to support prescriptions and letters of medical necessity.
- Notifications (email or push) for low stock, overdue tasks, and assistant drafts waiting.
- Task assignment to a person; nurse shift-handoff notes.
- Supply storage location field ("hall closet, bin 3").
- Fax sending via an online fax API; click-to-call logging.
- Persisted assistant conversations (opt-in).
- Pre-compiled client bundle (no in-browser Babel); installable PWA with offline read-only cache.
- Multiple children per household.
- Encryption at rest (SQLCipher) and encrypted backups.
- Remote access outside the home network (requires real hosting and much stronger security review).

---

## 6. Screens

### Navigation
- **Phone (< 640px):** fixed bottom bar, max 5 items, labels + simple icons, each ≥ 48px tall. **Desktop:** same items in the existing top tab bar.
- Items shown depend on role:
  - Family/Admin: **Home · Supplies · Care Team · Tasks · Assistant**
  - Nurse: **Home · Supplies · Care Team** (+ Tasks if Open decision 5 = yes)
  - Doctor: **Supplies · Care Team**
- Header right side: current user name + menu: **Family profile** (family/admin), **Users** (admin), **Settings** (admin), **Activity / audit** (admin), **Sign out**.
- Removed as tabs: **Dashboard** (becomes Home), **Scan** (button inside Supplies), **Portal** (replaced by role permissions; `?view=portal` redirects to Supplies), **Activity** (becomes "History" inside Supplies).

### Screen list
1. **Login.** App name, list of active users (name + role badge) as large buttons, then 6-digit PIN pad. Error text for wrong PIN and lockout. → Home (or Supplies for doctor).
2. **Setup wizard** (first run only, no login yet). Steps from M5. Reuses existing `SetupWizard`, `ProviderLookup`, `ProviderModal`. → Home.
3. **Home** (replaces Dashboard). Top to bottom: "Running low" list (existing low-stock table, as cards on phone) with "Log restock" and, for family, "Ask assistant to reorder"; "Waiting on you" (outbox drafts count, family only); "Active tasks" (next 3 by due date, family only); "Recent activity" (last 10 supply log entries). Stats counts move to a small row at the bottom.
4. **Supplies.** Search, category filter, low-only toggle (existing). Big **Scan** button at top → Scan sheet. Each item: name, category badge, quantity + unit, status badge; tap → **Supply detail**. Family/Admin: "+ Add supply". Remove inline quantity input from the list (moved to detail so every change is logged with a reason).
5. **Scan sheet** (modal/full-screen on phone). Live camera or "Take photo of barcode" or manual code. Found → item card with **Used** / **Restocked** / **Counted** big buttons, quantity stepper (−/+), optional note, Save. Not found → "Add new supply with this barcode" (family/admin) or "Not found, tell the family" (nurse).
6. **Supply detail.** Name, description, category, unit, barcode, low-stock threshold, current quantity. Actions: Used / Restocked / Set exact count (adjust + reason). History list for this item (who, what, when). Family/Admin: Edit, Archive.
7. **Supplies › History.** Full supply log (existing Activity), filter by item and person.
8. **Care Team.** Existing screen. Nurse/Doctor: no account #, notes, edit/delete, lookup, or "Ask assistant". Provider card actions stay: Call, Copy, Show what to say.
9. **Provider edit modal.** Existing.
10. **Tasks.** Existing list + full edit form (title, description, provider, due, steps add/remove/reorder).
11. **Assistant.** Existing chat + Outbox/Inbox panel. Add: consent notice (M7), confirm card for provider updates, and keep the conversation when switching tabs (lift state to `App` or session).
12. **Family profile.** Same fields as wizard step 1, editable. Save writes an audit entry.
13. **Users** (admin). Existing cards + PIN field on add, "Reset PIN", "Unlock", "Deactivate/Reactivate", role change. Can't deactivate the last admin.
14. **Settings** (admin). Assistant on/off, web search on/off, include diagnoses on/off, email status (SMTP/IMAP configured yes/no, read-only: settings stay in `.env`), Backup download, Restore upload.
15. **Audit log** (admin). Table: when, who, action, summary.

---

## 7. Data

Add a schema version using `PRAGMA user_version` and run numbered migrations in `db.js` (existing `CREATE TABLE IF NOT EXISTS` stays for fresh installs). Existing installs keep their data.

### Changed tables
**users**
- `pin_hash` now stores `scrypt$<salt-hex>$<hash-hex>`. On migration, existing plain-text values are cleared (users must have a PIN set by admin). Seeding removed.
- Add: `active INTEGER NOT NULL DEFAULT 1`, `failed_attempts INTEGER NOT NULL DEFAULT 0`, `locked_until DATETIME`, `last_login_at DATETIME`.
- `GET /api/users` keeps excluding `pin_hash`.

**supplies**
- Add: `archived INTEGER NOT NULL DEFAULT 0`. Lists exclude archived unless `?archived=1`.
- `DELETE /api/supplies/:id` becomes archive (or is removed in favor of `PUT {archived:1}`).

**scan_log**
- `action` CHECK adds `'adjust'`. Add `quantity_before INTEGER`, `quantity_after INTEGER`. `user_id` is set from the session (required for new rows).
- Server writes a log row for every quantity change, including `PUT /api/supplies/:id` when `quantity` changes.

**tasks**: add `created_by INTEGER REFERENCES users(id)`.
**outbox**: add `created_by INTEGER REFERENCES users(id)`, `sent_by INTEGER REFERENCES users(id)`.
**providers**: no field changes.
**patient_profile**: no field changes (now editable via Family profile screen).

### New tables
```
sessions(
  id TEXT PRIMARY KEY,            -- random 32-byte token, hex
  user_id INTEGER NOT NULL REFERENCES users(id),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_seen_at DATETIME,
  expires_at DATETIME NOT NULL
)
audit_log(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id),   -- null for failed login of unknown user
  action TEXT NOT NULL,                   -- e.g. login_ok, login_fail, profile_update, provider_update, email_sent, backup_download
  entity TEXT, entity_id INTEGER,
  summary TEXT,                           -- short, no full health details
  via_assistant INTEGER NOT NULL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
)
app_settings(
  key TEXT PRIMARY KEY, value TEXT NOT NULL
)  -- assistant_enabled, assistant_web_search, assistant_include_diagnoses, assistant_consent_at
```

### Timestamps
All API responses return timestamps as ISO-8601 UTC (`2026-11-15T14:03:00Z`). Either store with `strftime('%Y-%m-%dT%H:%M:%SZ','now')` going forward or convert on read. Client formats in local time.

### Assistant setting precedence
`ASSISTANT_WEB_SEARCH=off` in `.env` still forces web search off; otherwise `app_settings` decides.

---

## 8. Privacy and security

1. **Where data lives:** only in `server/meditrack.db` on the home computer, plus backups the admin downloads. Tell users (README + Settings) to turn on disk encryption (BitLocker / FileVault) and a computer login password.
2. **Who can reach it:** home network only. Never port-forward or expose to the internet (README warning stays, stronger). Server keeps listening on the LAN for phones; login is mandatory for every API call.
3. **Authentication:** per-person accounts, hashed PINs, lockout, idle timeout, `HttpOnly` + `SameSite=Strict` cookies, no shared "family" login for nurses.
4. **Authorization:** role matrix in M2, enforced in the server. Nurse/Doctor responses must not include insurance IDs, Medicaid ID, diagnoses, account numbers, provider notes, outbox or inbox data (strip fields server-side, not just in the UI).
5. **Browser attacks:** no CORS; same-origin check on state-changing requests; no third-party scripts at runtime (M8). Add security headers: `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY`, and a Content-Security-Policy allowing only `'self'` (plus `'unsafe-eval'` for in-browser Babel until it is removed).
6. **In transit:** plain HTTP on home Wi-Fi is a known limit of MVP unless Open decision 1 picks HTTPS. Say so in Settings.
7. **AI provider:** explicit opt-in (M7); only family/admin can use it; diagnoses inclusion is a setting; the assistant never sends email; provider edits need confirmation; email contents are treated as untrusted (keep existing system-prompt rule).
8. **Email:** the inbox is the parent's personal account. Only family/admin can view it or trigger `read_inbox`. Sending requires a human tap (existing behaviour, keep).
9. **Audit:** M11 log; supply log tied to the real logged-in user.
10. **Secrets:** `.env` stays out of git (already in `.gitignore`); document that it contains the email app password.
11. **Logs:** server console must not print request bodies, profile data, or email contents.
12. **Regulatory status:** not decided (Open decision 8). Do not claim HIPAA compliance anywhere in the UI or README.

---

## 9. Visual style

**Keep** the current look: navy/blue header, white cards on light gray, colored category and status badges, teal accent. It is calm, readable, and already consistent across both files; changing it would cost time and add no value for families.

**Change only these, for phone use and accessibility:**
1. Bottom navigation on phones (Screens section). Replace letter "icons" with simple inline SVG icons + text labels.
2. Touch targets ≥ 44px tall for all interactive elements on phones (`.btn-sm` becomes desktop-only sizing).
3. Inputs at 16px font on phones (current 14px makes iOS zoom in on every field).
4. Supplies and low-stock tables render as stacked cards under 640px.
5. Contrast: replace `--gray-500` (#9e9e9e, fails WCAG AA on white) with `--gray-700` for any text; keep #9e9e9e for borders/decor only.
6. Status always shown with text + color (badges already do this; keep it).
7. Remove the static "Pediatric Care / Trach / Vent / G-Tube" header text; show the child's first name and the signed-in user instead.
8. One status palette everywhere: red = out of stock / error, orange = low / needs action, green = OK / done, blue = info.

---

## 10. Open decisions

1. **HTTPS on the home network?** Needed for live camera scanning on phones and to encrypt Wi-Fi traffic, but self-signed certificates show scary browser warnings families must click through. Options: (a) stay on HTTP and use photo-based scanning on phones, (b) self-signed HTTPS with setup instructions, (c) something else. Which?
2. **PIN or password?** Spec assumes a 6-digit PIN for everyone. Should family/admin use a longer password instead? Is 6 digits acceptable, or do you want 4 for speed?
3. **Idle timeouts:** 30 min for nurse/doctor and 12 h for family/admin acceptable? Nurses on a 12-hour shift will need to re-enter the PIN often.
4. **Is "admin" a separate person, or always a parent?** Should a family role be able to manage users (e.g. add a new nurse), or only admin?
5. **Can nurses see tasks?** And should they be able to tick steps or add notes, or is Tasks family-only?
6. **AI and diagnoses:** should the child's diagnoses be sent to the AI by default (better drafts) or off by default (more private)?
7. **Doctors:** will doctors or clinic staff actually log in to a family's home server? If not, drop the doctor role from MVP and replace it with a printable usage report (currently in Later).
8. **Regulatory context:** is MediTrack only ever used by a family for their own child, or will a nursing agency or clinic deploy or recommend it? The latter may bring HIPAA obligations and changes the security bar.
9. **Starter supply list:** OK to offer the existing 35 items as a template with quantities at 0, or should the list be different (e.g. by the child's equipment)?
10. **Resupply schedule** (allowed quantity per month, next order date): is this needed for the first real family (move to MVP) or can it wait?
11. **One child per install:** confirm. Some families care for more than one medically complex child.
12. **Call-script wording:** use the child's name everywhere, or let the family pick pronouns in the profile?
