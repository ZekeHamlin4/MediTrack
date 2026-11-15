# MediTrack Design Spec

Status: revision 3. The owner's answers so far are applied:
- phone-first design
- sign in with a PIN or a password
- AI sees patient data only with per-patient consent
- no doctor login for now
- several patients per user, with an agency-ready data model
- nurses get the same access as family
- push notifications
- people create their own accounts and are linked to a patient by invite

The remaining questions are in "Open decisions" at the end.
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

**Phone-first.** Daily work (logging use, scanning, restocking, ticking tasks, calling providers, approving drafts, reacting to notifications) happens on phones. The computer is mainly for the Overview ("portal"), printing reports, and admin. Every screen must work one-handed on a phone.

| User | Signs in (MVP) | Needs |
|---|---|---|
| **Family caregiver** (title e.g. Mom, Dad, Grandparent) | yes | Know what's low before it runs out; every provider number and account #; drafts and scripts fast; track supply-company issues; get told when something needs them. |
| **Nurse / home health aide** (title e.g. Nurse, Home health aide; may serve several patients) | yes | **Same access as family** for the patients they are linked to: supplies, scanning, care team incl. account numbers and insurance info, tasks, inbox/outbox, AI assistant (within the patient's consent). |
| **Patient representative** (a flag on a member, usually a parent) | yes | Everything above, plus: invite and approve people, choose their role, remove people, grant/revoke AI consent, see the patient's audit log. |
| **Doctor / clinic** | **no** (role reserved for later) | Receives a printable usage report. |
| **Install admin** (the first user; a flag) | yes | Keeps the install running: settings, backup/restore, unlock or reset someone's sign-in, deactivate accounts, full audit log. Sees patient data only where also a member. |

---

## 3. Gaps and problems

### 3a. Security (blocking for real use)
1. **No login.** Anyone on the Wi-Fi sees and changes everything, including diagnoses, insurance/Medicaid IDs and the parent's inbox, and can send email as the parent.
2. **Roles not enforced.** "Read-only" Portal is just a tab; every API endpoint accepts any request.
3. **Open CORS** (`app.use(cors())`). Any web page opened on the home network can read `/api/profile`, `/api/email/inbox` and trigger `/api/outbox/:id/send`.
4. **PINs stored in plain text** in `pin_hash`; seeded users have known PINs (`0000`, `1234`...). Never checked.
5. **Anyone can log as anyone** via Scan's "Logged by" dropdown.
6. **Plain HTTP.** Health data crosses Wi-Fi unencrypted; browsers block the live camera and push notifications on non-secure pages, so **live scanning and notifications don't work on phones**.
7. **CDN scripts**, unpinned, no SRI. A compromised CDN would get full data access; app fails offline.
8. **AI data sharing is implicit.** Every assistant request sends the full family profile; `read_inbox` sends email contents; web search on by default. No consent recorded.
9. Server accepts the whole chat history from the client, including assistant/tool turns, unchecked.
10. `.env` holds the email app password in plain text (acceptable for a home install; must be documented).

### 3b. Broken or buggy
1. **Deleting a supply or user with scan history fails** (FK on `scan_log`, no ON DELETE rule) with a 500, but the UI shows "deleted": the `api` helper in `index.html` never checks `r.ok`, so all save failures look like success.
2. **Inline quantity edits bypass the log** (no `scan_log` row, no who/when).
3. **Timestamps** are UTC without a zone marker and parsed by the client as local time; "time ago" is off by the UTC offset.
4. **Family profile can't be edited after setup.**
5. Tasks: no description field on add; title, steps, due date not editable later.
6. Supply categories hard-coded in the client (`CATS`).
7. Call scripts say "my son" / "his".
8. Demo supplies and users seeded into every real install.

### 3c. Confusing
1. 9 tabs on a scrolling bar; half are off-screen on a phone. Dashboard, Portal, Activity overlap with Supplies.
2. Static header text "Pediatric Care / Trach / Vent / G-Tube".
3. Single-letter "icons"; small buttons (`btn-sm` ~28px) for a phone.
4. Assistant saves/updates providers without a confirm step.
5. No backup; data lives in one file in the unzipped folder.

---

## 4. MVP feature list

All required before a real family uses MediTrack. Build in this order. Agency/clinic features are **not** in MVP, but the data model must not block them (section 7; section 8 "Path to agency/HIPAA").

**M1. Data foundation and migrations**
- Schema versioning via `PRAGMA user_version`; numbered migrations in `db.js` (section 7).
- New tables: `organizations`, `patients` (replaces `patient_profile`), `patient_members`, `invites`, `ai_consents`, `sessions`, `audit_log`, `app_settings`, `push_subscriptions`.
- Add `patient_id` to supplies, scan_log, providers, tasks, outbox; backfill existing data.
- Fresh installs: no seeded users or supplies.

**M2. Self-service accounts and sign-in**
- **Anyone who can reach MediTrack can create an account:** name, **title** (free text with suggestions: Mom, Dad, Grandparent, Nurse, Home health aide, Other), username, secret.
- The title is display text only ("Sam (Night nurse)"). It never grants permissions.
- **A new account with no patient links sees no patient data**, only the "No patients yet" screen (M4).
- Secret: the user chooses a **6-digit PIN** or a **password** (min 10 characters), and can switch later in My profile.
- Both are hashed with Node `crypto.scrypt` + per-user salt and never returned by any API.
- Lockout for both: 5 failures → locked 15 minutes.
- Abuse limits: max 5 new accounts per IP per hour. Admin setting "Allow new accounts" (default on) can close sign-up.
- Forgotten secret: no email reset in MVP. The admin sets a temporary PIN that the user must change at next sign-in.
- Session: random 32-byte token in an `HttpOnly`, `SameSite=Strict` cookie (`Secure` on HTTPS), stored in `sessions`. Default idle sign-out depends on the user's role (Open decision 3): 12 h if any membership is family, 30 min if all memberships are nurse. Users may shorten it in My profile.
- Accounts are deactivated, never deleted.

**M3. Per-patient permissions (enforced on the server)**
- Access is per user, per patient, via `patient_members`.
- `role` is `family` or `nurse`. `doctor` is a reserved value: allowed in the schema, not offered in the UI, no permissions in MVP.
- `is_representative` is a separate flag on the membership. It is set only by an existing representative.
- **Family and nurse have identical permissions.** The only differences are the role label and the default idle sign-out time (M2).

| Capability (for a patient the user is linked to) | Representative | Member (family or nurse) |
|---|---|---|
| View and edit patient profile: identity, contact/insurance, clinical | yes | yes |
| Supplies: view, history, log use/restock/count, add/edit/archive items, thresholds, low-stock alerts | yes | yes |
| Printable usage report | yes | yes |
| Care team: everything incl. account #s, notes, add/edit/delete, NPI search | yes | yes |
| Tasks: view, create, edit, delete | yes | yes |
| Assistant (within the patient's AI consent), Outbox, Inbox, send email | yes | yes |
| Leave this patient (remove own link) | yes (unless last representative) | yes |
| Invite people, approve/decline, set role, remove members | yes | no |
| Grant / revoke AI consent; make someone a representative | yes | no |
| View this patient's audit log | yes | no |

- Install admin (user flag) can: change settings, back up and restore, unlock accounts, reset secrets, deactivate accounts, view the full audit log, and do representative recovery (M4). Being admin gives no patient access by itself.
- Patient-scoped endpoints live under `/api/patients/:patientId/...`. Middleware checks membership (and the representative flag where needed) on every call.
- Unscoped endpoints:
  - `/api/auth/*`
  - `/api/me` (user plus their patients and roles)
  - `/api/patients?search=` (own patients only)
  - `POST /api/patients` (create a patient; the creator becomes its representative)
  - `/api/invites/*`
  - `/api/admin/*`
  - `/api/call-tips`, `/api/lookup`
- Remove `cors()`. Reject state-changing requests whose `Origin` header is present and not the app's own origin.
- Errors: 401 when not signed in, 403 when not allowed, 404 for patients the user isn't linked to (don't reveal that they exist).

**M4. Linking people to patients: invite + representative approval**
**Decision:** linking uses an **invite code created by a representative**, followed by **one approval tap** once the person accepts. Requests started by the newcomer are not used. Why:
- **Strangers never learn which patients exist.** To send a request, a newcomer would have to search for or name a patient, which exposes patient names to anyone who self-signs up. With invites, nothing about a patient is visible until a representative chooses to share a code.
- **The representative is in control from the start** (who, which role), and it works in person (QR code) or by text message.
- **The approval tap closes the remaining gap:** a code forwarded to the wrong person, or a text sent to the wrong number, still can't give access without the representative recognising the name.

Invite rules:
- 8-character code from an unambiguous alphabet (e.g. `K7QM-4ZPX`), also given as a link `<app address>/join/<code>` and a QR code.
- Single use. Expires after 72 hours. Can be cancelled. Stored hashed.
- 5 wrong code entries per account per 15 minutes → wait.

**Phone flow: representative (Mom) invites a nurse**
1. Patient menu → **Members** → **Invite someone**.
2. Choose role: **Family** or **Nurse**, an optional label ("Night nurse"), and "Make representative" (off by default, with a warning that it means they can consent for the patient).
3. Tap **Create invite**. The screen shows a QR code, the code in large letters, the expiry, and **Share** (phone share sheet: text message, email, etc.) and **Copy** buttons.
4. Later: push notification "MediTrack: someone accepted your invite." Tapping it opens **Members → Waiting for your OK**. The card shows name, title, username and the role from the invite, and the role can be changed here. Buttons: **Approve** / **Decline**.

**Phone flow: the nurse**
1. Opens the link or scans the QR code. Alternatively, on the "No patients yet" screen, taps **Enter invite code**.
2. No account yet → **Create account** (name, title, username, PIN or password). Already has one → sign in.
3. Screen: "Mom (Jane) invited you to join [patient first name]'s care team as Nurse." → **Accept**.
4. Screen: "Waiting for Jane to approve." Push "MediTrack: you've been given access." on approval → the patient appears in My patients.

**Unlinking**
- A representative can remove any member of their patient, including another representative, except the **last** representative.
- Any member can remove themselves (**Leave**), except the last representative.
- The admin can deactivate an account, which removes it from every patient at once.
- Removal takes effect immediately: active sessions lose access to that patient on their next request.
- Every invite, accept, approve, decline, role change, removal and leave is audited.
- **Representative recovery:** if a patient has no active representative (e.g. that account was deactivated), the admin can promote an existing family member of that patient to representative. This is audited. The admin cannot add new people to a patient.

**First run (the very first user)**
1. The server prints a one-time **setup code** in the MediTrack window on the computer. The Welcome screen asks for it, so nobody else on the Wi-Fi can claim the install first.
2. Create account (name, title, username, PIN or password). This user becomes **install admin**.
3. **Add your first patient** wizard (M8). The creator becomes that patient's **family member + representative**.
4. Optional wizard step: **Invite your partner or nurse** (the M4 invite screen).

Upgrades from the current version use the same flow, and the first account is linked as representative to the migrated patient (section 7).

**M5. Patient switcher and search**
- The current patient is part of the client URL (e.g. `#/p/12/supplies`), so each tab shows one explicit patient.
- A patient name chip is always visible in the header and on the Scan sheet, so nobody logs to the wrong patient. Tap it to open the switcher.
- My profile → **My patients**: list with role and representative badge; tap to switch.
- Search box (name, DOB) when the user has more than 5 patients. Search covers own patients only.
- After sign-in:
  - no patients → "No patients yet"
  - 1 patient → Home
  - several → the last-used patient, or the picker if there is none

**M6. Trustworthy supply log**
- Every quantity change (scan, manual, edit) writes a `scan_log` row with the signed-in user, patient, action (`add`, `remove`, `check`, new `adjust`), before/after quantities and an optional reason.
- Remove the "Logged by" dropdown.
- Archive supplies instead of deleting them.

**M7. Bug fixes from 3b**
- The API helper shows server errors instead of silently failing.
- Timestamps are ISO-8601 UTC, shown in local time.
- The patient profile is editable.
- Tasks can be fully edited.
- Categories come from the server.
- Call scripts use the child's name (`[child's name]`) and no pronouns (Open decision 8).

**M8. Adding a patient**
- Any signed-in user can add a patient and becomes its representative (Open decision 10).
- Wizard (reuses `SetupWizard`):
  1. Patient info
  2. Care team
  3. Supplies: "Start from a common trach / vent / G-tube list" (existing 35 items, quantities 0) or "Start empty", then "Which items should alert you when low?" (tick items, set thresholds; none ticked by default)
  4. AI sharing: explained, off by default
  5. Invite people (optional)

**M9. Works with any connection method; scanning on phones**
The build must not depend on Open decision 1. The server supports all of these, chosen by settings in `.env`:
- plain HTTP on the home network (current; default)
- HTTPS with certificate files (`HTTPS_CERT`, `HTTPS_KEY`)
- running behind a private-network app or tunnel that provides HTTPS (`TRUST_PROXY=1`, optionally bind to localhost only)

The client checks what the connection allows:
- **Secure connection:** live camera scanning; push notifications offered.
- **Not secure:** **"Take photo of barcode"** (`<input type="file" accept="image/*" capture="environment">` decoded with Quagga single-image decode) plus manual entry. The notifications screen says "Notifications need a secure connection; ask the person who set up MediTrack."

Also:
- Settings shows a plain status line: "Connection: secure" / "Connection: home Wi-Fi only, not encrypted".
- Invite links use the address the representative is currently using.
- README gets a short guide for each option once the owner chooses.

**M10. AI assistant: consent, background work, safety**
Consent:
- Assistant available to every member (family and nurse).
- Each user sees a one-time notice that what they type is sent to the AI provider.
- **Patient data goes to the AI only with recorded consent from the patient or the patient's representative.** It is off by default, revocable, and per patient. It is stored in `ai_consents` with who granted it, in what capacity, when, and when/by whom it was revoked. History is kept.
- Two scopes, each on/off:
  - `clinical`: diagnoses, equipment, care notes, supply list and levels
  - `identity_admin`: name, DOB, address, parent contact, insurance/Medicaid IDs, care team details and account numbers
  - Exact contents: Open decision 4.
- Consent applies equally to nurses and family.
- Without a scope, the server leaves that data out of the system prompt. The matching tools return "Not shared with the assistant for this patient":
  - clinical: `get_supply_status`
  - identity_admin: `search_care_team`, `save_provider`
  - Drafts then use `[placeholders]`.
- Revoking takes effect on the next request and clears in-memory chats for that patient.
- The Patient profile shows the "AI sharing" status to all members; only representatives can change it.

Background work (needed for notifications):
- Chat requests run as **server-side jobs**: `POST` returns a job id and the client polls.
- If the job finishes and the client hasn't polled within 10 s (phone locked, app closed), send an "assistant has an update" push (M16).
- Results are kept in memory until read or for 24 h, never written to disk.

Safety:
- `save_provider` on an existing provider needs a confirm card (old vs new) before saving.
- The client sends only new user text. The server keeps the conversation per session and patient.
- Install settings (admin): assistant on/off, web search on/off, inbox reading on/off.
- `read_inbox` reads the install's configured mailbox. All members of any patient can use it (Open decision 2).

**M11. Local front-end libraries**: serve React (production), ReactDOM, Babel standalone and Quagga from `client/vendor/`, pinned. No CDN requests.

**M12. Phone-first navigation + computer Overview** (section 6). Installable to the home screen (web app manifest + icon + service worker).

**M13. Printable usage report** (how families share with doctors for now)
- Per patient, date range (default last 3 months).
- Per item: start qty, used, restocked, end qty, average use per week/month, low-stock status.
- Header: patient name, DOB, generated by/when.
- Print / Save as PDF via the browser.
- Insurance info only if "include insurance info" is ticked.
- Audited.

**M14. Backup and restore** (admin)
- "Download backup": SQLite online backup API, file `meditrack-backup-YYYY-MM-DD.db`, with a warning that it contains health information.
- "Restore" with a confirm step.
- README section on upgrading without losing data.

**M15. Audit log**
- Written from M2 onward; this item adds the viewer. Append-only.
- Logged events:
  - sign-in ok/fail, lockout, account created/deactivated, secret reset
  - patient created, invites and membership events (M4)
  - profile viewed (once per session per patient) and edited
  - AI consent granted/revoked
  - provider changes (marked if done via the assistant)
  - email sent, report generated, backup downloaded/restored
- The admin sees everything; a representative sees their patient's entries.

**M16. Push notifications**
- Works only on a secure connection (M9). On iPhone the app must also be added to the Home Screen. Code is built regardless; it switches on when the connection allows.
- **Events:**
  1. **Low stock, chosen items only.** Each supply item has an "Alert when low" switch (off by default) and its own threshold (the existing `low_stock_threshold`). One push when an alerting item drops to or below its threshold. No repeat until the item has been restocked above the threshold.
     - Items without the switch still show "Low" badges in the app, but send no push.
     - Alert settings are per item, so everyone linked to the patient sees the same ones (Open decision 5).
     - Each user turns low-stock pushes on/off per patient.
  2. **Assistant updates on supply-company issues:**
     - **answer ready:** a background assistant job finished while the user was away
     - **draft needs approval:** the assistant put a draft in the Outbox
     - **reply received:** a new email arrived from a provider linked to a *tracked issue*. A tracked issue is a task linked to a provider, not done, with "Notify me about updates" on. That switch is on by default when the assistant creates the task.
     - Reply detection: when IMAP is set up and inbox reading is on, the server checks the inbox every 15 minutes and matches the sender against that provider's email and department emails, or its email domain.
     - The server **does not** run the AI on incoming mail by itself. The push only invites the user to open it ("Ask assistant about this").
  3. **Tasks due today or overdue: kept as an optional event, off by default.** It costs almost nothing to build and helps with "waiting on" items. It stays off so the default notifications are only the two the owner asked for.
- **Notification text is generic, with no health details, item names, provider names or patient names:**
  - "MediTrack: a supply is running low."
  - "MediTrack: the assistant has an update."
  - "MediTrack: a reply arrived about one of your issues."
  - "MediTrack: a task is due."
  - "MediTrack: someone accepted your invite." / "MediTrack: you've been given access."
- Tapping a notification opens the right screen for the right patient.
- My profile → Notifications: per patient, switches for low stock, assistant updates, tasks due. Invite notifications are always on for representatives.
- Pushes only go out while the home computer and MediTrack are running. The UI says so.

---

## 5. Later features (not MVP)

- **Doctor login**: enable the reserved `doctor` membership role (read-only). The role model, invites and API already allow it.
- **Agency/clinic version**: several households per install or hosted, organization admins, staff directories, 2-step sign-in, hosted deployment (see section 8).
- Email-based "forgot my PIN/password".
- Resupply schedule per item (allowed quantity per month, next eligible order date) (Open decision 6).
- Expiration dates / lot numbers; go-bag / emergency checklist; storage location.
- One-tap "draft resupply email" for low items, per DME provider.
- Task assignment to a person; shift-handoff notes.
- Fax sending via an online fax API.
- Persisted assistant conversations (opt-in).
- Pre-compiled client bundle; offline read-only cache.
- Encryption at rest (SQLCipher) and encrypted backups.

---

## 6. Screens

### Navigation
- **Phone (primary, < 640px):**
  - fixed bottom bar: **Home · Supplies · Tasks · Care Team · Assistant**, icon + label, items ≥ 48px tall
  - floating **Scan** button on Home and Supplies
  - the same for family and nurse
- **Computer (≥ 1024px):** existing top tab bar, wider layouts, plus **Overview**.
- Header:
  - patient chip (name + initials avatar, distinct color per patient; tap → switcher)
  - account menu: **My profile**, **Patient profile**, **Members** (representative), **Usage report**, **Admin** (admin only), **Sign out**
- Removed as tabs:
  - Dashboard → Home
  - Scan → floating button/sheet
  - Portal → computer Overview; `?view=portal` redirects there
  - Users → Admin › Accounts
  - Activity → Supplies › History

### Screen list
1. **Welcome / first run.** Setup-code field (M4), then Create account.
2. **Sign in.** Username, then PIN keypad or password field depending on the user's type. "Remember username on this device". **Create account** and **I have an invite code** links. Errors for a wrong secret and for lockout.
3. **Create account.** Name, title (suggestions + free text), username, choose PIN or password, confirm.
4. **No patients yet.** "Ask the patient's parent or guardian for an invite." Enter invite code. Add a patient (Open decision 10).
5. **Join with invite.** Who invited you, the patient's first name, the role → Accept. Then **Waiting for approval**.
6. **Patient picker.** Cards: name, initials, DOB, low-stock count. Search when there are more than 5.
7. **Add-patient wizard.** Steps in M8.
8. **Home (phone).**
   - "Running low" cards with Restock and "Ask assistant to reorder"
   - "Waiting on you" (drafts, pending approvals for representatives)
   - "Tracked issues" (open tasks linked to providers, latest update)
   - "Recent activity"
   - floating Scan button
9. **Overview (computer portal).** Same blocks as Home, side by side, with full tables. For users with several patients, an "All my patients" table: low items, open issues, drafts waiting. Click a row to go to that patient.
10. **Supplies.** Search, category filter, low-only toggle, "Alerting items" filter. Card list on phone, table on computer. A bell icon marks items with alerts on. Tap an item → Supply detail.
11. **Scan sheet** (full screen on phone).
    - Patient name at the top.
    - Input: live camera, photo, or manual code.
    - Found: big **Used / Restocked / Counted** buttons, −/+ stepper, note, Save.
    - Not found: "Add new supply with this barcode".
12. **Supply detail.**
    - Fields and current qty.
    - Used / Restocked / Set exact count (with reason).
    - **Alert when low** switch + threshold.
    - Item history, Edit, Archive.
13. **Supplies › History.** Full log, filter by item and by person (shown as name + title).
14. **Usage report.** Date range, include-insurance toggle, Print / Save as PDF.
15. **Care Team.** Existing screen (everyone sees the full card).
16. **Tasks.** Existing list + full edit form + "Notify me about updates" switch on tasks linked to a provider.
17. **Assistant.** Existing chat + Outbox/Inbox. Additions:
    - first-use notice
    - consent banner ("Not shared with the assistant: clinical info")
    - provider-update confirm card
    - background jobs, so the conversation survives leaving the screen and locking the phone
18. **Patient profile.** Sections: Identity, Contact & insurance, Clinical, **AI sharing** (status for everyone; on/off per scope and consent history for representatives).
19. **Members** (representative).
    - Current members: name, title, role, representative badge, linked since; change role, make or remove representative, Remove.
    - **Waiting for your OK** (Approve/Decline, role editable).
    - **Open invites** (expiry, Cancel).
    - **Invite someone** → invite screen (QR, code, Share, Copy).
    - Non-representatives see a read-only member list and a **Leave** button.
20. **My profile.** Name, title, username, change PIN/password (switch type), idle sign-out, My patients (switcher + search), **Notifications** (per patient: low stock, assistant updates, tasks due; "Turn on notifications on this phone").
21. **Admin.**
    - **Accounts:** list with titles and linked-patient count; unlock, reset secret, deactivate/reactivate, admin flag; can't remove the last admin.
    - **Settings:** allow new accounts; assistant, web search and inbox reading on/off; email status; connection status; Backup; Restore.
    - **Audit log:** filter by patient and by user.
    - **Representative recovery.**

---

## 7. Data

Migrations run in order using `PRAGMA user_version`. Existing installs keep their data. Changing `supplies.barcode` uniqueness requires a SQLite table rebuild (create, copy, drop, rename) inside a transaction.

### New tables
```
organizations(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'household' CHECK(type IN ('household','agency','clinic')),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
)  -- MVP: exactly one row, type 'household'.

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
  created_by INTEGER REFERENCES users(id),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
)

patient_members(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id INTEGER NOT NULL REFERENCES patients(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  role TEXT NOT NULL CHECK(role IN ('family','nurse','doctor')),   -- 'doctor' reserved
  is_representative INTEGER NOT NULL DEFAULT 0,
  notify_low_stock INTEGER NOT NULL DEFAULT 1,
  notify_assistant INTEGER NOT NULL DEFAULT 1,
  notify_tasks INTEGER NOT NULL DEFAULT 0,
  invite_id INTEGER REFERENCES invites(id),   -- null for the patient's creator
  added_by INTEGER REFERENCES users(id),      -- representative who approved
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  removed_at DATETIME, removed_by INTEGER REFERENCES users(id)
)  -- partial UNIQUE index on (patient_id, user_id) WHERE removed_at IS NULL

invites(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id INTEGER NOT NULL REFERENCES patients(id),
  code_hash TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL CHECK(role IN ('family','nurse')),
  make_representative INTEGER NOT NULL DEFAULT 0,
  label TEXT,                                  -- e.g. "Night nurse"
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME NOT NULL,                -- created_at + 72h
  status TEXT NOT NULL DEFAULT 'open'
    CHECK(status IN ('open','accepted','approved','declined','cancelled','expired')),
  accepted_by INTEGER REFERENCES users(id), accepted_at DATETIME,
  decided_by INTEGER REFERENCES users(id), decided_at DATETIME
)

ai_consents(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id INTEGER NOT NULL REFERENCES patients(id),
  scope TEXT NOT NULL CHECK(scope IN ('clinical','identity_admin')),
  granted_by INTEGER NOT NULL REFERENCES users(id),
  granted_as TEXT NOT NULL CHECK(granted_as IN ('patient','representative')),
  granted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  revoked_by INTEGER REFERENCES users(id),
  revoked_at DATETIME
)  -- active = row for patient+scope with revoked_at NULL. Never deleted.

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
  action TEXT NOT NULL,
  entity TEXT, entity_id INTEGER,
  summary TEXT,                              -- short; no diagnoses or IDs
  via_assistant INTEGER NOT NULL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
)  -- append-only

app_settings(key TEXT PRIMARY KEY, value TEXT NOT NULL)
  -- allow_signups, assistant_enabled, assistant_web_search, inbox_reading_enabled,
  -- inbox_last_uid, vapid_public_key, vapid_private_key

push_subscriptions(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  endpoint TEXT NOT NULL UNIQUE, keys_json TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
)
```

### Changed tables
**users**
- Add: `org_id`, `username TEXT UNIQUE`, `title TEXT`
- Add: `secret_type TEXT CHECK(secret_type IN ('pin','password'))`, `secret_hash TEXT` (`scrypt$<salt>$<hash>`), `must_reset_secret INTEGER DEFAULT 0`
- Add: `is_admin INTEGER DEFAULT 0`, `active INTEGER DEFAULT 1`, `idle_minutes INTEGER`
- Add: `failed_attempts INTEGER DEFAULT 0`, `locked_until DATETIME`, `last_login_at DATETIME`
- The old `role` and `pin_hash` columns are no longer read; the migration clears `pin_hash`.

**supplies**
- Add: `patient_id NOT NULL`, `archived`, `alert_enabled INTEGER NOT NULL DEFAULT 0`, `alert_sent_at DATETIME` (cleared when qty rises above threshold).
- Barcode becomes `UNIQUE(patient_id, barcode)`.

**scan_log**: add `patient_id`, `quantity_before`, `quantity_after`; the action CHECK adds `'adjust'`; `user_id` comes from the session.
**providers**: add `patient_id` (sharing across siblings: Open decision 7).
**tasks**: add `patient_id`, `created_by`, `notify_updates INTEGER NOT NULL DEFAULT 0`.
**outbox**: add `patient_id`, `created_by`, `sent_by`.
**patient_profile**: replaced by `patients`; dropped after migration.

### Migration from the current version (v0 → v1)
1. Create one `organizations` row ("My household").
2. Create a `patients` row from `patient_profile` if it has a name or `onboarded = 1`, or if any supplies, providers or tasks exist. If there is no name, use "My child".
3. Set `patient_id` on all existing supplies, scan_log, providers, tasks and outbox rows.
4. Existing users: kept for history, `active = 0`, `pin_hash` cleared.
5. The next start runs first-run (M4) with a setup code. That first account becomes admin and is linked to the migrated patient as family + representative.
6. Existing supplies are kept, with `alert_enabled = 0`. Show a one-time prompt: "Choose which items should alert you."

### Timestamps
The API returns ISO-8601 UTC (`2026-11-15T14:03:00Z`); the client shows local time.

---

## 8. Privacy and security

1. **Where data lives:** `server/meditrack.db` on the home computer, plus downloaded backups. README + Settings recommend turning on disk encryption (BitLocker / FileVault) and a computer login password.
2. **Who can reach it:** depends on Open decision 1. In every option, every API call needs a signed-in session, and patient data needs a membership.
3. **Self-signup is safe by design:**
   - a new account sees nothing
   - access needs an invite code from a representative **and** their approval
   - patients are never searchable or listed to non-members
   - sign-up is rate-limited and can be switched off
   - first run is protected by a setup code shown only on the computer
4. **Authentication:** individual accounts; PIN or password, both scrypt-hashed; lockout; idle sign-out; `HttpOnly` + `SameSite=Strict` (+ `Secure`) cookies.
5. **Authorization:** per user, per patient (M3), enforced in the server. Being admin gives no patient access.
6. **Browser attacks:**
   - no CORS; origin check on state-changing requests
   - no runtime third-party scripts
   - headers: `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY`
   - CSP `'self'` (plus `'unsafe-eval'` while in-browser Babel remains)
7. **In transit:** depends on Open decision 1. When the connection isn't encrypted, Settings says so.
8. **AI provider:**
   - patient data only with recorded, revocable, per-patient consent, off by default (M10)
   - the same rule for family and nurses
   - the assistant never sends email
   - provider edits need confirmation
   - email content is treated as untrusted (keep the existing system-prompt rule)
9. **Email:**
   - The inbox is whatever mailbox is configured in `.env`. **All linked members, including nurses, can read it.** For that reason the spec recommends a separate email address used only for care correspondence (Open decision 2).
   - Sending always needs a human tap.
10. **Push notifications:** generic text only (M16). Push services (Apple/Google) carry the message.
11. **Audit:** M15, append-only.
12. **Secrets:** `.env` stays out of git; document that it holds the email app password. VAPID keys live in `app_settings`.
13. **Logs:** the server console never prints request bodies, profile data, email contents or invite codes.
14. **No compliance claims:** do not claim HIPAA compliance anywhere.

### Path to agency/HIPAA (do not build now; don't block it)
If an agency or clinic adopts MediTrack, it would likely bring HIPAA obligations. At minimum:
- Hosting with a signed Business Associate Agreement (BAA).
- BAAs with the AI, email, tunnel and push providers that handle patient data, or those features turned off.
- A risk assessment, written policies, staff training and breach-notification procedures.
- Encryption at rest and in transit, encrypted backups, defined retention.
- Unique user IDs, automatic logoff, access control and audit controls. **The MVP already provides these (M2, M3, M15).**
- Organization separation: `org_id` on users, patients and the audit log is in place for this.
- Organization admins who can manage staff accounts. The invite model extends to "agency invites staff".
- 2-step sign-in and internet-grade rate limiting if hosted.
- Consent records (the `ai_consents` pattern) extended to other disclosures.

---

## 9. Visual style

**Keep** the current look: navy/blue header, white cards on light gray, colored category and status badges, teal accent. It is calm, readable and consistent.

**Change, for phone-first use and accessibility:**
1. Bottom navigation on phones and a floating Scan button. Inline SVG icons + labels instead of letters.
2. Touch targets ≥ 44px on phones. Primary actions at the bottom, within thumb reach.
3. Inputs at 16px on phones (14px makes iOS zoom in).
4. Tables become stacked cards under 640px; tables stay on the computer Overview.
5. Text contrast: replace `--gray-500` (#9e9e9e) with `--gray-700` for text.
6. Status = text + color. One palette: red = out / error, orange = low / needs action, green = OK / done, blue = info.
7. Header patient chip (distinct color per patient) on every patient screen. Show people as "Name (Title)" everywhere.
8. Large, high-contrast invite code and QR code on the invite screen.
9. Web app manifest + icon so "Add to Home Screen" looks like an app (also required for iPhone notifications).

---

## 10. Open decisions

Plain-language questions for the owner. The spec's current default is shown after each one.

1. **How should phones connect to MediTrack?** MediTrack runs on your home computer. Phones need a secure connection to it for two things: scanning barcodes with the live camera, and getting notifications. Without one, scanning still works by taking a photo of the barcode, but notifications don't work. The app will work with any of these, so you can start with option 1 and switch later.

   | | 1. Home Wi-Fi only (as today) | 2. Private network app | 3. Security certificate on each phone | 4. Public web address |
   |---|---|---|---|---|
   | Day to day | Works only at home on your Wi-Fi. Scan by taking a photo. No notifications. | Works at home and away (e.g. check supplies from work). Live scanning and notifications. | Works only at home. Live scanning and notifications. | Works anywhere, like a normal website. Live scanning and notifications. |
   | What gets installed | Nothing. | A free app (e.g. Tailscale) on the home computer and on **every phone** that uses MediTrack, including each nurse's phone. Everyone signs into it once. | A security file on the computer and on **every phone**. On iPhone this takes several steps in Settings. Every new nurse's phone needs the same setup. | Nothing on phones. A small program on the home computer. |
   | Cost | Free | Usually free for a family; check the plan's limits if many people need access. | Free, but takes time and someone comfortable with tech settings. | Roughly $10-20 a year for a web address, or a monthly hosting fee if moved off the home computer. |
   | Main downside | No notifications; not encrypted on Wi-Fi. | Nurses must agree to install an app; some agencies may not allow it on work phones. | Fiddly, home-only, has to be redone for each new phone. | MediTrack becomes reachable from the internet (sign-in still protects it). A company in the middle carries the traffic. Stronger sign-in is recommended before using this. |

   *Spec default: option 1 until you decide. Option 2 is recommended.*

2. **Which email account should MediTrack use?** Everyone you link (family and nurses) can read the inbox MediTrack is connected to. If that's your personal email, nurses would see all of your mail. *Default: use a separate email address only for care and supply companies.* Is that OK?
3. **How long before the app signs people out when idle?** Nurse and family now differ only in this. *Default: family 12 hours, nurses 30 minutes; each person can shorten their own.* Should nurses get the same 12 hours?
4. **What exactly needs AI permission?** *Default: two separate switches, both off. "Medical info" covers diagnoses, equipment, care notes and the supply list. "Personal and insurance info" covers name, birth date, address, insurance numbers and the care team list. With both off, the assistant still helps but leaves blanks to fill in.* Is that split right?
5. **Low-stock alerts: shared or personal?** *Default: which items alert, and at what number, is set once per child and shared by everyone. Each person only chooses whether they get the notifications.* Or should each person pick their own items?
6. **Resupply schedule** (how many of each item insurance allows per month, and the next order date): needed for the first family, or later? *Default: later.*
7. **Siblings and providers:** if two children use the same pharmacy or supply company, should it be entered once for the household, or separately for each child? *Default: separately per child.*
8. **Call scripts:** *Default: use the child's name, never "he/she".* Keep that, or let families choose pronouns?
9. **Starter supply list:** OK to offer the existing 35 trach / vent / G-tube items with counts at 0 and no alerts switched on?
10. **Who can add a new patient?** *Default: anyone with an account. They become that patient's representative, and it doesn't give them access to anyone else.* Or only the admin?
11. **Can a nurse be a representative?** A representative can approve people and give AI permission for the child. *Default: allowed, with a warning.* Or should this be limited to family?
12. **Several representatives:** *Default: a child can have more than one (e.g. both parents), and any of them can approve people or change AI permission.* OK? Should an older patient be able to sign in and give permission for themselves later?
13. **Nurses who work for two families:** each family runs its own MediTrack, so the nurse would have two separate logins. OK until there's an agency version?
14. **Invites:** *Default: the code works once, expires after 72 hours, and you approve the person with one tap after they accept.* Is the extra approval tap OK, or would you rather they get access as soon as they enter the code?
