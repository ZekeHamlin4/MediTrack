# MediTrack Design Spec

Status: revision 2. The owner's answers to the first round of open decisions are applied (phone-first, PIN or password, per-patient AI consent, nurse login without doctor login, several patients per user, agency-ready data model). The remaining questions are listed in "Open decisions" at the end of this file.
Scope: evolve the existing app. Do not rewrite it. Reuse existing components, endpoints and tables wherever possible.

---

## 1. Current state

**Stack**
- Server: Node 22+, Express 4, `better-sqlite3` (file `server/meditrack.db`), `nodemailer` (SMTP), `imapflow` (IMAP), `@anthropic-ai/sdk` (assistant).
- Client: one page, `client/index.html` + `client/care.jsx`. React 18 **development** build, Babel standalone (JSX compiled in the browser) and Quagga (barcode) all loaded from public CDNs, unpinned, no integrity hashes.
- Runs on one home computer via `Start MediTrack.bat` / `.command`. Phones reach it over plain `http://<LAN-IP>:3000` on home Wi-Fi.
- One child per install (`patient_profile` is a single row, id = 1).

**Screens today (9 tabs in a scrolling top bar, visible after setup)**
| Tab | What it does |
|---|---|
| Setup wizard (first run only) | 3 steps: family info (child, DOB, parent contact, address, insurance/Medicaid IDs, diagnoses, equipment) → add care team (manual form or NPI registry search) → done. "Skip setup" marks onboarding done. |
| Care Team (default) | Provider cards: phone/fax/email/account #, department directory, tips, notes, favorite, tap-to-call, copy, "Show what to say" (built-in scripts per provider type), "Ask assistant", edit, delete. Search + type filter. NPI registry search. |
| Assistant | Claude chat with tools: search/save providers, NPI lookup, create/update tasks, draft emails, read inbox, read supply levels, call tips, web search (on by default). Side panel: Outbox (edit, Send via SMTP or "Open in my email app", copy, discard) and Inbox. Never sends email itself. Conversation lost when leaving the tab. |
| Tasks | Checklists with status, provider, due date, steps. Add, change status, tick steps, delete. |
| Dashboard | Counts, low-stock table, category chips, last 10 scans. |
| Supplies | Inventory table, search, filters, inline quantity edit, add/edit modal, delete. |
| Scan | Camera barcode scan (Quagga) or manual code → log add / remove / check, with a free "Logged by" dropdown (any user or Anonymous). |
| Portal | Read-only supply table. `?view=portal` only selects this tab; all other tabs remain reachable. |
| Activity | Last 200 scan log entries. |
| Users | List, add (name, email, role), remove. |

**Data today**: `users`, `supplies`, `scan_log`, `patient_profile`, `providers`, `tasks`, `outbox`. First start seeds 5 demo users (plain-text PINs) and 35 demo supplies.

**Roles today**: `family`, `nurse`, `doctor`, `admin` are labels only. No login, no permission checks.

---

## 2. Target users and devices

**Phone-first.** Daily work (logging use, scanning, restocking, ticking tasks, calling providers, approving drafts) happens on phones. The computer is mainly for checking the overview ("portal"), printing reports, and admin. Every screen must work one-handed on a phone; the desktop layout is a wider version of the same screens plus the Overview.

| User | Login in MVP | Needs |
|---|---|---|
| **Family caregiver** (parent/guardian; may care for more than one child) | yes | Know what's low before it runs out; every provider number and account #; drafts and scripts fast; track multi-step requests; decide who sees what and what the AI may see. |
| **Patient representative** | yes (a flag on a family member) | Same as family, plus: grant/revoke AI data consent for the patient, link nurses and other family to the patient, see who accessed the patient's record. |
| **Home nurse** (may serve several patients) | yes | Clinical access to the patient (see section 4, M3): diagnoses, equipment, care notes, supplies and history, log use in 2 taps, tasks, provider numbers. Not: insurance IDs, account numbers, the parent's email, the AI assistant. |
| **Doctor / clinic** | **no** (role reserved for later) | Receives a printable usage report from the family or nurse. |
| **Install admin** | yes (a flag on a user) | Create/deactivate accounts, reset sign-in, settings, backup/restore, audit log. Does not see patient data unless also a member of that patient. |

---

## 3. Gaps and problems

### 3a. Security (blocking for real use)
1. **No login.** Anyone on the Wi-Fi sees and changes everything, including diagnoses, insurance/Medicaid IDs and the parent's inbox, and can send email as the parent.
2. **Roles not enforced.** "Read-only" Portal is just a tab; every API endpoint accepts any request.
3. **Open CORS** (`app.use(cors())`). Any web page opened on the home network can read `/api/profile`, `/api/email/inbox` and trigger `/api/outbox/:id/send`.
4. **PINs stored in plain text** in `pin_hash`; seeded users have known PINs (`0000`, `1234`...). Never checked. Add User form has no PIN field.
5. **Anyone can log as anyone** via Scan's "Logged by" dropdown.
6. **Plain HTTP.** Health data crosses Wi-Fi unencrypted, and browsers block the camera on non-HTTPS pages, so **live scanning does not work on phones**, the primary device. Push notifications also require HTTPS.
7. **CDN scripts**, unpinned, no SRI. A compromised CDN would get full data access; app fails offline.
8. **AI data sharing is implicit.** Every assistant request sends the full family profile (diagnoses, insurance IDs, DOB, address); `read_inbox` sends email contents; web search on by default. No consent recorded.
9. Server accepts the whole chat history from the client, including assistant/tool turns, unchecked.
10. `.env` holds the email app password in plain text (acceptable for a home install; must be documented).

### 3b. Broken or buggy
1. **Deleting a supply or user with scan history fails** (FK on `scan_log`, no ON DELETE rule) with a 500, but the UI shows "deleted": the `api` helper in `index.html` never checks `r.ok`, so all save failures look like success.
2. **Inline quantity edits bypass the log** (no `scan_log` row, no who/when).
3. **Timestamps** are UTC without a zone marker (`CURRENT_TIMESTAMP`) and parsed by the client as local time; "time ago" is off by the UTC offset.
4. **Family profile can't be edited after setup.**
5. Tasks: no description field on add; title, steps, due date not editable later.
6. Supply categories hard-coded in the client (`CATS`).
7. Call scripts say "my son" / "his".
8. Demo supplies and users seeded into every real install.

### 3c. Confusing
1. 9 tabs on a scrolling bar; on a phone half are off-screen. Dashboard, Portal, Activity overlap with Supplies.
2. Static header text "Pediatric Care / Trach / Vent / G-Tube".
3. Single-letter "icons" (unused); small buttons (`btn-sm` ~28px) for a phone.
4. Assistant saves/updates providers without a confirm step.
5. No backup; data lives in one file in the unzipped folder.

---

## 4. MVP feature list

All required before a real family uses MediTrack. Build in this order. Agency/clinic features are **not** in MVP, but the data model must not block them (section 7, section 8 "Path to agency/HIPAA").

**M1. Data foundation and migrations**
- Schema versioning via `PRAGMA user_version`; numbered migrations in `db.js` (section 7).
- New tables: `organizations`, `patients` (replaces `patient_profile`), `patient_members`, `ai_consents`, `sessions`, `audit_log`, `app_settings`, `push_subscriptions`.
- Add `patient_id` to supplies, scan_log, providers, tasks, outbox and backfill existing data to the migrated patient.
- Fresh installs: no seeded users or supplies.

**M2. Accounts and sign-in**
- Sign in with **username + secret**. Each user chooses their secret type: **6-digit PIN** or **password** (min 10 characters). Users can switch type in My profile.
- Both hashed with Node `crypto.scrypt` + per-user salt; never returned by any API.
- Same lockout for both: 5 failures → locked 15 minutes; admin can unlock/reset. Reset forces the user to set a new secret at next sign-in.
- Session: random 32-byte token in an `HttpOnly`, `SameSite=Strict`, `Secure` (when HTTPS) cookie, stored in `sessions`. Idle timeout: 30 min nurse, 12 h family (Open decision 3). "Remember username on this device" option.
- Users are deactivated, never deleted.
- Bootstrap: if no user has a secret (fresh install or migrated install), the app shows "Create admin account" before anything else.

**M3. Per-patient permissions (enforced on the server)**
Access is per user, per patient, via `patient_members` (role `family` or `nurse`; `family` may carry `is_representative`). Install admin is a separate user flag and grants no patient access by itself. `doctor` is a reserved role value: accepted by the schema, not offered in the UI, no permissions in MVP.

**Interpretation of "nurse has similar access":** the owner said doctors won't log in for now but the nurse should have "similar access". This spec reads that as **clinical access**: what a treating clinician would need to see and do at the bedside. It does **not** mean full family access to administrative and financial data (insurance IDs, account numbers, email, AI). This is flagged as Open decision 1. If the owner meant "similar to family", the nurse column below changes to match the family column except representative rights.

| Capability (for a patient the user is a member of) | Family + representative | Family | Nurse |
|---|---|---|---|
| Patient name, DOB, photo/initials | yes | yes | yes |
| Clinical info: diagnoses, equipment, care notes | view + edit | view + edit | view |
| Contact/admin info: address, parent contact, insurance + Medicaid IDs | view + edit | view + edit | no |
| Supplies, levels, history | yes | yes | yes |
| Log use / restock / count (scan or manual) | yes | yes | yes |
| Add, edit, archive supply items and thresholds | yes | yes | no |
| Printable usage report | yes | yes | yes |
| Care team: names, phone/fax/departments, call scripts | yes | yes | yes |
| Care team: account #s, provider notes; add/edit/delete; NPI search | yes | yes | no |
| Tasks: view, tick steps | yes | yes | yes |
| Tasks: create / edit / delete | yes | yes | no |
| Assistant, Outbox, Inbox, send email | yes | yes | no |
| Grant / revoke AI consent for this patient | yes | no | no |
| Add / remove members of this patient | yes | no | no |
| View this patient's audit log | yes | no | no |

Install admin (user flag): manage user accounts, create patients, app settings, backup/restore, view full audit log.

- Patient-scoped endpoints move under `/api/patients/:patientId/...` (supplies, scan, scan-log, dashboard, providers, tasks, outbox, profile, assistant chat, report). Middleware checks membership + role on every call; nurse responses have restricted fields **removed on the server**.
- Unscoped endpoints: `/api/auth/*`, `/api/me` (user + list of patients with role), `/api/patients?search=` (only patients the user is a member of), `/api/admin/*` (admin only), `/api/call-tips`, `/api/lookup` (family only).
- Remove `cors()`. Reject state-changing requests whose `Origin` header is present and not the app's own origin.
- 401 when not signed in, 403 when not allowed, 404 for patients the user isn't a member of (don't reveal they exist).

**M4. Patient switcher and search**
- The current patient is part of the client URL (e.g. `#/p/12/supplies`), so every tab shows one explicit patient and two tabs can't silently mix patients.
- Patient name chip always visible in the header (and on the Scan sheet) to prevent logging to the wrong patient. Tap → switcher.
- My profile → "My patients": list of linked patients with role; tap to switch.
- Switcher and My patients show a search box when the user has more than 5 patients (name, DOB). Search covers only the user's own patients.
- After sign-in: 1 patient → straight to Home; several → last-used patient, or the patient picker if none.

**M5. Trustworthy supply log**
- Every quantity change (scan, manual, inline, edit modal) writes a `scan_log` row with the signed-in user, patient, action (`add`, `remove`, `check`, new `adjust`), before/after quantities, optional reason.
- Remove the "Logged by" dropdown. Archive supplies instead of deleting.

**M6. Bug fixes from 3b**: API helper shows server errors; ISO-8601 UTC timestamps displayed in local time; editable patient profile; full task edit; categories from the server; call scripts use the child's name (`[child's name]`) and no pronouns (Open decision 10).

**M7. First run and adding patients**
- Bootstrap: create admin account → "Add a patient" wizard → creator is linked as `family` + representative.
- Add-patient wizard (reuses existing `SetupWizard`): (1) patient info → (2) care team → (3) supplies: "Start from a common trach / vent / G-tube list" (existing 35 items, quantities 0) or "Start empty" → (4) AI sharing: explained, off by default, representative may turn on → done.
- Admin can add more patients later from Settings → Patients.

**M8. HTTPS and phone scanning**
- Phones are the primary device, so live camera scanning must work on phones. That requires HTTPS.
- Server: if `HTTPS_CERT` and `HTTPS_KEY` are set in `.env`, serve HTTPS; also support running behind a local HTTPS proxy (`TRUST_PROXY=1`, bind to localhost only). Cookies get `Secure` under HTTPS.
- **Recommended method: private network with real certificates** (for example Tailscale with its HTTPS certificates). Trade-offs:

| Option | Works on phones without warnings | Away from home | Exposed to internet | Effort for family | Notes |
|---|---|---|---|---|---|
| **A. Private network + real certs (recommended)** | yes | yes (owner can check the portal from anywhere) | no | install an app on each device once | A third-party coordination service sees device metadata, not app data. Nurse phones must join the family's private network. |
| B. Local certificate authority (e.g. mkcert) | only after installing and trusting a root cert on every phone (fiddly on iPhone) | no | no | high, per device | Breaks if the computer's address changes unless a hostname is used. |
| C. Public tunnel or hosting | yes | yes | **yes** | low per device | Login must then be internet-grade (rate limits, 2-step sign-in); the tunnel/host provider handles traffic. This is the eventual agency path, not MVP. |

- Final method: Open decision 2. README gets a step-by-step guide for the chosen method.
- Keep the fallbacks: "Take photo of barcode" (`<input type="file" accept="image/*" capture="environment">` decoded with Quagga's single-image decode) and manual code entry, used automatically when the page isn't a secure context.

**M9. AI consent per patient**
- Assistant use is available to family members only. Each user sees a one-time notice that **what they type** is sent to the AI provider.
- **Patient data goes to the AI only with recorded consent** from the patient or the patient's representative, **off by default**, revocable any time. Consent is stored per patient in `ai_consents` with who granted it, in what capacity (patient / representative), when, and when/by whom it was revoked. History is kept.
- Two consent scopes, each separately on/off:
  - `clinical`: diagnoses, equipment, care notes, supply list and levels.
  - `identity_admin`: child name, DOB, address, parent contact, insurance/Medicaid IDs, care team details and account numbers.
- Without a scope, the server leaves that data out of the system prompt, and the matching tools (`get_supply_status` for clinical; `search_care_team` / `save_provider` for identity_admin) return "Not shared with the assistant for this patient". Drafts then use `[placeholders]`. What is in each scope is Open decision 4.
- Revoking takes effect on the next assistant request; existing chats in memory are cleared for that patient.
- Patient profile screen shows "AI sharing" status to all family members; only representatives can change it. Every grant/revoke goes to the audit log.
- `read_inbox` reads the install's configured mailbox (the parent's). Family only. Install setting allows turning it off.
- Install settings (admin): assistant on/off, web search on/off.
- `save_provider` on an existing provider needs a confirm card in the UI (old vs new) before saving.
- Conversation history kept server-side per session and patient (in memory); the client sends only new user text.

**M10. Local front-end libraries**: serve React (production), ReactDOM, Babel standalone, Quagga from `client/vendor/`, pinned. No CDN requests.

**M11. Phone-first navigation + desktop Overview** (section 6). Installable to the home screen (web app manifest + icon).

**M12. Printable usage report** (the way to share with doctors for now)
- Per patient, choose date range (default last 3 months) → per item: start qty, used, restocked, end qty, average use per week/month, current low-stock status. Patient name, DOB, generated by/when.
- Printer-friendly page and "Save as PDF" through the browser print dialog. Clinical scope only: no insurance IDs unless the user ticks "include insurance info" (family only).
- Generating a report writes an audit entry.

**M13. Backup and restore** (admin): "Download backup" (SQLite online backup API, file `meditrack-backup-YYYY-MM-DD.db`, warning that it contains health information); "Restore" with confirm; README section on upgrading without losing data.

**M14. Audit log** (written from M2 onward; viewer here). Logged: sign-in ok/fail, lockout, account created/deactivated/secret reset, patient created, member added/removed, profile viewed (once per session per patient) and edited, AI consent granted/revoked, provider changes (marked if via assistant), email sent, report generated, backup downloaded/restored. Admin views all; representative views their patient's entries.

**M15. Phone notifications (push)**
- Interpretation: the owner's "phone use pushes" is read as a push toward phone use (applied throughout) **and** possibly push notifications (Open decision 5). Because phones are the main device and running out of trach/vent supplies is serious, low-stock notifications are moved from Later into MVP, as the last item.
- Depends on M8 (Web Push needs HTTPS; on iPhone the app must be added to the Home Screen). If HTTPS isn't adopted, M15 moves back to Later.
- Events: a supply crosses below its low-stock threshold (once per crossing), a task is due today or overdue (family), a draft is waiting for approval (family). Per user, per patient on/off in My profile.
- Notification text is generic and contains no health details: "MediTrack: a supply is running low. Open the app to see." Push services (Apple/Google) carry the message.
- Notifications only go out while the home computer and MediTrack are running. Say so in the UI.

---

## 5. Later features (not MVP)

- **Doctor login**: enable the reserved `doctor` membership role with read-only clinical access (same as the nurse view minus logging). The role model and API already support adding it.
- **Agency/clinic version**: several households per install or hosted, organization admins, staff onboarding, nurse access across families, 2-step sign-in, hosted deployment. Section 8 lists what HIPAA readiness would need.
- Resupply schedule per item (allowed quantity per month, next eligible order date) (Open decision 8).
- Expiration dates / lot numbers; go-bag / emergency checklist; storage location.
- Link supplies to the DME provider; one-tap "draft resupply email" for low items.
- Task assignment to a person; nurse shift-handoff notes.
- Fax sending via an online fax API.
- Persisted assistant conversations (opt-in).
- Pre-compiled client bundle; offline read-only cache.
- Encryption at rest (SQLCipher) and encrypted backups.

---

## 6. Screens

### Navigation
- **Phone (primary, < 640px):** fixed bottom bar, max 5 items, icon + label, ≥ 48px tall. A floating round **Scan** button on Home and Supplies (one tap to scan).
- **Computer (≥ 1024px):** existing top tab bar, wider layouts, plus **Overview**.
- Header: patient chip (name + initials avatar; tap → switcher), account menu: **My profile**, **Patient profile**, **Members** (representative), **Usage report**, **Users / Patients / Settings / Audit** (admin), **Sign out**.
- Bottom bar by role for the current patient:
  - Family: **Home · Supplies · Tasks · Care Team · Assistant**
  - Nurse: **Home · Supplies · Tasks · Care Team · Patient** (clinical profile, read-only)
  - Admin with no patient membership: **Users · Patients · Settings · Audit**
- Removed as tabs: Dashboard (→ Home), Scan (→ floating button/sheet), Portal (→ role permissions + computer Overview; `?view=portal` redirects to Overview), Activity (→ Supplies › History).

### Screen list
1. **Sign in.** Username, PIN-or-password field (numeric keypad when the user's type is PIN, after username is entered), "Remember username on this device", errors for wrong secret and lockout. → patient picker or Home.
2. **Bootstrap / create admin** (no users with secrets yet). Name, username, choose PIN or password.
3. **Patient picker.** Shown when the user has several patients and no last-used one. Cards: name, initials, DOB, low-stock count. Search box when > 5.
4. **Add-patient wizard.** Steps in M7. Reuses `SetupWizard`, `ProviderLookup`, `ProviderModal`.
5. **Home (phone).** "Running low" cards with Restock (and "Ask assistant to reorder" for family); "Waiting on you" (drafts, family); "Due tasks" (next 3); "Recent activity" (last 10). Floating Scan.
6. **Overview (computer portal).** For the current patient: the same blocks as Home side-by-side with full tables (existing Dashboard tables). For users with several patients: "All my patients" table: patient, low items, overdue tasks, drafts waiting; click a row → that patient.
7. **Supplies.** Search, category filter, low-only toggle; card list on phone, table on computer. Tap → Supply detail. Family: "+ Add supply". No inline quantity input.
8. **Scan sheet** (full screen on phone). Patient name at the top. Live camera / photo / manual code. Found → item with big **Used / Restocked / Counted** buttons, −/+ stepper, note, Save. Not found → "Add new supply with this barcode" (family) or "Not found" (nurse).
9. **Supply detail.** Fields, current qty, Used / Restocked / Set exact count (reason), item history. Family: Edit, Archive.
10. **Supplies › History.** Full log, filter by item and person.
11. **Usage report.** Date range, include-insurance toggle (family), Print / Save as PDF.
12. **Care Team.** Existing screen; nurse view hides account #, notes, edit/delete, lookup, Ask assistant.
13. **Tasks.** Existing list + full edit form (family); nurse can tick steps only.
14. **Assistant.** Existing chat + Outbox/Inbox. Add: first-use notice, banner showing which consent scopes are on for this patient ("Not shared: clinical info"), provider-update confirm card, conversation survives tab switches.
15. **Patient profile.** Sections: Identity, Contact & insurance (family only), Clinical, **AI sharing** (status for family; on/off per scope + consent history for representative).
16. **Members** (representative). People linked to this patient: name, role, representative flag, added by/when. Add existing user by username, choose role; remove. (Whether representatives can also create new accounts: Open decision 6.)
17. **My profile.** Name, username, change PIN/password (switch type), My patients (switcher + search), notification settings (M15).
18. **Admin: Users.** Create, deactivate/reactivate, reset secret, unlock, admin flag. Can't remove the last admin.
19. **Admin: Patients.** List, add patient (wizard), archive patient.
20. **Admin: Settings.** Assistant on/off, web search on/off, inbox reading on/off, email status (SMTP/IMAP configured yes/no; values stay in `.env`), HTTPS status, Backup, Restore.
21. **Audit log.** When, who, patient, action, summary; filter by patient/user. Admin sees all; representative sees their patient.

---

## 7. Data

Migrations run in order using `PRAGMA user_version`. Existing installs keep their data. Changing `supplies.barcode` uniqueness requires a SQLite table rebuild (create new table, copy, drop, rename) inside a transaction.

### New tables
```
organizations(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,                       -- e.g. "Smith household"
  type TEXT NOT NULL DEFAULT 'household' CHECK(type IN ('household','agency','clinic')),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
)  -- MVP: exactly one row, type 'household'. No UI beyond the name.

patients(                                   -- replaces patient_profile; same fields
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL REFERENCES organizations(id),
  name TEXT NOT NULL, dob TEXT,
  parent_name TEXT, parent_phone TEXT, parent_email TEXT,
  address TEXT, city TEXT, state TEXT, zip TEXT,
  insurance_name TEXT, insurance_member_id TEXT, medicaid_id TEXT,   -- identity_admin scope
  diagnoses TEXT, equipment TEXT, notes TEXT,                        -- clinical scope
  onboarded INTEGER NOT NULL DEFAULT 0,
  archived INTEGER NOT NULL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
)

patient_members(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id INTEGER NOT NULL REFERENCES patients(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  role TEXT NOT NULL CHECK(role IN ('family','nurse','doctor')),   -- 'doctor' reserved, unused in MVP
  is_representative INTEGER NOT NULL DEFAULT 0,                     -- only valid with role 'family'
  notify_low_stock INTEGER NOT NULL DEFAULT 1,
  notify_tasks INTEGER NOT NULL DEFAULT 1,
  added_by INTEGER REFERENCES users(id),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  removed_at DATETIME
)  -- one active row (removed_at IS NULL) per patient+user: enforce with a partial UNIQUE index

ai_consents(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id INTEGER NOT NULL REFERENCES patients(id),
  scope TEXT NOT NULL CHECK(scope IN ('clinical','identity_admin')),
  granted_by INTEGER NOT NULL REFERENCES users(id),
  granted_as TEXT NOT NULL CHECK(granted_as IN ('patient','representative')),
  granted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  revoked_by INTEGER REFERENCES users(id),
  revoked_at DATETIME
)  -- active consent = row for patient+scope with revoked_at NULL. Rows are never deleted.

sessions(
  id TEXT PRIMARY KEY,                       -- 32 random bytes, hex
  user_id INTEGER NOT NULL REFERENCES users(id),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_seen_at DATETIME, expires_at DATETIME NOT NULL
)

audit_log(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER REFERENCES organizations(id),
  patient_id INTEGER REFERENCES patients(id),
  user_id INTEGER REFERENCES users(id),
  action TEXT NOT NULL,                      -- see M14
  entity TEXT, entity_id INTEGER,
  summary TEXT,                              -- short; no diagnoses or IDs
  via_assistant INTEGER NOT NULL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
)  -- append-only: no update/delete endpoints

app_settings(key TEXT PRIMARY KEY, value TEXT NOT NULL)
  -- assistant_enabled, assistant_web_search, inbox_reading_enabled, vapid_public_key, vapid_private_key

push_subscriptions(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  endpoint TEXT NOT NULL UNIQUE, keys_json TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
)
```

### Changed tables
**users**: add `org_id`, `username TEXT UNIQUE`, `secret_type TEXT CHECK(secret_type IN ('pin','password'))`, `secret_hash TEXT` (`scrypt$<salt>$<hash>`), `must_reset_secret INTEGER DEFAULT 0`, `is_admin INTEGER DEFAULT 0`, `active INTEGER DEFAULT 1`, `failed_attempts INTEGER DEFAULT 0`, `locked_until DATETIME`, `last_login_at DATETIME`. Old `role` and `pin_hash` columns are no longer read; `pin_hash` values are cleared by the migration.
**supplies**: add `patient_id NOT NULL`, `archived`. Barcode unique **per patient**: `UNIQUE(patient_id, barcode)` instead of global `UNIQUE`.
**scan_log**: add `patient_id`, `quantity_before`, `quantity_after`; action CHECK adds `'adjust'`; `user_id` from session (required on new rows).
**providers**: add `patient_id` (care team per patient; sharing across siblings is Open decision 7).
**tasks**: add `patient_id`, `created_by`.
**outbox**: add `patient_id`, `created_by`, `sent_by`.
**patient_profile**: replaced by `patients`; dropped after migration.

### Migration from the current version (v0 → v1)
1. Create `organizations` row "My household".
2. If `patient_profile` has a name or `onboarded = 1`, or any supplies/providers/tasks exist: create `patients` row from it (name defaults to "My child" if empty).
3. Set `patient_id` on all supplies, scan_log, providers, tasks, outbox rows to that patient.
4. Existing users: kept for history, set `active = 0`, `pin_hash` cleared, `is_admin = 1` where `role = 'admin'`.
5. On next start the bootstrap asks for a new admin account; that admin is linked to the migrated patient as `family` + representative.
6. Existing demo supplies are kept (they may hold real counts now).

### Timestamps
API returns ISO-8601 UTC (`2026-11-15T14:03:00Z`); client shows local time.

---

## 8. Privacy and security

1. **Where data lives:** `server/meditrack.db` on the home computer, plus downloaded backups. README + Settings tell users to turn on disk encryption (BitLocker / FileVault) and a computer login password.
2. **Who can reach it:** home network or a private network (M8 option A). Never exposed to the public internet in MVP. Every API call needs a session.
3. **Authentication:** individual accounts; PIN or password, both scrypt-hashed; lockout; idle timeout; `HttpOnly` + `SameSite=Strict` + `Secure` cookies.
4. **Authorization:** per user, per patient (M3), enforced in the server. Restricted fields are stripped server-side. Admin role grants no patient data by itself.
5. **Browser attacks:** no CORS, origin check, no runtime third-party scripts, headers: `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY`, CSP `'self'` (plus `'unsafe-eval'` while in-browser Babel remains).
7. **In transit:** HTTPS per M8. Until it is set up, Settings shows "Connection not encrypted".
8. **AI provider:** patient data only with recorded, revocable, per-patient consent, off by default (M9); family only; never sends email; provider edits need confirmation; email content treated as untrusted (keep the existing system-prompt rule).
9. **Email:** the configured mailbox is the parent's. Family only; inbox reading can be turned off.
10. **Push notifications:** no health details in notification text (M15).
11. **Audit:** M14, append-only.
12. **Secrets:** `.env` stays out of git; document that it holds the email app password; VAPID keys in `app_settings`.
13. **Logs:** server console never prints request bodies, profile data or email contents.
14. **No compliance claims:** do not claim HIPAA compliance anywhere.

### Path to agency/HIPAA (do not build now; don't block it)
If an agency or clinic adopts MediTrack it would likely become a HIPAA covered entity's (or business associate's) system. That would need, at minimum:
- Hosting with a signed Business Associate Agreement (BAA); BAAs with the AI provider, email provider and any tunnel or push provider that handles patient data, or turning those features off.
- A written risk assessment, security policies, staff training and breach-notification procedures.
- Encryption at rest and in transit, encrypted backups, defined retention.
- Unique user IDs, automatic logoff, access control by minimum necessary, and audit controls. **The MVP already provides these through M2, M3 and M14.**
- Organization-level admins and separation between organizations: `organizations.org_id` on users, patients and audit is already there for this.
- 2-step sign-in and internet-grade rate limiting if hosted.
- Patient/representative access and amendment requests; consent records (`ai_consents` pattern) extended to other disclosures.

---

## 9. Visual style

**Keep** the current look: navy/blue header, white cards on light gray, colored category and status badges, teal accent. It is calm, readable and consistent; changing it adds cost without helping families.

**Change, for phone-first use and accessibility:**
1. Bottom navigation on phones; floating Scan button; inline SVG icons + text labels instead of letters.
2. Touch targets ≥ 44px on phones (`.btn-sm` becomes desktop-only sizing). Primary actions at the bottom of the screen, within thumb reach.
3. Inputs at 16px on phones (current 14px makes iOS zoom).
4. Tables become stacked cards under 640px; tables stay on the computer Overview.
5. Text contrast: replace `--gray-500` (#9e9e9e, fails WCAG AA) with `--gray-700` for text.
6. Status = text + color; one palette: red = out / error, orange = low / needs action, green = OK / done, blue = info.
7. Header: patient chip (name + initials avatar, distinct color per patient) and account menu instead of the static "Pediatric Care / Trach / Vent / G-Tube" text. The patient chip must be visible on every patient screen.
8. Web app manifest + icon so "Add to Home Screen" looks like an app.

---

## 10. Open decisions

1. **Nurse access:** this spec reads "similar access" as clinical access: nurses see diagnoses, equipment, care notes, supplies and history; they log use, tick task steps and print usage reports. They do **not** see insurance/Medicaid IDs, account numbers or email, and can't use the AI. Is that right, or should nurses have the same access as family (minus representative rights)?
2. **HTTPS method:** recommended option A (private network with real certificates; an app installed on each phone, including nurses' phones). Accept A, or prefer B (local certificate) or C (public tunnel/hosting, which brings internet exposure)?
3. **Idle timeouts:** 30 min for nurses and 12 h for family OK, given that phones are the main device?
4. **AI consent scopes:** is the split into `clinical` (diagnoses, equipment, notes, supply levels) and `identity_admin` (name, DOB, address, insurance IDs, care team) right? Should supply levels count as clinical (spec: yes)? Without any consent, should family still be able to use the assistant with placeholders (spec: yes)?
5. **"Pushes":** did you mean push notifications? If yes: are low stock, tasks due and drafts waiting the right events, and is generic text with no patient name OK?
6. **Accounts:** who creates accounts for a new nurse or family member: only the install admin, or can a patient representative create one too? Is the admin always a parent in practice?
7. **Care team per patient:** siblings often share the same pharmacy, DME or pediatrician. Keep providers per patient (spec) or share household-wide?
8. **Resupply schedule** (allowed quantity per month, next order date): needed for the first family (move to MVP) or later?
9. **Starter supply list:** OK to offer the existing 35 items with quantities at 0?
10. **Call-script wording:** spec uses the child's name and no pronouns. Keep, or let the family set pronouns in the profile?
11. **Nurses across families:** in MVP one install = one household, so a nurse working for two families has two separate logins. Acceptable until an agency version?
12. **Several representatives:** spec allows more than one representative per patient (e.g. both parents), and any one of them can grant or revoke consent. OK? Should an older patient be able to log in and consent for themselves later?
