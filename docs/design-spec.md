# MediTrack Design Spec

## 0. Core design principle (read first)

> **MediTrack must stay very simple.** It is for a tired parent of a medically complex child. Every common task (find a number, send an order, reply to a DME email) must take as few taps as possible. Anything that doesn't serve that goes under Later features.

How the builder applies this:
- **The rule for MVP:** a feature is in the MVP only if it (a) makes a common task faster, or (b) is needed for safety or privacy. Everything else is in section 5 (Later).
- **Defaults instead of settings:** pick the sensible default and don't ask. Every setting screen and every extra choice must earn its place.
- **One obvious button per screen** for the common action, placed in thumb reach. Secondary actions go in a "…" menu.
- **Never cut for simplicity:** sign-in, hashed secrets, server-side permission checks, AI consent, the stock log, backups.

### Target tap counts (from Home, signed in, patient selected)

| Common task | Target taps | Path |
|---|---|---|
| Find a provider's number | **0-1** | Favorites are on Home ("Quick contacts", up to 4). Others: **Care Team** (1) → number is on the card (search box at top if the list is long). |
| Call a provider | **1-2** (+ the phone's own call confirm) | Home quick contact **Call** (1). Others: **Care Team** (1) → **Call** (2). |
| Send a doctor's order (already in the app) to a DME company | **4** | **Care Team** (1) → DME card **Send order** (2) → draft opens with the latest order attached → **Send** (3) → confirm (4). |
| Scan a new order and send it | **≤ 7** | Home **Scan document** (1) → shutter per page (2) → **Done** (3) → **Save** (purpose "Order", date today prefilled) (4) → **Send to [last DME used]** (5) → **Send** (6) → confirm (7). |
| Reply to a DME email | **3-4** | Notification "a reply arrived", or the Home "Waiting on you" card (1) → **Draft reply** (assistant) or **Reply** (blank) (2) → **Send** (3) → confirm (4). |
| Approve an assistant draft | **3** | Home "Waiting on you" draft (1) → **Send** (2) → confirm (3). |
| Log supply use | **2** | **Supplies** (1) → **−1** quick button on the item card (2). Or by barcode: Home **Scan** (1) → camera finds code → **Used** (2). In photo mode (no secure connection) add 1-2 taps for the phone's camera. |
| Restock | **2** | Same as logging use, with **+** (enter amount) or **Restocked**. |
| Check stock | **0-1** | "Running low" is on Home (0). Full list: **Supplies** (1). |

Every Used/Restocked tap saves immediately and shows a 5-second **Undo** toast, instead of a confirm dialog. Sending email always has one confirm, because it can't be undone.

---

Status: revision 5. It applies the simplicity principle and adds **Documents**.

Owner decisions kept from earlier rounds:
- phone-first design
- PIN or password
- per-patient AI consent
- no doctor login yet
- several patients per user
- self-created accounts
- one patient admin per patient
- nurses get the same access as family by default
- push notifications for low stock and assistant updates
- live updates across screens

Remaining questions are at the end.
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
| Setup wizard (first run only) | 3 steps: family info (child, DOB, parent contact, address, insurance/Medicaid IDs, diagnoses, equipment) → add care team (manual form or NPI registry search) → done. |
| Care Team (default) | Provider cards: phone/fax/email/account #, department directory, tips, notes, favorite, tap-to-call, copy, "Show what to say" scripts, "Ask assistant", edit, delete. Search + type filter. NPI registry search. |
| Assistant | Claude chat with tools: search/save providers, NPI lookup, create/update tasks, draft emails, read inbox, read supply levels, call tips, web search. Side panel: Outbox (edit, Send via SMTP or "Open in my email app", copy, discard) and Inbox. Never sends email itself. Conversation lost when leaving the tab. |
| Tasks | Checklists with status, provider, due date, steps. |
| Dashboard | Counts, low-stock table, category chips, last 10 scans. |
| Supplies | Inventory table, search, filters, inline quantity edit, add/edit modal, delete. |
| Scan | Camera barcode scan (Quagga) or manual code → log add / remove / check, with a free "Logged by" dropdown. |
| Portal | Read-only supply table; every other tab still reachable. |
| Activity | Last 200 scan log entries. |
| Users | List, add, remove. |

**Data today**: `users`, `supplies`, `scan_log`, `patient_profile`, `providers`, `tasks`, `outbox`. First start seeds 5 demo users (plain-text PINs) and 35 demo supplies. There is no place to store documents. Email has no attachments.

**Roles today**: labels only. No login, no permission checks. Screens never refresh on their own.

---

## 2. Target users and devices

**Phone-first.** Daily work happens on phones. The computer is for the Overview ("portal"), printing reports and keeping the install running.

**Two kinds of admin. They are separate; never call either just "admin" in the UI:**
- **Patient admin**: the **one** person who owns a patient's account. Whoever creates the patient profile becomes its patient admin automatically: the patient themselves, or a parent creating it for a child. A nurse can be patient admin if they created the profile. The patient admin:
  - invites and removes people, and sets each person's access level
  - gives or withdraws AI consent, acting as the patient or the patient's representative
- **Computer admin**: the person who set up MediTrack on the home computer. Handles settings, backup/restore, unlocking accounts, and reassigning a patient admin if one is gone. Has **no** access to patient information as computer admin.

| User | Needs |
|---|---|
| **Family caregiver** (title e.g. Mom, Dad) | Numbers fast, orders sent fast, DME emails answered fast, know what's low. |
| **Nurse / home health aide** | Same as family by default ("Full access"); the patient admin can lower it to "Care only". |
| **Patient (adult or older child)** | Can create their own profile and be their own patient admin. |
| **Doctor** | No login yet; gets a printable usage report or documents by email. |
| **Computer admin** | Settings, backup, unlock, reassign patient admin. |

---

## 3. Gaps and problems

### 3a. Security (blocking for real use)
1. **No login**; anyone on the Wi-Fi sees and changes everything and can send email as the parent.
2. **Roles not enforced** on any API endpoint.
3. **Open CORS** (`app.use(cors())`): any web page on the network can read health data and trigger sending.
4. **Plain-text PINs** in `pin_hash`, known seeded PINs, never checked.
5. **Anyone can log as anyone** ("Logged by" dropdown).
6. **Plain HTTP**: unencrypted on Wi-Fi; no live camera or push notifications on phones.
7. **CDN scripts**, unpinned, no SRI.
8. **AI data sharing is implicit**; no consent.
9. Server trusts client-sent chat history.
10. `.env` holds the email app password in plain text (document it).

### 3b. Broken or buggy
1. Deleting a supply/user with history fails with a 500 while the UI says "deleted": the `api` helper never checks `r.ok`.
2. Inline quantity edits bypass the log and overwrite the number; concurrent changes are lost.
3. No live updates.
4. Timestamps parsed as local time though stored as UTC.
5. Profile can't be edited after setup; tasks can't be edited after creation; step ticks overwrite the whole list.
6. Categories hard-coded in the client.
7. Call scripts say "my son" / "his".
8. Demo data seeded into real installs.

### 3c. Confusing / missing
1. 9 tabs on a scrolling bar; overlapping Dashboard / Portal / Activity.
2. Small buttons; letter "icons"; static header text.
3. Assistant edits providers without confirming.
4. No backup.
5. **No way to keep or send doctor's orders**, the most common thing a DME company asks for.

---

## 4. MVP feature list

Build in this order. Every item passes the section 0 rule: it either speeds up a common task or is needed for safety/privacy.

**M1. Data foundation and migrations**
- `PRAGMA user_version` + numbered migrations (section 7).
- New tables: `organizations`, `patients`, `patient_members`, `invites`, `ai_consents`, `documents`, `document_files`, `outbox_attachments`, `sessions`, `audit_log`, `app_settings`, `push_subscriptions`.
- `patient_id` (and `version` where noted) on existing tables.
- No seeded users or supplies on fresh installs.
- The `organizations` table is invisible in the UI. It exists only so an agency version later doesn't need a rebuild.

**M2. Accounts and sign-in** (safety)
- Anyone who can reach MediTrack can create an account: name, **title** (display only: Mom, Dad, Nurse, Home health aide, Patient, Other), username, and a **6-digit PIN or a password** (min 10 characters).
- Secrets: scrypt-hashed with a per-user salt; never returned by the API.
- Lockout: 5 failures → 15 min. Sign-up limited to 5 accounts per IP per hour. Computer-admin switch "Allow new accounts" (default on).
- A new account with no patient links sees **no patient data**.
- Session cookie: `HttpOnly`, `SameSite=Strict`, `Secure` on HTTPS.
- **One idle sign-out time for everyone: 12 hours.** No per-user setting.
- Forgotten secret: the computer admin sets a temporary PIN, which must be changed at next sign-in.
- Accounts are deactivated, never deleted.

**M3. Permissions: one patient admin, two access levels, one email switch** (safety/privacy)
- `patients.admin_user_id` holds the **one** patient admin, set to whoever created the patient.
- Every other linked person has an **access level** and an **Email** switch.

| | Care only | Full access (default for family, nurse, self) | Patient admin |
|---|---|---|---|
| Patient name, DOB, clinical info (diagnoses, equipment, care notes) | view | view + edit | view + edit |
| Supplies: view, log Used / Restocked / Counted | yes | yes | yes |
| Supplies: add/edit/archive items, thresholds, low-stock alerts | no | yes | yes |
| Care team: names, phone/fax/departments, call scripts, Call | yes | yes | yes |
| Care team: account #s, notes; add/edit/delete; NPI search | no | yes | yes |
| Insurance/Medicaid IDs, address, parent contact | no | yes | yes |
| Tasks: view, tick steps | yes | yes | yes |
| Tasks: create/edit/delete | no | yes | yes |
| **Documents**: view, scan/upload, tag, delete (recoverable) | no | yes | yes |
| AI assistant (within the patient's AI consent) | no | yes | yes |
| **Email switch** (default on): inbox, outbox, send email, send documents | no | if switch on | yes |
| Usage report | yes (no insurance) | yes | yes |
| Invite people, remove people, set access level and Email switch | no | no | yes |
| AI consent; permanently delete a document; archive patient | no | no | yes |

- Turning the Email switch off is how a family keeps a nurse out of the care inbox.
- **Recommended setup (not a question):** connect MediTrack to a **separate email address used only for care and supply companies**, not a personal inbox. README and first-run tips say so.
- Enforcement:
  - patient-scoped endpoints live under `/api/patients/:pid/...`, and middleware checks membership, level, Email switch or patient admin on **every** call
  - restricted fields are **removed on the server**
  - assistant tools follow the same rules
- Remove `cors()`. Add an origin check on state-changing requests.
- Errors: 401 when not signed in, 403 when not allowed, 404 for patients the caller isn't linked to.
- The computer admin is a separate user flag with no patient access by itself.

**M4. Invites, removing people, recovery, first run**
- **Invites are the only way in** (MVP). The patient admin: **Members → Invite** → picks Full access or Care only, Email on/off → gets a code (8 characters, e.g. `K7QM-4ZPX`), a link and a QR code → **Share** (phone share sheet).
  - single-use; expires in 72 h; stored hashed
  - the invitee opens the link → creates an account or signs in → **Accept** → in
  - the patient admin gets a push "someone joined using your invite", and the newcomer shows at the top of Members with **Remove** for 7 days
- **Removing:** the patient admin taps a person → **Remove**. Anyone can **Leave**, except the patient admin.
  - takes effect immediately, including on live screens (M7)
  - the computer admin can deactivate an account entirely
- **Reassign patient admin** (handover or recovery): done by the computer admin in Computer admin › **Patient admin**.
  - choose an existing member of that patient, type a reason, **Reassign**
  - takes effect immediately, is audited, and both people are notified
  - the computer admin can't make themselves patient admin unless they are already a member
  - in a household the computer admin is usually the parent, so this one tool covers both "hand over" and "admin is gone"
- **First run:**
  1. The server prints a one-time **setup code** in the MediTrack window. The Welcome screen asks for it, so nobody else on the Wi-Fi can claim the install.
  2. Create account → this user becomes **computer admin**.
  3. Add-patient wizard (M9) → they become **patient admin**.
- Upgrades use the same flow (section 7).

**M5. Patient switcher**
- The current patient is in the client URL (e.g. `#/p/12/supplies`).
- A patient chip is always in the header and on the Scan sheets. Tap it → list of the user's patients → switch.
- After sign-in: 0 patients → "No patients yet" (Enter invite code / Create a patient profile); 1 → Home; several → last used.

**M6. Stock log** (safety)
- Quantities change **only** through movements: `POST .../supplies/:id/movements {action: add|remove|check|adjust, amount, reason?}`.
- `add` / `remove` are **+/- changes** applied in SQL (`quantity = MAX(0, quantity ± n)`), so simultaneous logs never overwrite each other.
- `check` / `adjust` ("Set exact count") record before/after; a count wins over a simultaneous change, and both are logged.
- Every movement is written to `scan_log` with the signed-in user, patient, action, amount, before/after.
- `PUT` on a supply no longer accepts `quantity`.
- The "Logged by" dropdown is removed. Supplies are archived, not deleted.

**M7. Live updates** (owner requirement: stock changes show on every screen at once)
- **Server-Sent Events:** `GET /api/patients/:pid/events` for the patient on screen; `GET /api/me/events` for membership changes. In-memory publish/subscribe (single Node process).
- Events carry only type, id and baseline-visible fields:
  - `supply.changed` carries quantity and low flag
  - other events tell the client what to refetch: `task.changed`, `document.changed` (Full access only), `outbox.changed` (Email switch only), `profile.changed`, `providers.changed`, `consent.changed`, `members.changed`, `access.changed` (affected person only)
- Sensitive data is always refetched through permission-checked endpoints.
- Heartbeat every 25 s. Removing a person or changing their access closes their stream.
- **Reconnect:** `EventSource` reconnects automatically. On reconnect, and whenever the app returns to the foreground, the client simply **refetches the current screen**.
  - header dot: green "Live", gray "Reconnecting…"
  - while disconnected, saving shows "Not connected, try again in a moment"
- **Simultaneous edits** of anything other than quantities: records carry a `version`.
  - if someone else saved first, the server answers 409
  - the app reloads the record and shows "Sam (Night nurse) just changed this. Your screen is updated. Please make your change again."
  - nothing is silently overwritten; no side-by-side merge screen
  - task steps have stable ids and are ticked individually (`PATCH /tasks/:id/steps/:stepId`), so step ticks never collide
- Values changed by someone else get a brief soft highlight.

**M8. Bug fixes from 3b**
- The API helper shows server errors.
- UTC timestamps in ISO-8601, shown in local time.
- Editable profile and tasks.
- Categories from the server.
- Call scripts use the child's name, no pronouns.

**M9. Adding a patient**
- Any signed-in user can create a patient profile and becomes its patient admin.
- Wizard, 4 steps:
  1. **For me / for someone I care for** + patient info
  2. Care team (manual or "Find near me")
  3. Supplies: starter list (35 items, quantities 0) or empty, plus "Which items should alert you when low?" (none ticked)
  4. Done
- AI sharing and invites are set later from their screens. They aren't wizard steps, to keep setup short.

**M10. Works with any connection; scanning on phones**
- The build does not depend on Open decision 1. `.env` chooses one of:
  - plain HTTP (default)
  - HTTPS with certificate files (`HTTPS_CERT`, `HTTPS_KEY`)
  - behind a private-network app or tunnel (`TRUST_PROXY=1`)
- **Barcode scanning:**
  - secure connection: live camera
  - otherwise: **"Take photo of barcode"** (`<input type="file" accept="image/*" capture="environment">` + Quagga single-image decode) and manual entry
- Live updates work on every option. Push notifications need a secure connection.
- Settings shows "Connection: secure" / "Connection: home Wi-Fi only, not encrypted".

**M11. Documents** (new; the "send an order" task depends on it)
*Capture*
- **Scan with the phone camera:** Documents → **Scan** (also a **Scan document** button on Home) → the phone camera opens via `<input type="file" accept="image/*" capture="environment">`.
  - after each photo: a thumbnail strip with **Add page** / **Done**; pages can be deleted or reordered by dragging
  - **This works on plain home Wi-Fi.** Photo capture through a file input doesn't need HTTPS, unlike live barcode scanning.
- **Cleanup on the phone** (canvas, no extra library; works on any connection):
  - auto-rotate from EXIF
  - downscale to max 2000 px on the long edge
  - "document look" (grayscale + contrast boost; on by default, toggle per page)
  - JPEG quality 0.8
- **Auto-crop** (edge detection) is **Later**: it needs a large image library, and live edge guides need the live camera, which requires HTTPS. **Tip shown in the app:** iPhone (Files or Notes app, "Scan Documents") and Android (Google Drive "Scan") already make cropped PDFs; use them, then **Upload**.
- **Upload:** **Upload file** accepts PDF, JPEG, PNG (HEIC is converted on the phone when the browser can decode it; otherwise "Please upload as JPEG or PDF").
- **One PDF per document:** the server combines pages into a single PDF with `pdf-lib` (pure JS dependency). Uploaded PDFs are stored as they are; uploaded images become a 1-page PDF.
- Limits: 20 MB per document, 30 pages per scan. File type checked by content (magic bytes), not by name.

*Tag* (one short form after capture; everything prefilled so **Save** is usually one tap)
- **Purpose:** Order / prescription (default), Letter of medical necessity, Insurance approval, Other.
- **Doctor:** pick from Care Team (doctor/specialist types; the last one used is preselected; optional).
- **Date:** today by default.
- **Title:** optional (e.g. "Suction catheters 8Fr, 6 months").
- **Renew by:** optional date. If set, the document shows an "Expires soon" badge within 30 days. Reminder notifications are Later.

*Find*
- Documents screen: newest first. Filter chips for purpose; a doctor dropdown. Each row: purpose badge, title or "Order from Dr X", date, page count, expiry badge.
- Tap → full-screen PDF view (browser viewer), with **Send to…**, **Edit tags**, **Download**, **Delete** in a "…" menu.

*Send* (needs Full access + Email switch)
- **From the Care Team card:** DME and pharmacy cards with an email get a **Send order** button. It creates an Outbox draft and opens it:
  - To: the provider's email
  - Subject: "Order for [child's name], [date]"
  - Short body (with the account number when the sender has Full access)
  - Attached: **the newest non-deleted document with purpose "Order"**. The draft shows the attachment with **Change** (pick other or additional documents).
- **From a document:** **Send to…** → provider list (DME/pharmacy first, last used on top) → the same draft.
- Review → **Send** → confirm.
- If SMTP isn't set up: the draft shows **Download attachment** + **Open in my email app** with a one-line note "Attach the downloaded file". A mailto link can't carry attachments.
- Attachment total max 20 MB per email.
- **Fax-ready:** every Outbox item has a `channel` (`email` now; `fax` reserved) and a `to_fax`. The send endpoint dispatches by channel. When a fax provider is added later, the draft gets a "Send by: Email / Fax" choice. Nothing else changes.

*Assistant*
- `draft_email` accepts `document_ids`. New tool `list_documents` returns **metadata only** (id, purpose, doctor, date, title, expiry).
- Both need the patient's **clinical** AI consent, because document titles and purposes are medical information. Without it the assistant says "Documents aren't shared with the assistant for this patient; attach it in the draft yourself."
- The assistant never reads document contents in MVP (Later, under the same consent).
- Drafts with attachments still need a human **Send**.

*Delete and storage*
- **Delete** (Full access) moves a document to **Recently deleted** for 30 days, where it can be restored. After 30 days it is purged automatically (daily job).
- The patient admin can **Delete permanently now** (e.g. a document saved to the wrong patient).
- Sent emails keep the attachment's filename in their history even after the document is purged.
- **Files are stored inside the SQLite database** in a separate table (`document_files`, BLOB), not as loose files:
  - backups and restore stay a single file and automatically include documents
  - files can only be read through permission-checked endpoints (never from the static folder)
  - deleting is transactional
- Settings shows storage used, and warns above 2 GB.
- Download responses send `Content-Disposition`, `Cache-Control: no-store` and a generated filename (no patient name in the URL).

*Audit*
- Document uploaded, viewed/downloaded, tags edited, attached to a draft, sent, deleted, restored, permanently deleted, purged.

**M12. AI assistant: consent, attachments, background updates**
Consent (privacy):
- Patient data goes to the AI only with consent **recorded by the patient admin**, acting as the patient or the patient's representative. Off by default, per patient, revocable.
- Two scopes:
  - `clinical`: diagnoses, equipment, notes, supply list and levels, document metadata
  - `identity_admin`: name, DOB, address, insurance IDs, care team details and account numbers
- Without a scope, the server leaves that data out of the prompt and the matching tools refuse. Drafts then use `[placeholders]`.
- Revoking takes effect on the next request.
- Grants and revokes are stored in `ai_consents` (who, capacity `patient`/`representative`, when).
- One-time notice per user that what they type is sent to the AI provider.

Tools and safety:
- Tools follow M3 (Full access; inbox and draft tools need the Email switch).
- `save_provider` on an existing provider shows a confirm card.
- The server keeps the conversation; the client sends only new text.
- Computer-admin settings: assistant on/off, web search on/off, inbox reading on/off.

Background updates:
- Chat requests run as server-side jobs. If the user has left when a job finishes, send an "assistant has an update" push.
- Results are kept in memory for up to 24 h, never written to disk.

DME replies:
- Any open task linked to a provider is a "tracked issue" (no extra switch).
- When IMAP is set up, the server checks the inbox every 15 min. A new email from that provider's email address or domain:
  - shows on Home under "Waiting on you" with **Draft reply** / **Reply**
  - sends a push
- The AI is never run on incoming mail by itself.
- Inbox items also get a plain **Reply** button (creates a "Re:" draft to the sender) for people not using the assistant.

**M13. Local front-end libraries**: React (production), ReactDOM, Babel standalone and Quagga served from `client/vendor/`, pinned. No CDNs.

**M14. Phone-first navigation, Home quick actions, computer Overview** (section 6)

**M15. Printable usage report** (owner: the way to share with doctors for now)
- One screen: date range (default 3 months) → per item: used, restocked, average per month, current qty.
- Print / Save as PDF.
- Insurance info only for Full access.

**M16. Backup and restore** (computer admin): "Download backup" (SQLite online backup; includes documents; health-information warning); "Restore" with confirm; README upgrade guide.

**M17. Audit log, written** (privacy)
- Append-only `audit_log` written from M2 onward:
  - sign-ins and lockouts
  - patient created; invites, joins, removals, access changes, admin reassignments (with reason)
  - profile edited; AI consent
  - provider changes (marked if done via the assistant)
  - documents (M11)
  - email sent, report generated, backup/restore
- **No viewer screen in MVP.** The computer admin can export it as CSV from Settings when needed. Viewer: Later.

**M18. Push notifications** (owner requirement; needs a secure connection; on iPhone the app must be on the Home Screen)
- **Low stock, chosen items only:** each item has **Alert when low** (off by default) and its threshold.
  - settings are per patient and shared by everyone; Full access can change them
  - one push per drop below the threshold
- **Assistant updates on DME issues:** answer ready; draft needs approval; reply arrived (tracked issues).
- **Membership:** "someone joined using your invite" (patient admin); "you've been given access" (newcomer).
- **Text is always generic**, with no health details, item, provider or patient names: "MediTrack: a supply is running low." / "MediTrack: the assistant has an update." / "MediTrack: a reply arrived about one of your issues."
- Tapping opens the right screen and patient.
- **Settings:** My profile → per patient, two switches: **Low stock** and **Assistant updates**. Both on by default.
- Pushes only go out while the home computer and MediTrack are running; the UI says so.

New server dependencies: `multer` (uploads), `pdf-lib` (PDF assembly), `web-push` (notifications).

---

## 5. Later features (not MVP)

### Moved out of the MVP in revision 5 (simplicity principle)
| Item | Why it moved | MVP replacement |
|---|---|---|
| 8 individual permission switches | Too many decisions when adding a nurse; the owner's real need was "same as family" plus "keep someone out of the inbox". | Two levels (Full access / Care only) + Email switch. The data model can grow into switches later. |
| Delegated "manage people" | Rarely needed in one household; adds rules and screens. | Only the patient admin manages people. |
| Join requests with a share code | Two ways in means more screens and a code to manage. Invites do the same job in fewer steps. | Invites only (Open decision 2). |
| Self-service admin handover (send/accept) | One computer-admin tool covers both handover and recovery. | Computer admin › Reassign patient admin. |
| "Keep mine / use theirs" conflict screen | A decision screen for a rare event. | Reload + "please make your change again". |
| Event replay after reconnect | More moving parts for no visible difference. | Refetch the current screen on reconnect. |
| Audit log viewer | Not a common task; the log itself is kept. | CSV export by the computer admin. |
| "Tasks due" notifications, request/transfer notifications, per-event notification settings | Not in the owner's list; more settings. | Two switches: Low stock, Assistant updates. |
| Per-user / per-role idle sign-out | A setting nobody needs daily. | 12 hours for everyone (Open decision 6). |
| Patient search | A household has few patients. | Simple list in the switcher. |
| AI sharing and invites as wizard steps | Make setup longer. | Set from their own screens. |
| "Notify me" switch on each task | Extra choice. | Every open task linked to a provider is tracked automatically. |

### Other later features
- **Documents:** auto-crop / edge detection; live camera document view (needs HTTPS); the assistant reading document contents (same clinical consent); renewal reminder notifications; text search inside documents.
- **Fax sending** through an online fax service (the Outbox `channel` is already in place).
- Doctor login (reserved `doctor` role).
- Agency/clinic version: several households, organization admins, staff directories, 2-step sign-in, hosting (section 8).
- Email-based "forgot my PIN/password".
- Resupply schedule per item (Open decision 5).
- Expiration dates / lot numbers on supplies; go-bag checklist; storage location.
- One-tap "reorder all low items" email per DME.
- Task assignment; shift-handoff notes.
- Offline mode with queued changes.
- Persisted assistant conversations (opt-in).
- Pre-compiled client bundle.
- Encryption at rest and encrypted backups.

---

## 6. Screens

### Navigation
- **Phone (primary):** bottom bar **Home · Supplies · Care Team · Documents · Assistant**, icon + label, items ≥ 48px tall.
  - Care only sees **Home · Supplies · Care Team**.
  - Tasks open from Home ("Issues & tasks") and the menu.
- **Computer:** same items in the existing top tab bar, plus **Overview**.
- Header: patient chip (tap → switcher), live dot, menu: **My profile**, **Patient profile**, **Members**, **Tasks**, **Usage report**, **Computer admin** (computer admin only), **Sign out**.
- Removed as tabs:
  - Dashboard → Home
  - Scan → Home/Supplies button
  - Portal → Overview; `?view=portal` redirects there
  - Activity → Supplies › History
  - Users → Computer admin

### Screen list
1. **Welcome / first run**: setup code → Create account.
2. **Sign in**: username → PIN keypad or password. **Create account**, **I have an invite** links.
3. **Create account**: name, title, username, PIN or password.
4. **No patients yet**: **Enter invite code**, **Create a patient profile**.
5. **Join with invite**: who invited you, the patient's first name, access level → **Accept**.
6. **Home (phone)**, top to bottom:
   - **Quick contacts:** up to 4 favorite providers, each with **Call** and, for DME/pharmacy with email, **Send order**
   - **Waiting on you:** new DME replies (**Draft reply** / **Reply**), drafts to approve (**Send**)
   - **Running low:** cards with **−1 / +** and **Restocked**
   - **Issues & tasks:** next 3 open tasks; "See all" → Tasks
   - Two big buttons: **Scan supply** · **Scan document**
   - Care only sees Quick contacts (Call only), Running low, Issues & tasks (tick only) and **Scan supply**.
7. **Overview (computer portal)**: the Home blocks side by side with full tables. With several patients, an "All my patients" table (low items, replies waiting). Live.
8. **Supplies**: search, category filter, low-only toggle. Cards with name, live qty, status, bell if alerting, and **−1 / +** quick buttons. Tap → Supply detail. "+ Add supply" (Full).
9. **Scan supply sheet**: patient name; live camera or photo or manual code → found: **Used** / **Restocked** (amount stepper, default 1), saves on tap with Undo → not found: "Add new supply with this barcode" (Full).
10. **Supply detail**: qty, **Set exact count**, history; Full: **Alert when low** + threshold, Edit, Archive.
11. **Supplies › History**: log by item/person ("Name (Title)").
12. **Care Team**: existing cards, favorites first, search. Card actions: **Call**, **Send order** (DME/pharmacy with email; Full + Email), "…" (Show what to say, Ask assistant, Edit, Delete). Care only: no account #s/notes/edit.
13. **Documents** (Full): filter chips (All · Orders · LMN · Insurance · Other), doctor dropdown, newest first, expiry badges. Big **Scan** and **Upload** buttons. "…" → Recently deleted.
14. **Scan document flow**: camera → thumbnail strip (**Add page** / **Done**; drag to reorder; tap to delete; "document look" toggle) → **Tag** form (purpose, doctor, date, optional title, optional renew-by) → **Save** → result screen with **Send to [last DME]** and **Done**.
15. **Document view**: PDF full screen; **Send to…**; "…" Edit tags, Download, Delete (patient admin also: Delete permanently).
16. **Draft (Outbox item)**: To, Subject, Body, **Attachments** (chips with ✕ and **Add document**), **Send** (confirm). Without SMTP: **Download attachment** + **Open in my email app**.
17. **Assistant** (Full): existing chat, plus the Outbox/Inbox panel (Email switch).
    - Inbox items: **Reply**, **Ask assistant about this**.
    - Consent banner when data isn't shared.
    - Provider-update confirm card.
18. **Tasks**: existing list + edit (Full); tick steps (all).
19. **Patient profile**: identity, clinical, contact & insurance (Full); "Patient admin: Name (Title)". Patient admin: **AI sharing** (two switches + "I am the patient / the patient's representative" + history), **Archive patient**.
20. **Members**: list (admin badge, title, access level, Email on/off). Patient admin: **Invite** (level, Email → code/QR/Share), tap a person → change level / Email switch / **Remove**. Others: **Leave**.
21. **Usage report**: date range → Print / Save as PDF.
22. **My profile**: name, title, change PIN/password, my patients, notifications (Low stock, Assistant updates per patient).
23. **Computer admin** (labelled "Keeps MediTrack running. No access to patient information."):
    - Accounts: unlock, reset secret, deactivate
    - Settings: allow new accounts; assistant, web search, inbox reading; email and connection status; storage used; Backup; Restore; Export audit log (CSV)
    - **Patient admin**: reassign, with a reason

---

## 7. Data

Migrations use `PRAGMA user_version`. Existing installs keep their data. Changing `supplies.barcode` uniqueness needs a table rebuild inside a transaction.

### New tables
```
organizations(id INTEGER PK, name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'household' CHECK(type IN ('household','agency','clinic')),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP)        -- MVP: one row, no UI

patients(                                               -- replaces patient_profile
  id INTEGER PK, org_id INTEGER NOT NULL REFERENCES organizations(id),
  admin_user_id INTEGER NOT NULL REFERENCES users(id),  -- the ONE patient admin
  name TEXT NOT NULL, dob TEXT,
  parent_name TEXT, parent_phone TEXT, parent_email TEXT,
  address TEXT, city TEXT, state TEXT, zip TEXT,
  insurance_name TEXT, insurance_member_id TEXT, medicaid_id TEXT,   -- Full access; identity_admin scope
  diagnoses TEXT, equipment TEXT, notes TEXT,                        -- clinical scope
  onboarded INTEGER NOT NULL DEFAULT 0, archived INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 1, created_by INTEGER REFERENCES users(id),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP)

patient_members(
  id INTEGER PK, patient_id INTEGER NOT NULL REFERENCES patients(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  role TEXT NOT NULL CHECK(role IN ('self','family','nurse','doctor')),   -- label; 'doctor' reserved
  access_level TEXT NOT NULL DEFAULT 'full' CHECK(access_level IN ('full','care')),
  email_access INTEGER NOT NULL DEFAULT 1,       -- the Email switch (only meaningful for 'full')
  notify_low_stock INTEGER NOT NULL DEFAULT 1,
  notify_assistant INTEGER NOT NULL DEFAULT 1,
  joined_via TEXT CHECK(joined_via IN ('creator','invite','migration','reassign')),
  invite_id INTEGER REFERENCES invites(id), added_by INTEGER REFERENCES users(id),
  version INTEGER NOT NULL DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  removed_at DATETIME, removed_by INTEGER REFERENCES users(id))
  -- partial UNIQUE (patient_id, user_id) WHERE removed_at IS NULL
  -- the patient admin always has an active row and is treated as full + email regardless of stored values

invites(
  id INTEGER PK, patient_id INTEGER NOT NULL REFERENCES patients(id),
  code_hash TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL CHECK(role IN ('family','nurse')),
  access_level TEXT NOT NULL CHECK(access_level IN ('full','care')),
  email_access INTEGER NOT NULL DEFAULT 1,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP, expires_at DATETIME NOT NULL,   -- +72h
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','used','cancelled','expired')),
  used_by INTEGER REFERENCES users(id), used_at DATETIME)

documents(
  id INTEGER PK, patient_id INTEGER NOT NULL REFERENCES patients(id),
  purpose TEXT NOT NULL DEFAULT 'order' CHECK(purpose IN ('order','lmn','insurance_approval','other')),
  provider_id INTEGER REFERENCES providers(id) ON DELETE SET NULL,   -- the doctor
  doc_date TEXT NOT NULL,                       -- YYYY-MM-DD, default today
  title TEXT, renew_by TEXT,                    -- optional
  pages INTEGER, size_bytes INTEGER NOT NULL, sha256 TEXT NOT NULL,
  original_filename TEXT,                       -- shown only in the app; never in URLs
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  deleted_at DATETIME, deleted_by INTEGER REFERENCES users(id),   -- Recently deleted
  version INTEGER NOT NULL DEFAULT 1)
  -- index (patient_id, deleted_at, doc_date DESC)

document_files(
  document_id INTEGER PRIMARY KEY REFERENCES documents(id) ON DELETE CASCADE,
  pdf BLOB NOT NULL,                            -- always a PDF, max 20 MB
  thumb BLOB)                                   -- small JPEG of page 1 when scanned in-app

outbox_attachments(
  id INTEGER PK, outbox_id INTEGER NOT NULL REFERENCES outbox(id) ON DELETE CASCADE,
  document_id INTEGER REFERENCES documents(id) ON DELETE SET NULL,
  filename TEXT NOT NULL)                       -- kept after the document is purged

ai_consents(
  id INTEGER PK, patient_id INTEGER NOT NULL REFERENCES patients(id),
  scope TEXT NOT NULL CHECK(scope IN ('clinical','identity_admin')),
  granted_by INTEGER NOT NULL REFERENCES users(id),
  granted_as TEXT NOT NULL CHECK(granted_as IN ('patient','representative')),
  granted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  revoked_by INTEGER REFERENCES users(id), revoked_at DATETIME)   -- never deleted

sessions(id TEXT PK, user_id INTEGER NOT NULL REFERENCES users(id),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP, last_seen_at DATETIME, expires_at DATETIME NOT NULL)

audit_log(id INTEGER PK, org_id INTEGER, patient_id INTEGER, user_id INTEGER,
  action TEXT NOT NULL, entity TEXT, entity_id INTEGER,
  summary TEXT,                                 -- short; no diagnoses, IDs or document titles
  via_assistant INTEGER NOT NULL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP)  -- append-only

app_settings(key TEXT PRIMARY KEY, value TEXT NOT NULL)
  -- allow_signups, assistant_enabled, assistant_web_search, inbox_reading_enabled,
  -- inbox_last_uid, vapid_public_key, vapid_private_key

push_subscriptions(id INTEGER PK, user_id INTEGER NOT NULL REFERENCES users(id),
  endpoint TEXT NOT NULL UNIQUE, keys_json TEXT NOT NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)
```

### Changed tables
- **users**: add `org_id`, `username UNIQUE`, `title`, `secret_type ('pin'|'password')`, `secret_hash` (`scrypt$salt$hash`), `must_reset_secret`, `is_computer_admin`, `active`, `failed_attempts`, `locked_until`, `last_login_at`. Old `role` and `pin_hash` are no longer read; `pin_hash` is cleared.
- **supplies**: add `patient_id NOT NULL`, `archived`, `alert_enabled DEFAULT 0`, `alert_sent_at`, `version`. Barcode `UNIQUE(patient_id, barcode)`. Quantity changes only via movements.
- **scan_log**: add `patient_id`, `quantity_before`, `quantity_after`, `reason`; action adds `'adjust'`; `user_id` from session.
- **providers**: add `patient_id`, `version`.
- **tasks**: add `patient_id`, `created_by`, `version`; steps get stable `id`s.
- **outbox**: add `patient_id`, `created_by`, `sent_by`, `version`, `channel TEXT NOT NULL DEFAULT 'email' CHECK(channel IN ('email','fax'))`, `to_fax TEXT`.
- **patient_profile**: replaced by `patients`; dropped after migration.

### Migration v0 → v1
1. Create the `organizations` row.
2. Existing users: kept for history, `active = 0`, `pin_hash` cleared.
3. First run (setup code) creates the first account (computer admin).
4. **Then**, in the same step: if `patient_profile` has a name or `onboarded = 1`, or any supplies/providers/tasks exist, create a `patients` row from it ("My child" if unnamed). `admin_user_id` = the new account; the member row is `joined_via = 'migration'`, role `family`, `full`.
5. Set `patient_id` and `version = 1` on all existing rows; give task steps ids; supplies get `alert_enabled = 0`.
6. One-time prompt: "Choose which items should alert you when low."

### Timestamps
ISO-8601 UTC in the API; local time in the client.

---

## 8. Privacy and security

1. **Where data lives:** `server/meditrack.db` on the home computer (including documents), plus downloaded backups. Recommend disk encryption (BitLocker / FileVault) and a computer login password.
2. **Who can reach it:** depends on Open decision 1. Every API call and live stream needs a session; patient data needs a membership.
3. **One accountable owner per patient** (patient admin). Reassignment only by the computer admin, only to an existing member, with a reason, audited and notified.
4. **Joining:**
   - new accounts see nothing
   - patients are never searchable
   - invites are single-use, short-lived and announced to the patient admin
   - sign-up and code entry are rate-limited
   - first run is protected by a setup code shown only on the computer
5. **Access levels** (M3), enforced on the server with field stripping. Changes apply immediately, including on live streams. The computer admin has no patient access.
6. **Documents** are treated as sensitive medical information:
   - Full access only
   - stored in the database, served only through permission-checked endpoints with `no-store`
   - never in the static folder, never named after the patient in URLs
   - every view and download is audited
   - recoverable delete for 30 days, then purged; the patient admin can delete permanently at once
7. **Authentication:** PIN or password, scrypt-hashed; lockout; 12 h idle sign-out; `HttpOnly` + `SameSite=Strict` (+ `Secure`) cookies.
8. **Browser attacks:**
   - no CORS; origin check
   - no runtime third-party scripts
   - headers: `nosniff`, `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY`
   - CSP `'self'` (+ `'unsafe-eval'` while in-browser Babel remains)
   - uploads checked by content type
9. **AI provider:**
   - patient data, including document metadata, only with consent recorded by the patient admin, off by default, revocable
   - no document contents in MVP
   - never sends email; attachments need a human Send
   - email content treated as untrusted
10. **Email:** use a separate care-only address (recommended setup). The Email switch controls who can read and send.
11. **Push:** generic text only.
12. **Audit:** append-only, written for every sensitive action; CSV export.
13. **Secrets:** `.env` out of git (document that it holds the email app password); VAPID keys in `app_settings`.
14. **Logs:** the server console never prints request bodies, profile data, email contents, document data or codes.
15. **No compliance claims:** do not claim HIPAA compliance anywhere.

### Path to agency/HIPAA (do not build now; don't block it)
If an agency or clinic adopts MediTrack it would likely bring HIPAA obligations. At minimum:
- Hosting with a signed Business Associate Agreement (BAA).
- BAAs with the AI, email, tunnel, push and (later) fax providers, or those features turned off.
- A risk assessment, policies, training and breach-notification procedures.
- Encryption at rest and in transit, encrypted backups, retention rules.
- MVP already provides: unique user IDs, automatic logoff, access control, audit logging, and `org_id` separation.
- 2-step sign-in and stricter rate limiting if hosted. Finer permission switches (Later) support "minimum necessary".

---

## 9. Visual style

**Keep** the current look: navy/blue header, white cards on light gray, colored badges, teal accent. It is calm and readable.

**Change, for phone-first simplicity:**
1. Bottom navigation; inline SVG icons + labels.
2. Touch targets ≥ 44px; the main action at the bottom of the screen; secondary actions in "…".
3. Inputs at 16px on phones.
4. Cards instead of tables under 640px.
5. Text contrast: `--gray-700` instead of `--gray-500` for text.
6. One status palette: red = out / error, orange = low / needs action, green = OK / done, blue = info. Always text + color.
7. Patient chip on every patient screen; people shown as "Name (Title)".
8. Undo toasts instead of confirm dialogs, except for sending email and permanent delete.
9. Soft highlight on values someone else just changed.
10. Documents: purpose badges in the status palette's neutral colors; large page thumbnails in the scan flow.
11. Web app manifest + icon (also needed for iPhone notifications).

---

## 10. Open decisions

Plain-language questions for the owner, most important first. The spec's current default is in italics.

1. **How should phones connect to MediTrack?** MediTrack runs on your home computer. A secure connection is needed for live barcode scanning and for notifications. Without one, everything else works: photo-based barcode scanning, **scanning documents with the camera**, and live updates. The app works with all four options, so you can start with option 1 and switch later.

   | | 1. Home Wi-Fi only (as today) | 2. Private network app | 3. Security certificate on each phone | 4. Public web address |
   |---|---|---|---|---|
   | Day to day | Home only. Barcodes by photo. Document scanning works. **No notifications.** | Home and away. Everything works. | Home only. Everything works. | Anywhere. Everything works. |
   | What gets installed | Nothing. | A free app (e.g. Tailscale) on the home computer and **every phone**, including each nurse's. | A security file on the computer and **every phone**; several steps on iPhone; repeat for each new nurse. | Nothing on phones; a small program on the home computer. |
   | Cost | Free | Usually free for a family; check the plan's limits if many people need access. | Free, but needs someone comfortable with tech settings. | Roughly $10-20 a year for a web address, or a monthly hosting fee. |
   | Main downside | No notifications; not encrypted on Wi-Fi. | Nurses must agree to install an app. | Fiddly; redo for every new phone. | Reachable from the internet (sign-in still protects it); a company in the middle carries the traffic. |

   *Default: option 1 until you decide; option 2 recommended.*

2. **Invites only for now?** You asked that a nurse could request access and you'd accept or deny it. To keep things simple, the MVP has only invites: you send the nurse a code or link and they're in, and you can remove them with one tap. *Default: invites only; "request to join" comes later.* OK, or is the request flow needed from day one?
3. **Two access levels instead of many switches?** *Default: "Full access" (same as you, the default for family and nurses) or "Care only" (supplies, phone numbers, tasks; no insurance, documents, email or AI), plus one switch to keep someone out of the email.* Enough for now?
4. **What should AI permission cover?** *Default: two switches, both off, set only by you as patient admin. "Medical info" covers diagnoses, equipment, notes, supply list and document names. "Personal & insurance info" covers name, birth date, address, insurance numbers and care team.* Is that split right?
5. **Resupply schedule** (how many of each item insurance allows per month, next order date): needed for the first family, or later? *Default: later.*
6. **Sign-out time:** *Default: everyone stays signed in for 12 hours of inactivity.* OK, or should nurses be signed out sooner?
7. **Documents for "Care only" people:** *Default: they can't see documents, because orders and insurance letters are sensitive.* Should they be able to view (not send) doctor's orders?
8. **Siblings and providers:** enter a shared pharmacy or supply company once for the household, or separately per child? *Default: separately.*
9. **Call scripts:** *Default: the child's name, never "he/she".* Keep, or let families choose pronouns?
10. **Starter supply list:** OK to offer the existing 35 trach / vent / G-tube items with counts at 0 and no alerts?
11. **Nurses who work for two families:** two separate logins (one per family's MediTrack). OK until there's an agency version?
