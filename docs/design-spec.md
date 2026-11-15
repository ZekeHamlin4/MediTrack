# MediTrack Design Spec

Status: revision 4. The owner's answers so far are applied:
- phone-first design
- sign in with a PIN or a password
- the AI sees patient data only with per-patient consent
- no doctor login for now
- several patients per user, with an agency-ready data model
- people create their own accounts
- push notifications

New in revision 4:
- **each patient account has exactly one patient admin**: whoever created the profile
- the patient admin sets **per-person permissions** and may delegate "manage people"
- people join by invite **or by request**
- admin can be transferred, with a recovery path
- every screen updates **live**

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

**Roles today**: `family`, `nurse`, `doctor`, `admin` are labels only. No login, no permission checks. Screens load data once and never refresh: two people looking at Supplies see different numbers until they reload.

---

## 2. Target users and devices

**Phone-first.** Daily work (logging use, scanning, restocking, ticking tasks, calling providers, approving drafts, reacting to notifications) happens on phones. The computer is mainly for the Overview ("portal"), printing reports and keeping the install running. Every screen must work one-handed on a phone, and every open screen updates live (M7).

**Two different kinds of admin. They are separate, and the UI must never call either of them just "admin":**
- **Patient admin**: the **one** person who owns a patient's account. Whoever creates the patient profile becomes its patient admin automatically: the patient themselves, or a parent creating it for a child. A nurse can be patient admin if they created the profile or it was transferred to them.
  - Adds and removes people, accepts or denies join requests, and sets each person's permissions.
  - Gives or withdraws AI consent, acting as the patient or the patient's representative.
  - Can hand specific abilities to specific people (delegation), but stays the sole owner.
  - Earlier drafts allowed several "representatives"; that is replaced by this single-admin model.
- **Computer admin** (install admin): the person who set up MediTrack on the home computer. Handles settings, backup/restore, unlocking accounts, connection and email setup, and patient-admin recovery. Being computer admin gives **no** access to any patient's information.

| User | Signs in (MVP) | Needs |
|---|---|---|
| **Family caregiver** (title e.g. Mom, Dad, Grandparent) | yes | Know what's low before it runs out; provider numbers and account #s; drafts and scripts fast; track supply-company issues; get notified. |
| **Nurse / home health aide** (may serve several patients) | yes | By default **the same access as family** for linked patients. The patient admin can narrow it per person. |
| **Patient (adult or older child)** | yes, if they create their own profile | Same as family; they are their own patient admin. |
| **Patient admin** (one per patient; family, nurse or the patient) | yes | Everything, plus: people, permissions, join requests, invites, AI consent, transfer admin, patient audit log. |
| **Delegate** (any member given "Manage people") | yes | Invite people, accept/deny requests, add/remove nurses and other ordinary members, within limits (M3). |
| **Doctor / clinic** | **no** (role reserved for later) | Receives a printable usage report. |
| **Computer admin** (the first user; a flag) | yes | Settings, backup/restore, unlock/reset sign-in, deactivate accounts, full audit log, patient-admin recovery. |

---

## 3. Gaps and problems

### 3a. Security (blocking for real use)
1. **No login.** Anyone on the Wi-Fi sees and changes everything, including diagnoses, insurance/Medicaid IDs and the parent's inbox, and can send email as the parent.
2. **Roles not enforced.** "Read-only" Portal is just a tab; every API endpoint accepts any request.
3. **Open CORS** (`app.use(cors())`). Any web page opened on the home network can read `/api/profile`, `/api/email/inbox` and trigger `/api/outbox/:id/send`.
4. **PINs stored in plain text** in `pin_hash`; seeded users have known PINs (`0000`, `1234`...). Never checked.
5. **Anyone can log as anyone** via Scan's "Logged by" dropdown.
6. **Plain HTTP.** Health data crosses Wi-Fi unencrypted; browsers block the live camera and push notifications on non-secure pages.
7. **CDN scripts**, unpinned, no SRI. A compromised CDN would get full data access; app fails offline.
8. **AI data sharing is implicit.** Every assistant request sends the full family profile; `read_inbox` sends email contents; web search on by default. No consent recorded.
9. Server accepts the whole chat history from the client, including assistant/tool turns, unchecked.
10. `.env` holds the email app password in plain text (acceptable for a home install; must be documented).

### 3b. Broken or buggy
1. **Deleting a supply or user with scan history fails** (FK on `scan_log`, no ON DELETE rule) with a 500, but the UI shows "deleted": the `api` helper in `index.html` never checks `r.ok`, so all save failures look like success.
2. **Inline quantity edits bypass the log** and **overwrite** the quantity (`PUT quantity=n`), so two people editing at once silently lose one change.
3. **No live updates**; stale numbers on every other open screen.
4. **Timestamps** are UTC without a zone marker and parsed by the client as local time.
5. **Family profile can't be edited after setup.**
6. Tasks: no description field on add; title, steps, due date not editable later. Ticking a step re-sends the whole step list (another overwrite).
7. Supply categories hard-coded in the client (`CATS`).
8. Call scripts say "my son" / "his".
9. Demo supplies and users seeded into every real install.

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
- New tables: `organizations`, `patients` (replaces `patient_profile`, with `admin_user_id`), `patient_members`, `invites`, `join_requests`, `admin_transfers`, `ai_consents`, `sessions`, `audit_log`, `app_settings`, `push_subscriptions`.
- Add `patient_id` (and `version` where noted) to supplies, scan_log, providers, tasks, outbox; backfill existing data.
- Fresh installs: no seeded users or supplies.

**M2. Self-service accounts and sign-in**
- Anyone who can reach MediTrack can create an account: name, **title** (free text with suggestions: Mom, Dad, Grandparent, Nurse, Home health aide, Patient, Other), username, secret.
- The title is display text only ("Sam (Night nurse)"). It never grants permissions.
- **A new account with no patient links sees no patient data**, only the "No patients yet" screen.
- Secret: the user chooses a **6-digit PIN** or a **password** (min 10 characters), and can switch later.
- Both hashed with Node `crypto.scrypt` + per-user salt; never returned by any API.
- Lockout: 5 failures → locked 15 minutes.
- Abuse limits: max 5 new accounts per IP per hour. Computer-admin setting "Allow new accounts" (default on).
- Forgotten secret: the computer admin sets a temporary PIN, which must be changed at next sign-in.
- Session: random 32-byte token in an `HttpOnly`, `SameSite=Strict` cookie (`Secure` on HTTPS), stored in `sessions`.
- Idle sign-out (Open decision 4): 12 h if any membership is family/self; 30 min if all memberships are nurse. Users may shorten it.
- Accounts are deactivated, never deleted.

**M3. One patient admin, per-person permissions, delegation (enforced on the server)**
- Every patient has exactly **one patient admin**, stored as `patients.admin_user_id`. It is set automatically to the user who creates the patient. The patient admin is also a member with every permission.
- Every other person linked to the patient (`patient_members`) has:
  - **role**: `family`, `nurse` or `self` (the patient themselves). It is a label plus a starting preset. `doctor` is reserved (in the schema, not in the UI).
  - **eight permission switches**, set by the patient admin (or, within limits, a delegate).

**Always allowed for every linked person** (the baseline; no switch):
- see the patient's name, DOB and clinical info (diagnoses, equipment, care notes)
- see supplies, levels and history; log Used / Restocked / Counted (scan or manual)
- see care team names, phone/fax/department numbers and call scripts
- see tasks and tick steps
- print the usage report (without insurance info)
- see the member list; receive notifications they switch on; **Leave**

**Permission switches:**
| # | Switch | What it allows |
|---|---|---|
| 1 | **Insurance & account numbers** | See and print insurance/Medicaid IDs, home address, parent contact details, provider account numbers and provider notes. |
| 2 | **Email inbox & outbox** | Read the care inbox, see drafts in the Outbox. |
| 3 | **Send email** | Approve and send drafts. Requires switch 2. |
| 4 | **AI assistant** | Use the assistant for this patient (still limited by the patient's AI consent, M11). |
| 5 | **Edit supply list** | Add/edit/archive items; change thresholds and low-stock alert settings. |
| 6 | **Manage tasks** | Create, edit, delete tasks. |
| 7 | **Edit profile & care team** | Edit patient profile; add/edit/delete providers; NPI search. |
| 8 | **Manage people** (delegation) | Create invites, accept/deny join requests, add and remove ordinary members, set their switches 1-7. Limits below. |

**Presets** (one tap; the switches can then be adjusted):
- **Full access**: switches 1-7 on, 8 off. **Default for family, nurse and self**, per the owner's direction that nurses get the same access as family.
- **Hands-on care only**: all switches off (baseline only). For an aide or sitter, or a nurse who doesn't handle insurance or email.
- Switch 8 is never part of a preset. The patient admin turns it on deliberately for a specific person.

**Only the patient admin can** (never delegated):
- turn "Manage people" on or off for anyone
- remove or change the switches of a delegate
- give or withdraw AI consent
- turn the patient share code on/off or replace it
- transfer the admin role
- view the patient's audit log
- archive the patient

**Delegate limits ("Manage people"):**
- can invite and accept people only with switches the delegate has themselves (no granting more than they hold), and never switch 8
- can remove members who are not delegates; cannot remove the patient admin or another delegate
- cannot change their own switches
- every delegate action is audited and announced to the patient admin by push ("someone joined", "someone was removed")

**Family vs nurse:** with the default preset, they differ only in the role label and the default idle sign-out (M2).

**Computer admin** (user flag, separate from patient admin):
- can change settings, run backup/restore, unlock accounts, reset secrets, deactivate accounts, view the full audit log, and do patient-admin recovery (M4)
- can **not** see any patient's data or add people to a patient unless they are also a member of that patient

Enforcement:
- Patient-scoped endpoints live under `/api/patients/:patientId/...`. Middleware loads the caller's membership and checks the baseline, the needed switch, or "is patient admin" on **every** call.
- Fields covered by switch 1 are **removed on the server** for people without it.
- Assistant tools follow the switches:
  - `read_inbox` / `draft_email` need switch 2
  - `create_task` / `update_task` need switch 6
  - `save_provider` needs switch 7
  - identity/insurance data needs switch 1 **and** consent
- Unscoped endpoints:
  - `/api/auth/*`
  - `/api/me` (user plus their patients, role, switches, and whether they are patient admin)
  - `/api/patients?search=` (own patients only)
  - `POST /api/patients` (create a patient; the creator becomes its patient admin)
  - `/api/invites/*`, `/api/join-requests/*`, `/api/admin-transfers/*`
  - `/api/admin/*` (computer admin)
  - `/api/call-tips`, `/api/lookup`
- Remove `cors()`. Reject state-changing requests whose `Origin` header is present and not the app's own origin.
- Errors: 401 when not signed in, 403 when not allowed, 404 for patients the caller isn't linked to.

**M4. Joining, removing, transferring admin, recovery**
Two ways in. **Neither lets anyone browse, search or list patients.** Both need something the family handed over. Both can be handled by the patient admin or a delegate (M3).

**Way 1: Invite (the patient admin or a delegate starts it).**
- Choose role and preset/switches up front.
- The result is a single-use code (8 characters, e.g. `K7QM-4ZPX`) with a link `<app address>/join/<code>` and a QR code. It expires after 72 h, can be cancelled, and is stored hashed.
- **No extra approval tap:** accepting gives access at once, because the person and their permissions were already chosen. Safety net:
  - the patient admin gets a push "someone joined using your invite"
  - the Members screen highlights the newcomer with **Remove**
  - codes are single-use and short-lived

**Way 2: Request to join (the newcomer starts it).**
- Each patient has a **share code** (e.g. `MT-P4X9-KQ2D`), **off by default**.
- Only the patient admin turns it on, gives it out (read aloud, text, QR), turns it off or replaces it.
- It only lets someone *ask*; it gives no access by itself.
- After sending, the requester sees only "Request sent. The patient's admin will review it." No name, no DOB.
- Rate limit: 5 code attempts per account per 15 min, and per IP. One pending request per person per patient. Requests expire after 14 days.
- The share code was chosen over "type the admin's username" because it doesn't expose usernames, points at exactly one patient, and can be switched off or changed if it leaks.

**Phone flow: request (nurse Sam asks to join)**
1. Sam creates an account (or signs in) → "No patients yet" → **Ask to join a patient**.
2. Enters the share code (or scans the QR code), plus an optional message ("Night nurse from Sunrise Home Health, starting Monday") → **Send request**.
3. Sees "Request sent". Their Home shows "Waiting for approval" with **Cancel request**.
4. Accepted → push "MediTrack: you've been given access." and the patient appears in My patients. Denied → push "MediTrack: your request wasn't accepted." No details.

**Phone flow: request (patient admin Mom, or a delegate, answers)**
1. Push "MediTrack: someone asked to join." → **Members → Requests**.
2. Card: name, title, username, message, account age.
3. **Accept** opens a sheet: role (Family / Nurse), preset (Full access / Hands-on care only), switches 1-7 (expandable; switch 8 is shown only to the patient admin) → **Confirm**.
4. **Deny**, with an optional tick "Don't let this person request again for this patient".

**Phone flow: invite (Mom invites Dad)**
1. Members → **Invite someone** → role, preset/switches, optional label ("Dad") → **Create invite**.
2. The screen shows a QR code, the code in large letters, the expiry, and **Share** / **Copy**.
3. Dad opens the link → creates an account or signs in → "Mom invited you to join [first name]'s care team as Family" → **Accept** → that patient's Home.

**Removing people**
- The patient admin can remove anyone.
- Delegates can remove ordinary members (not the patient admin, not other delegates).
- Any member can **Leave**. The patient admin can't leave until they have transferred the admin role.
- The computer admin can deactivate an account, which removes it from every patient. If that account was a patient admin, the patient goes to recovery.
- Removal and permission changes apply **immediately**: the next request is checked, and the person's live connection (M7) is told to reload or is closed.

**Transfer admin** (one admin is a single point of failure, so make handing over easy)
1. The patient admin → Members → a person → **Make patient admin** (or Patient profile → **Transfer admin**). Any current member can be chosen, including a nurse.
2. Confirm screen: "[Name] will own this account, manage people and AI permission. You will stay as a member with Full access." → **Send**.
3. The chosen person gets a push and a card on Home: **Accept** / **Decline**. Nothing changes until they accept. Pending transfers expire after 7 days and can be cancelled.
4. On accept:
   - `patients.admin_user_id` switches
   - the old admin becomes a member with Full access (the new admin can change that later)
   - existing AI consent stays in force, but the new admin sees a one-time prompt "Review AI permission" and can withdraw it
5. Audited; both people notified.

**Recovery** (patient admin gone, locked out, or account deactivated)
- The computer admin → Computer admin › **Patient-admin recovery** → the patient (shown by name only to choose; no other data) → picks one of that patient's **existing members** → types a reason → **Reassign**.
- The new admin is notified and must accept, as in a transfer. The previous admin, if their account is still active, gets a push "Your patient admin role was reassigned."
- The computer admin cannot make themselves patient admin unless they are already a member of that patient, and cannot add new people.
- Recorded in the audit log with the reason. The patient's members see a line in Members: "Admin reassigned by the computer admin on [date]".
- If the patient has no other members, recovery is not possible. The data stays and the patient can be archived by the computer admin.

**First run (the very first user)**
1. The server prints a one-time **setup code** in the MediTrack window on the computer. The Welcome screen asks for it, so nobody else on the Wi-Fi can claim the install.
2. Create account (name, title, username, PIN or password). This user becomes **computer admin**.
3. **Add your first patient** wizard (M9). The creator becomes that patient's **patient admin**.
4. Optional wizard step: **Invite people** or **Turn on join requests**.

Upgrades from the current version use the same flow; the first account becomes patient admin of the migrated patient (section 7).

**M5. Patient switcher and search**
- The current patient is part of the client URL (e.g. `#/p/12/supplies`).
- A patient name chip is always visible in the header and on the Scan sheet. Tap it to open the switcher.
- My profile → **My patients**: list with role and an "Admin" badge where the user is patient admin.
- Search box (name, DOB) when the user has more than 5 patients. Search covers own patients only.
- After sign-in: no patients → "No patients yet"; 1 patient → Home; several → the last-used patient or the picker.

**M6. Trustworthy supply log (change-based quantities)**
- Quantities change **only** through movements: `POST /api/patients/:pid/supplies/:id/movements` with `{action: add|remove|check|adjust, amount, reason?}`.
- `add` / `remove` are applied as **+/- changes** in one SQL statement (`quantity = MAX(0, quantity ± n)`). They are never overwritten, so two people logging at once both count.
- `check` / `adjust` ("Set exact count") set an absolute number and record `quantity_before` / `quantity_after`.
- Every movement writes a `scan_log` row with the signed-in user, patient, action, amount, before/after, and optional reason.
- `PUT` on a supply no longer accepts `quantity`.
- Remove the "Logged by" dropdown. Archive supplies instead of deleting them.

**M7. Live sync across every screen**
Owner requirement: when stock (or other shared data) changes, every open screen on every account shows it at once, with no refresh.

**Mechanism: Server-Sent Events (SSE).**
- `GET /api/patients/:pid/events`: one stream for the patient on screen. Requires a session and membership.
- `GET /api/me/events`: one per signed-in user, for membership changes, requests, transfers and Overview counts across patients.
- MediTrack is a single Node process, so an in-memory publish/subscribe per patient is enough. No extra services.

**Events** carry a type, the record id, the new `version`, and only baseline-visible fields:

| Event | Payload | Who receives |
|---|---|---|
| `supply.changed` | id, quantity, low flag, version, by (name + title) | all members |
| `supply.movement` | supply id, action, amount, by, at | all members |
| `task.changed` | id, version | all members |
| `outbox.changed` | id, status | members with switch 2 |
| `providers.changed` | id | all members (client refetches; server strips fields) |
| `profile.changed` | version | all members (client refetches) |
| `consent.changed` | scopes on/off | all members |
| `members.changed` | (no details) | all members; patient admin and delegates refetch Members |
| `admin.changed` | new admin's name + title | all members |
| `access.changed` | (no details) | the affected person only; client reloads `/api/me` and leaves the patient if removed |

- Anything sensitive is never pushed in an event. The client refetches through the normal API, which applies switches and field stripping.
- When a person's permissions change or they are removed, the server closes their patient stream right away.
- A heartbeat comment every 25 s keeps connections open. Session expiry closes the stream.

**Reconnect:**
- Each patient keeps an in-memory ring buffer of its last 500 events with increasing ids.
- The browser's `EventSource` reconnects and sends `Last-Event-ID`; the server replays what was missed.
- If the id is too old or the server restarted, the server sends `resync` and the client refetches the current screen.
- The client also refetches when the app returns to the foreground or the network comes back.
- Header status dot: green "Live", gray "Reconnecting…".
- While offline, edit buttons show "Not connected, can't save right now". There is no offline queue in MVP.

**Conflicting edits:**
- **Quantities:** +/- changes (M6), so they never conflict.
- **"Set exact count" vs a change made at the same moment:** the count wins, because it is what's physically on the shelf. Both are logged. Other screens show "Sam just counted: 12".
- **Everything else** (supply details, tasks, profile, providers, drafts, permissions) has a `version` number.
  - Saves send the version they started from. If it no longer matches, the server answers **409** with the current record.
  - The form then shows "Sam (Night nurse) changed this a moment ago" with their values, and the user can **Keep mine** or **Use theirs**.
  - Nothing is ever silently overwritten.
- **Task steps:** each step has a stable `id`, and ticking uses `PATCH /tasks/:id/steps/:stepId {done}`.
- **If the record you're editing changes underneath you:** a banner appears; your typing is kept until you choose.

**M8. Bug fixes from 3b**
- The API helper shows server errors.
- Timestamps are ISO-8601 UTC, shown in local time.
- The profile is editable and tasks are fully editable.
- Categories come from the server.
- Call scripts use the child's name (`[child's name]`) and no pronouns (Open decision 7).

**M9. Adding a patient**
- Any signed-in user can add a patient and becomes its **patient admin** (owner: "when a patient creates their profile it will make them admin of their account").
- Wizard (reuses `SetupWizard`):
  1. **Who is this for?** "Me" (role `self`) or "Someone I care for" (role `family` or `nurse`)
  2. Patient info
  3. Care team
  4. Supplies: start from the common trach / vent / G-tube list (35 items, quantities 0) or start empty, then "Which items should alert you when low?" (none ticked by default)
  5. AI sharing: explained, off
  6. Invite people / turn on join requests (optional)

**M10. Works with any connection method; scanning on phones**
The build must not depend on Open decision 1. Settings in `.env` choose between:
- plain HTTP on the home network (default)
- HTTPS with certificate files (`HTTPS_CERT`, `HTTPS_KEY`)
- running behind a private-network app or tunnel that provides HTTPS (`TRUST_PROXY=1`, optionally localhost-only)

The client checks what the connection allows:
- **Secure connection:** live camera scanning and push notifications.
- **Not secure:** **"Take photo of barcode"** (`<input type="file" accept="image/*" capture="environment">` + Quagga single-image decode) plus manual entry. Notifications show "need a secure connection".

Live sync works on every option. Settings shows "Connection: secure" or "Connection: home Wi-Fi only, not encrypted".

**M11. AI assistant: consent, permissions, background work**
Consent:
- Using the assistant needs **switch 4**. Each user sees a one-time notice that what they type is sent to the AI provider.
- **Patient data goes to the AI only with consent recorded by the patient admin**, acting as the patient (role `self`) or as the patient's representative. It is off by default, per patient, and revocable.
- Only the patient admin sees the switches. Turning sharing on shows who is consenting: "I am the patient" / "I am the patient's parent, guardian or authorized representative" → **Confirm**.
- Delegates cannot change consent.
- Each grant/revoke is stored in `ai_consents`: who, capacity (`patient` / `representative`), when, when/by whom revoked. History kept.
- Two scopes, each on/off (exact contents: Open decision 3):
  - `clinical`: diagnoses, equipment, care notes, supply list and levels
  - `identity_admin`: name, DOB, address, parent contact, insurance/Medicaid IDs, care team details and account numbers
- Without a scope (or without the matching switch for the person asking), the server leaves that data out of the prompt. Tools return "Not shared with the assistant", and drafts use `[placeholders]`.
- Revoking takes effect on the next request and clears in-memory chats for that patient (`consent.changed`).
- After an admin transfer, the new admin is prompted to review consent (M4).

Background work:
- Chat requests run as server-side jobs. If a job finishes and the client hasn't collected it within 10 s, send an "assistant has an update" push.
- Results stay in memory until read or for 24 h, never written to disk.

Safety:
- `save_provider` on an existing provider needs a confirm card (old vs new).
- The client sends only new user text; the server keeps the conversation per session and patient.
- Computer-admin settings: assistant on/off, web search on/off, inbox reading on/off.

**M12. Local front-end libraries**: serve React (production), ReactDOM, Babel standalone and Quagga from `client/vendor/`, pinned. No CDN requests.

**M13. Phone-first navigation + computer Overview** (section 6). Web app manifest, icon, service worker.

**M14. Printable usage report** (how families share with doctors for now)
- Per patient, date range (default 3 months).
- Per item: start qty, used, restocked, end qty, average use per week/month, low status.
- Header: patient name, DOB, generated by/when.
- Print / Save as PDF.
- "Include insurance info" only with switch 1.
- Audited.

**M15. Backup and restore** (computer admin)
- "Download backup" (SQLite online backup API, `meditrack-backup-YYYY-MM-DD.db`, health-information warning).
- "Restore" with confirm.
- README section on upgrading safely.

**M16. Audit log**
- Written from M2 onward; this item adds the viewer. Append-only.
- Logged events:
  - sign-ins and lockouts; account changes
  - patient created; invites, requests, membership and **permission changes** (before → after, by whom, whether by a delegate)
  - **admin transfers and recoveries** (with reason)
  - profile viewed (once per session per patient) and edited
  - AI consent with capacity
  - provider changes (marked if via the assistant)
  - email sent, report generated, backup/restore
- The computer admin sees everything; the patient admin sees their patient's entries.

**M17. Push notifications**
- Needs a secure connection (M10). On iPhone the app must also be on the Home Screen. Built regardless; it switches on when possible.
- **Events:**
  1. **Low stock, chosen items only.**
     - Each item has "Alert when low" (off by default) and its own threshold (`low_stock_threshold`).
     - These settings are **per patient and shared by everyone**. Changing them needs switch 5.
     - One push when an alerting item drops to or below its threshold. No repeat until it has been restocked above.
     - Each person chooses whether *they* receive low-stock pushes for each patient.
  2. **Assistant updates on supply-company issues** (only with switch 4; email-based ones also need switch 2):
     - **answer ready**: background job finished while away
     - **draft needs approval**: new assistant draft in the Outbox
     - **reply received**: new email from a provider linked to a *tracked issue*. A tracked issue is a task linked to a provider, not done, with "Notify me about updates" on. That switch is on by default when the assistant creates the task.
     - Reply detection: the server checks the inbox every 15 min (when IMAP is set up and inbox reading is on) and matches the sender against the provider's email, department emails, or email domain.
     - The AI is never run on incoming mail by itself.
  3. **Tasks due today / overdue:** optional, off by default.
  4. **People and admin:**
     - patient admin and delegates: "someone asked to join"
     - patient admin: "someone joined" / "someone was removed" when a delegate did it
     - newcomer: "you've been given access" / "your request wasn't accepted"
     - transfers: "you've been asked to become admin"
- **Text is generic**, with no health details, item, provider or patient names:
  - "MediTrack: a supply is running low."
  - "MediTrack: the assistant has an update."
  - "MediTrack: a reply arrived about one of your issues."
  - "MediTrack: a task is due."
  - "MediTrack: someone asked to join."
  - "MediTrack: you've been asked to become an admin."
- Tapping a notification opens the right screen for the right patient.
- Settings: My profile → Notifications, per patient. People/admin pushes are always on for the patient admin and delegates.
- Pushes only go out while the home computer and MediTrack are running; the UI says so.

---

## 5. Later features (not MVP)

- **Doctor login**: enable the reserved `doctor` role (baseline only, read-only). Roles, presets and join flows already allow it.
- **Agency/clinic version**: several households per install or hosted, organization admins, staff directories, 2-step sign-in (see section 8).
- More permission switches if real use shows a need (e.g. hide clinical notes from some people).
- Email-based "forgot my PIN/password".
- Resupply schedule per item (Open decision 5).
- Expiration dates / lot numbers; go-bag checklist; storage location.
- One-tap "draft resupply email" for low items, per DME provider.
- Task assignment; shift-handoff notes.
- Fax sending via an online fax API.
- Offline mode with queued changes.
- Persisted assistant conversations (opt-in).
- Pre-compiled client bundle.
- Encryption at rest (SQLCipher) and encrypted backups.

---

## 6. Screens

### Navigation
- **Phone (primary, < 640px):**
  - fixed bottom bar: **Home · Supplies · Tasks · Care Team · Assistant**, icon + label, items ≥ 48px tall
  - Assistant hidden without switch 4
  - floating **Scan** button on Home and Supplies
- **Computer (≥ 1024px):** existing top tab bar, wider layouts, plus **Overview**.
- Header:
  - patient chip (name + initials avatar, distinct color per patient; tap → switcher)
  - live-status dot
  - account menu: **My profile**, **Patient profile**, **Members**, **Usage report**, **Computer admin** (computer admin only), **Sign out**
- Removed as tabs:
  - Dashboard → Home
  - Scan → floating button/sheet
  - Portal → Overview; `?view=portal` redirects there
  - Users → Computer admin › Accounts
  - Activity → Supplies › History

### Screen list
1. **Welcome / first run.** Setup-code field, then Create account.
2. **Sign in.** Username, then PIN keypad or password field. "Remember username on this device". **Create account** and **I have an invite or share code** links. Errors for a wrong secret and for lockout.
3. **Create account.** Name, title (suggestions + free text), username, PIN or password.
4. **No patients yet.** Big buttons: **I have an invite**, **Ask to join a patient**, **Create a patient profile** ("for me" or "for someone I care for").
5. **Join with invite.** Who invited you, the patient's first name, the role → Accept → patient Home.
6. **Ask to join.** Share code (typed or QR), optional message → Send. Then **Waiting for approval** (Cancel request).
7. **Patient picker.** Cards: name, initials, DOB, low-stock count, "Admin" badge. Search when there are more than 5.
8. **Add-patient wizard.** Steps in M9.
9. **Home (phone).**
   - "Running low" cards (Restock; "Ask assistant to reorder" with switch 4)
   - "Waiting on you": drafts (switch 2), join requests (admin/delegates), admin-transfer request
   - "Tracked issues"
   - "Recent activity" (updates live)
   - floating Scan button
10. **Overview (computer portal).** Same blocks as Home, side by side, with full tables. "All my patients" table for users with several patients. All live.
11. **Supplies.** Search, category filter, low-only, "Alerting items" filter; cards on phone, table on computer. Bell icon on items with alerts on. Live quantities, with a brief highlight on changes made by others.
12. **Scan sheet.**
    - Patient name at the top.
    - Input: live camera, photo, or manual code.
    - Found: **Used / Restocked / Counted**, −/+ stepper, note, Save.
    - Not found: "Add new supply with this barcode" (switch 5) or "Not found".
13. **Supply detail.**
    - Fields and live quantity.
    - Used / Restocked / Set exact count (reason).
    - With switch 5: **Alert when low** + threshold, Edit, Archive.
    - Item history.
14. **Supplies › History.** Full log, live, filter by item and by person ("Name (Title)").
15. **Usage report.** Date range, include-insurance (switch 1), Print / Save as PDF.
16. **Care Team.** Existing screen. Account #s and notes need switch 1. Edit, delete and NPI search need switch 7.
17. **Tasks.** Existing list. Editing needs switch 6; everyone can tick steps. "Notify me about updates" on provider-linked tasks.
18. **Assistant.** Existing chat. The Outbox/Inbox panel needs switch 2 and the Send button needs switch 3. Also:
    - first-use notice
    - consent banner
    - provider-update confirm card
    - background jobs
19. **Patient profile.** Identity, Clinical, Contact & insurance (switch 1). Editing needs switch 7. Shows "Patient admin: [Name (Title)]". Patient admin also sees:
    - **AI sharing** (switches, consent capacity, history)
    - **Transfer admin**
    - **Archive patient**
20. **Members.** Everyone sees the list: patient admin at the top with an "Admin" badge, then members with name, title, role and a "Can manage people" badge where set. Everyone gets **Leave** (the admin must transfer first).
    - **Patient admin** also sees:
      - **Requests** (Accept → role/preset/switches sheet; Deny)
      - **Open invites**, **Invite someone**
      - **Join requests**: on/off, share code large, QR, Share, **New code**
      - per person: **Permissions** sheet (role, preset, switches 1-8 with one-line explanations), **Make patient admin**, **Remove**
      - "Joined recently" highlight for 7 days
      - "Pending admin transfer" card (Cancel)
    - **Delegates** see Requests, Open invites, Invite someone, and Permissions/Remove for ordinary members only. They see no switch 8, no share-code control, and no admin actions.
21. **Admin transfer request** (for the chosen person). What it means; **Accept** / **Decline**.
22. **My profile.** Name, title, username, change PIN/password, idle sign-out, My patients (switcher + search), **Notifications** per patient.
23. **Computer admin.** Separate area, labelled "Computer admin: keeps MediTrack running. No access to patient information."
    - **Accounts:** unlock, reset secret, deactivate/reactivate, computer-admin flag; can't remove the last one
    - **Settings:** allow new accounts; assistant, web search and inbox reading on/off; email and connection status; Backup; Restore
    - **Audit log**
    - **Patient-admin recovery** (patient → existing member → reason → Reassign)

---

## 7. Data

Migrations run in order using `PRAGMA user_version`. Existing installs keep their data. Changing `supplies.barcode` uniqueness requires a SQLite table rebuild inside a transaction.

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
  admin_user_id INTEGER NOT NULL REFERENCES users(id),   -- the ONE patient admin
  name TEXT NOT NULL, dob TEXT,
  parent_name TEXT, parent_phone TEXT, parent_email TEXT,
  address TEXT, city TEXT, state TEXT, zip TEXT,
  insurance_name TEXT, insurance_member_id TEXT, medicaid_id TEXT,   -- switch 1 / identity_admin scope
  diagnoses TEXT, equipment TEXT, notes TEXT,                        -- baseline / clinical scope
  share_code TEXT UNIQUE,                    -- join-request code; shown only to the patient admin
  join_requests_enabled INTEGER NOT NULL DEFAULT 0,
  onboarded INTEGER NOT NULL DEFAULT 0,
  archived INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 1,
  created_by INTEGER REFERENCES users(id),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
)  -- invariant: admin_user_id always has an active patient_members row for this patient

patient_members(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id INTEGER NOT NULL REFERENCES patients(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  role TEXT NOT NULL CHECK(role IN ('self','family','nurse','doctor')),   -- 'doctor' reserved
  perm_insurance INTEGER NOT NULL DEFAULT 1,     -- 1 Insurance & account numbers
  perm_inbox INTEGER NOT NULL DEFAULT 1,         -- 2 Email inbox & outbox
  perm_send_email INTEGER NOT NULL DEFAULT 1,    -- 3 Send email (requires perm_inbox)
  perm_assistant INTEGER NOT NULL DEFAULT 1,     -- 4 AI assistant
  perm_edit_supplies INTEGER NOT NULL DEFAULT 1, -- 5 Edit supply list
  perm_manage_tasks INTEGER NOT NULL DEFAULT 1,  -- 6 Manage tasks
  perm_edit_profile INTEGER NOT NULL DEFAULT 1,  -- 7 Edit profile & care team
  perm_manage_people INTEGER NOT NULL DEFAULT 0, -- 8 Manage people (delegate); only the admin sets it
  -- for the patient admin all perm_* are treated as 1 regardless of stored values
  notify_low_stock INTEGER NOT NULL DEFAULT 1,
  notify_assistant INTEGER NOT NULL DEFAULT 1,
  notify_tasks INTEGER NOT NULL DEFAULT 0,
  joined_via TEXT CHECK(joined_via IN ('creator','invite','request','migration')),
  invite_id INTEGER REFERENCES invites(id),
  join_request_id INTEGER REFERENCES join_requests(id),
  added_by INTEGER REFERENCES users(id),
  version INTEGER NOT NULL DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  removed_at DATETIME, removed_by INTEGER REFERENCES users(id)
)  -- partial UNIQUE index on (patient_id, user_id) WHERE removed_at IS NULL

invites(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id INTEGER NOT NULL REFERENCES patients(id),
  code_hash TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL CHECK(role IN ('family','nurse')),
  perms_json TEXT NOT NULL,                    -- switches 1-7 (and 8 only if created by the admin)
  label TEXT,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME NOT NULL,                -- +72h
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','used','cancelled','expired')),
  used_by INTEGER REFERENCES users(id), used_at DATETIME
)

join_requests(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id INTEGER NOT NULL REFERENCES patients(id),
  requester_id INTEGER NOT NULL REFERENCES users(id),
  message TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK(status IN ('pending','accepted','denied','cancelled','expired')),
  block_future INTEGER NOT NULL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME NOT NULL,                -- +14 days
  decided_by INTEGER REFERENCES users(id), decided_at DATETIME
)  -- partial UNIQUE index on (patient_id, requester_id) WHERE status = 'pending'

admin_transfers(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id INTEGER NOT NULL REFERENCES patients(id),
  from_user_id INTEGER REFERENCES users(id),   -- previous admin
  to_user_id INTEGER NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL CHECK(kind IN ('transfer','recovery')),
  started_by INTEGER NOT NULL REFERENCES users(id),  -- admin, or computer admin for recovery
  reason TEXT,                                 -- required for recovery
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','declined','cancelled','expired')),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME NOT NULL,                -- +7 days
  decided_at DATETIME
)  -- at most one pending row per patient

ai_consents(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id INTEGER NOT NULL REFERENCES patients(id),
  scope TEXT NOT NULL CHECK(scope IN ('clinical','identity_admin')),
  granted_by INTEGER NOT NULL REFERENCES users(id),   -- always the patient admin at that time
  granted_as TEXT NOT NULL CHECK(granted_as IN ('patient','representative')),
  granted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  revoked_by INTEGER REFERENCES users(id),
  revoked_at DATETIME
)  -- active = row for patient+scope with revoked_at NULL. Never deleted.

sessions(
  id TEXT PRIMARY KEY,
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
  via_delegate INTEGER NOT NULL DEFAULT 0,
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
Live-sync event buffers are in memory only (no table).

### Changed tables
**users**
- Add: `org_id`, `username TEXT UNIQUE`, `title TEXT`
- Add: `secret_type TEXT CHECK(secret_type IN ('pin','password'))`, `secret_hash TEXT` (`scrypt$<salt>$<hash>`), `must_reset_secret`
- Add: `is_computer_admin INTEGER DEFAULT 0`, `active INTEGER DEFAULT 1`, `idle_minutes INTEGER`
- Add: `failed_attempts`, `locked_until`, `last_login_at`
- The old `role` and `pin_hash` columns are no longer read; the migration clears `pin_hash`.

**supplies**
- Add: `patient_id NOT NULL`, `archived`, `alert_enabled INTEGER NOT NULL DEFAULT 0`, `alert_sent_at DATETIME`, `version INTEGER NOT NULL DEFAULT 1`.
- Barcode becomes `UNIQUE(patient_id, barcode)`.
- `quantity` changes only via movements (M6).

**scan_log**: add `patient_id`, `quantity_before`, `quantity_after`, `reason`; the action CHECK adds `'adjust'`; `user_id` comes from the session.
**providers**: add `patient_id`, `version` (sharing across siblings: Open decision 6).
**tasks**: add `patient_id`, `created_by`, `notify_updates INTEGER NOT NULL DEFAULT 0`, `version`. Each step in `steps` JSON gets a stable `id`.
**outbox**: add `patient_id`, `created_by`, `sent_by`, `version`.
**patient_profile**: replaced by `patients`; dropped after migration.

### Migration from the current version (v0 → v1)
1. Create one `organizations` row ("My household").
2. Create a `patients` row from `patient_profile` if it has a name or `onboarded = 1`, or if any supplies, providers or tasks exist. If there is no name, use "My child".
3. Set `patient_id` on all existing rows; `version = 1`; give task steps ids.
4. Existing users: kept for history, `active = 0`, `pin_hash` cleared.
5. Because `admin_user_id` is NOT NULL, the migrated patient is created **during** first run, not before. Steps 2-3 run right after the first account is created (M4 first run). That account becomes computer admin and the migrated patient's patient admin (`joined_via = 'migration'`, role `family`).
6. Existing supplies are kept, with `alert_enabled = 0`. Show a one-time prompt: "Choose which items should alert you."

### Timestamps
The API returns ISO-8601 UTC; the client shows local time.

---

## 8. Privacy and security

1. **Where data lives:** `server/meditrack.db` on the home computer, plus downloaded backups. Recommend disk encryption (BitLocker / FileVault) and a computer login password.
2. **Who can reach it:** depends on Open decision 1. In every option, every API call and live stream needs a signed-in session, and patient data needs a membership.
3. **One accountable owner per patient:** a single patient admin. Delegation is explicit (switch 8), limited (no escalation, no consent, no admin changes) and audited. Admin changes need the new admin's acceptance. Recovery by the computer admin is limited to existing members, needs a reason, and is audited and visible to members.
4. **Joining is safe by design:**
   - new accounts see nothing
   - patients are never searchable or listed to non-members
   - invites are single-use and announced to the patient admin
   - join requests need a share code the family handed out, which is off by default and can be turned off or replaced
   - requests reveal nothing until accepted
   - sign-up and code entry are rate-limited
   - first run is protected by a setup code shown only on the computer
5. **Per-person permissions** (M3), enforced in the server, with field stripping. Changes take effect immediately, including on live streams. The computer admin has no patient access.
6. **Authentication:** individual accounts; PIN or password, both scrypt-hashed; lockout; idle sign-out; `HttpOnly` + `SameSite=Strict` (+ `Secure`) cookies.
7. **Browser attacks:**
   - no CORS; origin check on state-changing requests
   - no runtime third-party scripts
   - headers: `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY`
   - CSP `'self'` (plus `'unsafe-eval'` while in-browser Babel remains)
8. **In transit:** depends on Open decision 1; Settings shows whether the connection is encrypted.
9. **Live sync:** events carry ids and baseline fields only. Sensitive data is always refetched through permission-checked endpoints.
10. **AI provider:**
    - patient data only with consent recorded by the patient admin (as patient or representative), per patient, revocable, off by default
    - use also needs switch 4
    - the assistant never sends email
    - provider edits need confirmation
    - email content is treated as untrusted
11. **Email (recommendation):** connect MediTrack to a **separate email address used only for care and supply companies**, not a personal inbox. Set this up in the README and first-run tips. The patient admin controls who can read it (switch 2) and send from it (switch 3).
12. **Push notifications:** generic text only (M17).
13. **Audit:** M16, append-only, including every permission change, delegate action, transfer and recovery.
14. **Secrets:** `.env` stays out of git (document that it holds the email app password). VAPID keys live in `app_settings`. The share code is shown only to the patient admin.
15. **Logs:** the server console never prints request bodies, profile data, email contents, invite codes or share codes.
16. **No compliance claims:** do not claim HIPAA compliance anywhere.

### Path to agency/HIPAA (do not build now; don't block it)
If an agency or clinic adopts MediTrack it would likely bring HIPAA obligations. At minimum:
- Hosting with a signed Business Associate Agreement (BAA).
- BAAs with the AI, email, tunnel and push providers that handle patient data, or those features turned off.
- A risk assessment, written policies, staff training and breach-notification procedures.
- Encryption at rest and in transit, encrypted backups, defined retention.
- Unique user IDs, automatic logoff, access control and audit controls. **The MVP already provides these (M2, M3, M16), and per-person switches support "minimum necessary" access.**
- Organization separation: `org_id` is already on users, patients and the audit log.
- Organization admins managing staff; agency-level invites, join requests and delegation.
- 2-step sign-in and internet-grade rate limiting if hosted.
- Consent records (the `ai_consents` pattern) extended to other disclosures.

---

## 9. Visual style

**Keep** the current look: navy/blue header, white cards on light gray, colored category and status badges, teal accent.

**Change, for phone-first use and accessibility:**
1. Bottom navigation on phones and a floating Scan button. Inline SVG icons + labels.
2. Touch targets ≥ 44px on phones. Primary actions at the bottom, within thumb reach.
3. Inputs at 16px on phones.
4. Tables become stacked cards under 640px; tables stay on the computer Overview.
5. Text contrast: replace `--gray-500` with `--gray-700` for text.
6. Status = text + color. Red = out / error, orange = low / needs action, green = OK / done, blue = info.
7. Header patient chip on every patient screen. People always shown as "Name (Title)". The patient admin gets an "Admin" badge; delegates get "Can manage people".
8. Live changes: a brief soft highlight (about 1 s) on a value someone else just changed, plus "by Sam" on tap. No pop-ups for routine updates.
9. Permissions sheet: each switch with a one-line plain explanation. Presets as two large buttons at the top. Switch 8 visually separated, with a short note on what delegates can't do.
10. Large, high-contrast codes and QR codes on the invite and share-code screens.
11. Web app manifest + icon (also required for iPhone notifications).

---

## 10. Open decisions

Plain-language questions for the owner. The spec's current default is shown after each one. The most important come first.

1. **How should phones connect to MediTrack?** MediTrack runs on your home computer. Phones need a secure connection to it for two things: scanning barcodes with the live camera, and getting notifications. Without one, scanning still works by taking a photo of the barcode, live updates still work, but notifications don't. The app works with all four options, so you can start with option 1 and switch later.

   | | 1. Home Wi-Fi only (as today) | 2. Private network app | 3. Security certificate on each phone | 4. Public web address |
   |---|---|---|---|---|
   | Day to day | Works only at home on your Wi-Fi. Scan by taking a photo. No notifications. | Works at home and away. Live scanning and notifications. | Works only at home. Live scanning and notifications. | Works anywhere, like a normal website. Live scanning and notifications. |
   | What gets installed | Nothing. | A free app (e.g. Tailscale) on the home computer and on **every phone** that uses MediTrack, including each nurse's phone. | A security file on the computer and on **every phone**. Several steps in iPhone Settings, repeated for each new nurse's phone. | Nothing on phones. A small program on the home computer. |
   | Cost | Free | Usually free for a family; check the plan's limits if many people need access. | Free, but needs someone comfortable with tech settings. | Roughly $10-20 a year for a web address, or a monthly hosting fee. |
   | Main downside | No notifications; not encrypted on Wi-Fi. | Nurses must agree to install an app; some agencies may not allow it on work phones. | Fiddly, home-only, redone for each new phone. | Reachable from the internet (sign-in still protects it); a company in the middle carries the traffic; stronger sign-in recommended. |

   *Default: option 1 until you decide; option 2 recommended.*

2. **Are these the right permission switches?** For each person, the patient admin can turn these on or off:
   1. insurance & account numbers
   2. reading the care email
   3. sending email
   4. the AI assistant
   5. editing the supply list
   6. managing tasks
   7. editing the profile & care team
   8. managing people (the "delegate" switch)

   Everyone linked can always see supplies, log use, see phone numbers and tick task steps. *Default: 1-7 on for family and nurses, 8 off; one-tap "Hands-on care only" option.* Should a delegate be able to remove family members too, or only nurses and aides? *Default: any ordinary member.*
3. **What should AI permission cover?** *Default: two separate switches, both off at first, set only by the patient admin. "Medical info" covers diagnoses, equipment, notes and the supply list. "Personal & insurance info" covers name, birth date, address, insurance numbers and the care team list.* Is that split right?
4. **How long before the app signs people out when idle?** *Default: family 12 hours, nurses 30 minutes; each person can shorten their own.* Should nurses also get 12 hours?
5. **Resupply schedule** (how many of each item insurance allows per month, next order date): needed for the first family, or later? *Default: later.*
6. **Siblings and providers:** enter a shared pharmacy or supply company once for the household, or separately for each child? *Default: separately.*
7. **Call scripts:** *Default: use the child's name, never "he/she".* Keep, or let families choose pronouns?
8. **Starter supply list:** OK to offer the existing 35 trach / vent / G-tube items with counts at 0 and no alerts on?
9. **Nurses who work for two families:** each family runs its own MediTrack, so the nurse has two separate logins. OK until there's an agency version?
