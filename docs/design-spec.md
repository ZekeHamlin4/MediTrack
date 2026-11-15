# MediTrack Design Spec

## 0. Goal and core design principle (read first)

**Goal (owner's words):**
> "A single portal where families keep all their doctors and DME/supply companies (phone, fax, email), get notified when providers email them, have the AI write emails and faxes, and get help solving problems with those providers. Eventually other families should be able to sign up."

**Principle (owner's words):**
> **MediTrack must stay very simple.** It is for a tired parent of a medically complex child. Every common task (find a number, send an order, reply to a DME email) must take as few taps as possible. Anything that doesn't serve that goes under Later features.

How the builder applies these:
- **The rule for MVP:** a feature is in the MVP only if it (a) serves the goal and makes a common task faster, or (b) is needed for safety or privacy. Everything else is in section 5 (Later).
- **Defaults instead of settings.** Every setting screen and every extra choice must earn its place.
- **One obvious button per screen** for the common action, placed in thumb reach. Secondary actions go in a "…" menu.
- **Never cut for simplicity:** sign-in, hashed secrets, server-side permission checks, AI consent, the stock log, backups.

### How the MVP covers the goal
| Goal part | Covered by |
|---|---|
| **Single portal for all doctors and DME/supply companies** | Care Team (existing) per patient. Phone, **fax** and email for every provider and each department, shown on the card with **Call**, **Copy** and **Fax…** / **Email…** actions. Computer **Overview** shows everything in one place (M14). |
| **Phone, fax, email stored** | `providers.phone/fax/email` and department `phone/fax/email` already exist. MVP shows fax on every card and in Quick contacts, and makes it actionable (Fax draft). |
| **Notified when providers email** | **Core event, on by default:** a push whenever **any** email arrives from a known provider address, not only for open tasks (M12, M18). Generic text. Also shown on Home under "Waiting on you". |
| **AI writes emails and faxes** | Assistant drafts emails (existing) **and faxes** (new): a fax PDF with a cover sheet + letter + attached documents, which the family sends with their own fax app/service until built-in fax sending arrives (Later). Nothing is sent without a human tap (M12). |
| **Help solving problems with providers** | Assistant (existing tools: care team lookup, NPI search, call scripts, step-by-step tasks, inbox reading, web search) + "what to say" scripts on every card + tasks for multi-step problems + documents (orders, LMNs, approvals) ready to send (M11, M12). |
| **Eventually other families can sign up** | Not in MVP. The data model and code avoid single-install assumptions so a sign-up service can follow (section 8, Open decision 1). |
| Supplies, scanning, low-stock alerts, live stock | Kept: the owner asked for them, and they feed the most common DME task (knowing what to reorder and sending the order). |

### Target tap counts (from Home, signed in, patient selected)

| Common task | Target taps | Path |
|---|---|---|
| Find a provider's number (phone or fax) | **0-1** | Favorites are on Home ("Quick contacts", up to 4, with phone and fax). Others: **Care Team** (1) → number is on the card (search box at top). |
| Call a provider | **1-2** (+ the phone's own call confirm) | Home quick contact **Call** (1). Others: **Care Team** (1) → **Call** (2). |
| Send a doctor's order (already in the app) to a DME company by email | **4** | **Care Team** (1) → DME card **Send order** (2) → draft opens with the latest order attached → **Send** (3) → confirm (4). |
| Fax an order (until built-in fax) | **5** in MediTrack | **Care Team** (1) → **Send order** (2) → **Fax** (3; preselected if the provider has no email) → **Download fax PDF** / **Share** (4) → send it in the family's fax app → **Mark as faxed** (5). |
| Scan a new order and send it | **≤ 7** | Home **Scan document** (1) → shutter per page (2) → **Done** (3) → **Save** (purpose "Order", date today prefilled) (4) → **Send to [last DME used]** (5) → **Send** (6) → confirm (7). |
| Read and reply to a provider email | **3-4** | Push "a provider emailed you", or the Home "Waiting on you" card (1) → **Draft reply** (assistant) or **Reply** (blank) (2) → **Send** (3) → confirm (4). |
| Approve an assistant draft | **3** | Home "Waiting on you" draft (1) → **Send** (2) → confirm (3). |
| Log supply use | **2** | **Supplies** (1) → **−1** on the item card (2). Or Home **Scan supply** (1) → camera finds code → **Used** (2). Photo mode (no secure connection) adds 1-2 taps for the phone's camera. |
| Restock | **2** | Same, with **+** (amount) or **Restocked**. |
| Check stock | **0-1** | "Running low" is on Home (0). Full list: **Supplies** (1). |

Used/Restocked taps save immediately and show a 5-second **Undo** toast instead of a confirm dialog. Sending email always has one confirm, because it can't be undone.

---

Status: revision 5. It adds the goal, applies the simplicity principle, and adds **Documents**, **fax drafts** and **notifications for every provider email**.

Owner decisions kept from earlier rounds:
- phone-first design
- PIN or password
- per-patient AI consent
- no doctor login yet
- several patients per user
- self-created accounts
- one patient admin per patient
- nurses get the same access as family by default
- push notifications
- live updates across screens

Remaining questions are at the end.
Scope: evolve the existing app. Do not rewrite it. Reuse existing components, endpoints and tables wherever possible.

---

## 1. Current state

**Stack**
- Server: Node 22+, Express 4, `better-sqlite3` (file `server/meditrack.db`), `nodemailer` (SMTP), `imapflow` (IMAP), `@anthropic-ai/sdk` (assistant).
- Client: one page, `client/index.html` + `client/care.jsx`. React 18 **development** build, Babel standalone (JSX compiled in the browser) and Quagga (barcode) all loaded from public CDNs, unpinned, no integrity hashes.
- Runs on one home computer via `Start MediTrack.bat` / `.command`. Phones reach it over plain `http://<LAN-IP>:3000` on home Wi-Fi.
- One child per install (`patient_profile` is a single row, id = 1). Email settings (SMTP/IMAP) are install-wide in `.env`.

**Screens today (9 tabs in a scrolling top bar, visible after setup)**
| Tab | What it does |
|---|---|
| Setup wizard (first run only) | 3 steps: family info (child, DOB, parent contact, address, insurance/Medicaid IDs, diagnoses, equipment) → add care team (manual form or NPI registry search, which returns phone **and fax**) → done. |
| Care Team (default) | Provider cards: phone/**fax**/email/account #, department directory (each with phone/ext/**fax**/email), tips, notes, favorite, tap-to-call, copy, "Show what to say" scripts, "Ask assistant", edit, delete. Search + type filter. NPI registry search. |
| Assistant | Claude chat with tools: search/save providers, NPI lookup, create/update tasks, draft emails, read inbox, read supply levels, call tips, web search. It can write fax *text* in chat but can't produce a fax document. Side panel: Outbox (edit, Send via SMTP or "Open in my email app", copy, discard) and Inbox (only when opened). Never sends email itself. Conversation lost when leaving the tab. |
| Tasks | Checklists with status, provider, due date, steps. |
| Dashboard | Counts, low-stock table, category chips, last 10 scans. |
| Supplies | Inventory table, search, filters, inline quantity edit, add/edit modal, delete. |
| Scan | Camera barcode scan (Quagga) or manual code → log add / remove / check, with a free "Logged by" dropdown. |
| Portal | Read-only supply table; every other tab still reachable. |
| Activity | Last 200 scan log entries. |
| Users | List, add, remove. |

**Data today**: `users`, `supplies`, `scan_log`, `patient_profile`, `providers`, `tasks`, `outbox`. First start seeds 5 demo users (plain-text PINs) and 35 demo supplies. No documents, no attachments, no fax drafts. The app is never told about new emails; the inbox is only read when someone opens it.

**Roles today**: labels only. No login, no permission checks. Screens never refresh on their own.

---

## 2. Target users and devices

**Phone-first.** Daily work happens on phones. The computer is for the Overview ("portal"), printing and keeping the install running.

**Two kinds of admin. They are separate; never call either just "admin" in the UI:**
- **Patient admin**: the **one** person who owns a patient's account. Whoever creates the patient profile becomes its patient admin automatically: the patient themselves, or a parent creating it for a child. A nurse can be patient admin if they created the profile. The patient admin:
  - invites and removes people, and sets each person's access
  - gives or withdraws AI consent, acting as the patient or the patient's representative
- **Computer admin**: the person who set up MediTrack on the home computer. Handles settings, backup/restore, unlocking accounts, and reassigning a patient admin if one is gone. Has **no** access to patient information as computer admin.

| User | Needs |
|---|---|
| **Family caregiver** (title e.g. Mom, Dad) | Numbers (phone/fax/email) fast, orders sent fast, told when a provider emails, help with provider problems, know what's low. |
| **Nurse / home health aide** | Same as family by default ("Full access"); the patient admin can lower it to "Care only". |
| **Patient (adult or older child)** | Can create their own profile and be their own patient admin. |
| **Doctor** | No login yet; gets documents/letters by email or fax, or a printed usage report. |
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

### 3c. Missing for the goal
1. **No notification when a provider emails**; families must open the inbox to find out.
2. **No fax output**: the fax number is stored but there's nothing to send to it.
3. **No way to keep or send doctor's orders**, the most common thing a DME company asks for.
4. 9 tabs on a scrolling bar; small buttons; letter "icons"; static header text.
5. Assistant edits providers without confirming.
6. No backup.

---

## 4. MVP feature list

Build in this order. Every item passes the section 0 rule.

**M1. Data foundation and migrations**
- `PRAGMA user_version` + numbered migrations (section 7).
- New tables: `organizations`, `patients`, `patient_members`, `invites`, `ai_consents`, `documents`, `document_files`, `outbox_attachments`, `provider_emails_seen`, `sessions`, `audit_log`, `settings`, `push_subscriptions`.
- `patient_id` (and `version` where noted) on existing tables.
- No seeded users or supplies on fresh installs.
- **Keep the sign-up path open** (section 8):
  - every patient belongs to an organization
  - access is decided only by patient membership, never by "everyone on this install"
  - email/assistant settings are looked up per organization (with `.env` as the fallback for the single household)
  - `organizations` has no UI in MVP

**M2. Accounts and sign-in** (safety)
- Anyone who can reach MediTrack can create an account: name, **title** (display only: Mom, Dad, Nurse, Home health aide, Patient, Other), username, and a **6-digit PIN or a password** (min 10 characters).
- Secrets: scrypt-hashed with a per-user salt; never returned by the API.
- Lockout: 5 failures → 15 min. Sign-up limited to 5 accounts per IP per hour. Computer-admin switch "Allow new accounts" (default on).
- A new account with no patient links sees **no patient data**.
- Session cookie: `HttpOnly`, `SameSite=Strict`, `Secure` on HTTPS.
- **One idle sign-out time for everyone: 12 hours.**
- Forgotten secret: the computer admin sets a temporary PIN, which must be changed at next sign-in.
- Accounts are deactivated, never deleted.

**M3. Permissions: one patient admin, two access levels, one "Email & fax" switch** (safety/privacy)
- `patients.admin_user_id` holds the **one** patient admin, set to whoever created the patient.
- Every other linked person has an **access level** and an **Email & fax** switch.

| | Care only | Full access (default for family, nurse, self) | Patient admin |
|---|---|---|---|
| Patient name, DOB, clinical info (diagnoses, equipment, care notes) | view | view + edit | view + edit |
| Supplies: view, log Used / Restocked / Counted | yes | yes | yes |
| Supplies: add/edit/archive items, thresholds, low-stock alerts | no | yes | yes |
| Care team: names, phone, **fax**, departments, call scripts, Call, Copy | yes | yes | yes |
| Care team: account #s, notes; add/edit/delete; NPI search | no | yes | yes |
| Insurance/Medicaid IDs, address, parent contact | no | yes | yes |
| Tasks: view, tick steps | yes | yes | yes |
| Tasks: create/edit/delete | no | yes | yes |
| **Documents**: view, scan/upload, tag, delete (recoverable) | no | yes | yes |
| AI assistant (within the patient's AI consent) | no | yes | yes |
| **Email & fax switch** (default on): inbox, provider-email notifications, outbox, send email, fax drafts, send documents | no | if switch on | yes |
| Usage report | yes (no insurance) | yes | yes |
| Invite people, remove people, set access level and Email & fax switch | no | no | yes |
| AI consent; permanently delete a document; archive patient | no | no | yes |

- Turning the switch off is how a family keeps a nurse out of the care inbox.
- **Recommended setup (not a question):** connect MediTrack to a **separate email address used only for care and supply companies**. README and first-run tips say so.
- Enforcement:
  - patient-scoped endpoints live under `/api/patients/:pid/...`, and middleware checks membership, level, switch or patient admin on **every** call
  - restricted fields are **removed on the server**
  - assistant tools follow the same rules
- Remove `cors()`. Add an origin check on state-changing requests.
- Errors: 401 when not signed in, 403 when not allowed, 404 for patients the caller isn't linked to.
- The computer admin is a separate user flag with no patient access by itself.

**M4. Invites, removing people, recovery, first run**
- **Invites are the only way in** (MVP). The patient admin: **Members → Invite** → Full access or Care only, Email & fax on/off → gets a code (8 characters, e.g. `K7QM-4ZPX`), a link and a QR code → **Share**.
  - single-use; expires in 72 h; stored hashed
  - the invitee opens the link → creates an account or signs in → **Accept** → in
  - the patient admin gets a push "someone joined using your invite", and the newcomer shows at the top of Members with **Remove** for 7 days
- **Removing:** the patient admin taps a person → **Remove**. Anyone can **Leave**, except the patient admin.
  - takes effect immediately, including on live screens
  - the computer admin can deactivate an account entirely
- **Reassign patient admin** (handover or recovery): Computer admin › **Patient admin**.
  - choose an existing member, type a reason, **Reassign**
  - takes effect immediately, is audited, and both people are notified
  - the computer admin can't make themselves patient admin unless already a member
- **First run:**
  1. The server prints a one-time **setup code** in the MediTrack window; the Welcome screen asks for it.
  2. Create account → **computer admin**.
  3. Add-patient wizard (M9) → **patient admin**.
- Upgrades use the same flow (section 7).

**M5. Patient switcher**
- The current patient is in the client URL (e.g. `#/p/12/supplies`).
- A patient chip is always in the header and on Scan sheets; tap it → list → switch.
- After sign-in: 0 patients → "No patients yet" (Enter invite code / Create a patient profile); 1 → Home; several → last used.

**M6. Stock log** (safety)
- Quantities change **only** through movements: `POST .../supplies/:id/movements {action: add|remove|check|adjust, amount, reason?}`.
- `add` / `remove` are **+/- changes** applied in SQL (`quantity = MAX(0, quantity ± n)`), so simultaneous logs never overwrite each other.
- `check` / `adjust` record before/after; a count wins over a simultaneous change; both are logged.
- Every movement is written to `scan_log` with user, patient, action, amount, before/after.
- `PUT` on a supply no longer accepts `quantity`. The "Logged by" dropdown is removed. Supplies are archived, not deleted.

**M7. Live updates** (owner requirement)
- **Server-Sent Events:** `GET /api/patients/:pid/events` for the patient on screen; `GET /api/me/events` for membership changes. In-memory publish/subscribe.
- Events carry only type, id and baseline-visible fields:
  - `supply.changed` carries quantity and low flag
  - other events tell the client what to refetch: `task.changed`, `document.changed` (Full only), `outbox.changed` / `inbox.new` (Email & fax only), `profile.changed`, `providers.changed`, `consent.changed`, `members.changed`, `access.changed`
- Sensitive data is always refetched through permission-checked endpoints.
- Heartbeat every 25 s. Removing a person or changing their access closes their stream.
- **Reconnect:** `EventSource` reconnects automatically. On reconnect, and when the app returns to the foreground, the client **refetches the current screen**.
  - header dot: green "Live", gray "Reconnecting…"
  - while disconnected, saving shows "Not connected, try again in a moment"
- **Simultaneous edits** (not quantities): records carry a `version`.
  - on 409 the app reloads the record and shows "Sam (Night nurse) just changed this. Your screen is updated. Please make your change again."
  - task steps are ticked individually by step id
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
  2. Care team (manual or "Find near me"; phone, fax, email)
  3. Supplies: starter list (35 items, quantities 0) or empty, plus "Which items should alert you when low?" (none ticked)
  4. Done
- AI sharing and invites are set later from their own screens.

**M10. Works with any connection; scanning on phones**
- The build does not depend on Open decision 2. `.env` chooses one of:
  - plain HTTP (default)
  - HTTPS with certificate files (`HTTPS_CERT`, `HTTPS_KEY`)
  - behind a private-network app or tunnel (`TRUST_PROXY=1`)
- **Barcode scanning:**
  - secure connection: live camera
  - otherwise: **"Take photo of barcode"** (`<input type="file" accept="image/*" capture="environment">` + Quagga single-image decode) and manual entry
- Live updates and document scanning work on every option. Push notifications and the phone share sheet need a secure connection.
- Settings shows "Connection: secure" / "Connection: home Wi-Fi only, not encrypted".

**M11. Documents**
*Capture*
- **Scan with the phone camera:** Documents → **Scan** (also **Scan document** on Home) → camera via `<input type="file" accept="image/*" capture="environment">`.
  - after each photo: thumbnail strip with **Add page** / **Done**; drag to reorder; tap to delete
  - **works on plain home Wi-Fi** (photo capture through a file input doesn't need HTTPS, unlike live barcode scanning)
- **Cleanup on the phone** (canvas, any connection):
  - auto-rotate from EXIF
  - max 2000 px long edge
  - "document look" (grayscale + contrast; on by default)
  - JPEG 0.8
- **Auto-crop** is Later (large image library; live edge guides need HTTPS). **Tip in the app:** iPhone (Files/Notes "Scan Documents") and Android (Google Drive "Scan") make cropped PDFs; use them, then **Upload**.
- **Upload:** PDF, JPEG, PNG (HEIC converted on the phone when possible; otherwise "Please upload as JPEG or PDF").
- The server combines pages into one PDF with `pdf-lib`. Uploaded PDFs are stored as is; single images become a 1-page PDF.
- Limits: 20 MB per document, 30 pages per scan. File type checked by content (magic bytes).

*Tag* (prefilled so **Save** is usually one tap)
- **Purpose:** Order / prescription (default), Letter of medical necessity, Insurance approval, Other.
- **Doctor:** from Care Team (last used preselected; optional).
- **Date:** today by default.
- **Title:** optional.
- **Renew by:** optional; shows an "Expires soon" badge within 30 days.

*Find*
- Newest first. Filter chips for purpose; a doctor dropdown. Rows: purpose badge, title or "Order from Dr X", date, pages, expiry badge.
- Tap → full-screen PDF view with **Send to…**, and in the "…" menu: Edit tags, Download, Delete.

*Send* (Full access + Email & fax switch)
- **From a Care Team card:** **Send order** creates an Outbox draft for that provider and opens it:
  - Subject: "Order for [child's name], [date]"
  - short body (with the account number for Full access)
  - attached: **the newest non-deleted "Order" document**, with **Change** to pick other or extra documents
  - **Send by: Email | Fax**, preselected: Email if the provider has an email, otherwise Fax
- **From a document:** **Send to…** → provider list (DME/pharmacy first, last used on top) → the same draft.
- **Email:** **Send** → confirm. Without SMTP: **Download attachment** + **Open in my email app** ("Attach the downloaded file"; mailto can't carry attachments). Max 20 MB per email.
- **Fax:** see M12 "Fax drafts".

*Assistant*
- `draft_email` / `draft_fax` accept `document_ids`. `list_documents` returns metadata only (id, purpose, doctor, date, title, expiry).
- Both need the patient's **clinical** AI consent.
- No document contents are sent to the AI in MVP.
- Drafts need a human **Send** / **Mark as faxed**.

*Delete and storage*
- **Delete** (Full access) → **Recently deleted** for 30 days (restorable) → purged by a daily job.
- The patient admin can **Delete permanently now**.
- Sent drafts keep the attachment filename after a purge.
- **Files are stored in the SQLite database** (`document_files`, BLOB):
  - backups stay one file and include documents
  - files are only served through permission-checked endpoints, never from the static folder
  - deletes are transactional
- Settings shows storage used, with a warning above 2 GB.
- Downloads: `Content-Disposition`, `Cache-Control: no-store`, generated filename (no patient name in URLs).

*Audit*
- Document uploaded, viewed/downloaded, tags edited, attached, sent/faxed, deleted, restored, permanently deleted, purged.

**M12. Provider messages and the AI assistant**
*Provider email notifications (core, on by default)*
- When IMAP is configured for the organization, the server checks the inbox **every 5 minutes**.
- A new email is a **provider email** if the sender matches:
  - a provider's email or a department email, exactly, or
  - a provider's email domain, but **not** for free-mail domains (gmail.com, yahoo.com, outlook.com, hotmail.com, icloud.com, aol.com and similar, kept in a built-in list)
- Matching uses the care teams of all patients in the organization. One email can match several patients (siblings sharing a DME).
- For each matching patient:
  - shows under Home **"Waiting on you"** (sender's provider name, subject, time) with **Draft reply** / **Reply** / **Open**
  - sends a push to that patient's members with the Email & fax switch: **"MediTrack: a provider emailed you."**
  - fires for **every** provider email, not only open tasks
- Seen message ids are stored (`provider_emails_seen`), so nobody gets a duplicate.
- The AI is **never** run on incoming mail by itself.
- Inbox items have a plain **Reply** (creates a "Re:" draft to the sender) and **Ask assistant about this**.

*Fax drafts (the AI writes faxes; sending stays manual until Later)*
- Outbox items have `channel` = `email` or `fax`.
- A fax draft has: To (provider name + fax number, prefilled from the card or department), Re, message, attached documents.
- **Download fax PDF** builds one PDF on the server with `pdf-lib`:
  1. **Cover sheet:** To, fax number, From (parent name, phone), date, page count, Re, and a standard confidentiality notice
  2. the letter
  3. the attached documents
- The filename uses provider and date, never the patient name.
- On a secure connection the button is **Share** (phone share sheet, so it goes straight into a fax app). Otherwise it's **Download**.
- The family sends it with their own fax app or online fax service, then taps **Mark as faxed**. That records `sent_via = 'fax_manual'`, the time and the user.
- Built-in fax sending (Later) plugs into the same draft: the **Mark as faxed** button becomes **Send fax**.
- Fax buttons:
  - every card or department with a fax number has **Fax…** (blank fax draft)
  - **Send order** offers Fax
  - the assistant has a `draft_fax` tool

*Assistant: consent* (privacy)
- Patient data goes to the AI only with consent **recorded by the patient admin**, as the patient or the patient's representative. Off by default, per patient, revocable.
- Two scopes:
  - `clinical`: diagnoses, equipment, notes, supply list and levels, document metadata
  - `identity_admin`: name, DOB, address, insurance IDs, care team details and account numbers
- Without a scope the server leaves that data out, the matching tools refuse, and drafts use `[placeholders]`.
- Grants and revokes are stored in `ai_consents`.
- One-time notice per user that what they type is sent to the AI provider.

*Assistant: help solving provider problems*
- **Tools:** existing tools plus `draft_fax` and `list_documents`.
- **System prompt addition:** "When the parent describes a problem with a provider (denied order, missing shipment, expired prescription, no reply), propose a short plan, offer to create a task with steps, and draft the email or fax for each step. Suggest calls with the number and a script."
- **Provider changes:** `save_provider` on an existing provider shows a confirm card.
- **Conversation:** the server keeps it; the client sends only new text.
- **Background jobs:** if the user has left when an answer is ready, send "MediTrack: the assistant has an update." Results stay in memory up to 24 h.
- **Organization settings** (computer admin): assistant on/off, web search on/off, inbox checking on/off.

**M13. Local front-end libraries**: React (production), ReactDOM, Babel standalone and Quagga served from `client/vendor/`, pinned. No CDNs.

**M14. Phone-first navigation, Home quick actions, computer Overview** (section 6). The Overview is the "single portal" on the computer.

**M15. Printable usage report**
- Kept because it helps solve provider and insurance problems (justifying quantities). Owner request.
- One screen: date range → per item used, restocked, average per month, current qty → Print / Save as PDF.
- Insurance info only for Full access.

**M16. Backup and restore** (computer admin): "Download backup" (SQLite online backup; includes documents; health-information warning); "Restore" with confirm; README upgrade guide.

**M17. Audit log, written** (privacy)
- Append-only, from M2 onward:
  - sign-ins and lockouts
  - invites, joins, removals, access changes, admin reassignments (with reason)
  - profile edits; AI consent
  - provider changes (marked if via the assistant)
  - documents
  - email sent, fax marked sent, report generated, backup/restore
- No viewer screen in MVP; CSV export from Settings.

**M18. Push notifications** (needs a secure connection; on iPhone the app must be on the Home Screen)

| Event | Default | Who | Text (always generic) |
|---|---|---|---|
| **Provider emailed** (any email from a known provider) | **on** | members with Email & fax | "MediTrack: a provider emailed you." |
| Assistant update (answer ready; draft needs approval) | on | the person who asked | "MediTrack: the assistant has an update." |
| Low stock (only items with **Alert when low**; shared per patient) | on | all members | "MediTrack: a supply is running low." |
| Someone joined with your invite / you've been given access | always | patient admin / newcomer | "MediTrack: someone joined your care team." |

- No patient, provider, item or health details in any text.
- Tapping opens the right screen and patient.
- **Settings:** My profile → per patient, two switches: **Provider messages** (provider emails + assistant updates) and **Low stock**.
- Pushes only go out while the home computer and MediTrack are running; the UI says so.

New server dependencies: `multer` (uploads), `pdf-lib` (document and fax PDFs), `web-push` (notifications).

---

## 5. Later features (not MVP)

### Moved out of the MVP (yardstick: the goal + simplicity)
| Item | Why it moved | MVP replacement |
|---|---|---|
| 8 individual permission switches | Too many decisions when adding a nurse; the owner's real need was "same as family" plus "keep someone out of the inbox". | Two levels + Email & fax switch. |
| Delegated "manage people" | Rare in one household. | Only the patient admin manages people. |
| Join requests with a share code | Two ways in means more screens; invites do the same job in fewer steps. | Invites only (Open decision 3). |
| Self-service admin handover | One computer-admin tool covers handover and recovery. | Computer admin › Reassign. |
| "Keep mine / use theirs" conflict screen | A decision screen for a rare event. | Reload + "please make your change again". |
| Event replay after reconnect | More parts, no visible difference. | Refetch on reconnect. |
| Audit log viewer | Not part of the goal; the log itself is kept. | CSV export. |
| Tasks-due and other optional notifications; per-event notification settings | Not in the goal. | Two switches: Provider messages, Low stock. |
| Notifications only for "tracked issues" | Too narrow for the goal. | Every provider email notifies. |
| Per-user / per-role idle sign-out | A setting nobody needs daily. | 12 hours for everyone (Open decision 7). |
| Patient search | A household has few patients. | Simple list. |
| AI sharing and invites as wizard steps | Longer setup. | Their own screens. |

### Other later features
- **Built-in fax sending** through an online fax service (the fax draft already has a fax PDF, number and channel). Email-to-fax gateways.
- **Sign-up service for other families** (Open decision 1; section 8).
- Faster provider-email alerts (IMAP IDLE instead of 5-minute checks).
- **Documents:** auto-crop / edge detection; live camera document view (HTTPS); assistant reading document contents (clinical consent); renewal reminders; text search.
- Doctor login (reserved `doctor` role).
- Email-based "forgot my PIN/password".
- Resupply schedule per item (Open decision 6).
- Expiration dates / lot numbers on supplies; go-bag checklist; storage location.
- One-tap "reorder all low items" per DME.
- Task assignment; shift-handoff notes.
- Offline mode; persisted assistant conversations (opt-in); pre-compiled client bundle; encryption at rest and encrypted backups.

---

## 6. Screens

### Navigation
- **Phone (primary):** bottom bar **Home · Supplies · Care Team · Documents · Assistant**, icon + label, items ≥ 48px tall.
  - Care only sees **Home · Supplies · Care Team**.
  - Tasks open from Home ("Issues & tasks") and the menu.
- **Computer:** same items in the top tab bar, plus **Overview**.
- Header: patient chip (tap → switcher), live dot, menu: **My profile**, **Patient profile**, **Members**, **Tasks**, **Usage report**, **Computer admin** (computer admin only), **Sign out**.
- Removed as tabs: Dashboard → Home; Scan → Home/Supplies buttons; Portal → Overview (`?view=portal` redirects); Activity → Supplies › History; Users → Computer admin.

### Screen list
1. **Welcome / first run**: setup code → Create account.
2. **Sign in**: username → PIN keypad or password. **Create account**, **I have an invite** links.
3. **Create account**: name, title, username, PIN or password.
4. **No patients yet**: **Enter invite code**, **Create a patient profile**.
5. **Join with invite**: who invited you, patient first name, access level → **Accept**.
6. **Home (phone)**, top to bottom:
   - **Waiting on you:** new provider emails (**Draft reply** / **Reply** / **Open**), drafts to approve (**Send**), fax drafts to send (**Share/Download** / **Mark as faxed**)
   - **Quick contacts:** up to 4 favorites with phone and fax shown, **Call**, and **Send order** for DME/pharmacy
   - **Running low:** **−1 / +**, **Restocked**
   - **Issues & tasks:** next 3; "See all"
   - Two big buttons: **Scan supply** · **Scan document**
   - Care only sees Quick contacts (Call, numbers), Running low, Issues & tasks (tick only) and **Scan supply**.
7. **Overview (computer portal)**: the Home blocks side by side with full tables. With several patients, an "All my patients" table (low items, provider emails waiting). Live.
8. **Supplies**: search, category filter, low-only; cards with live qty, status, bell if alerting, **−1 / +**. "+ Add supply" (Full).
9. **Scan supply sheet**: patient name; live camera / photo / manual → **Used** / **Restocked** (stepper, default 1), saves with Undo; not found → "Add new supply with this barcode" (Full).
10. **Supply detail**: qty, **Set exact count**, history; Full: **Alert when low** + threshold, Edit, Archive.
11. **Supplies › History**: log by item/person ("Name (Title)").
12. **Care Team**: favorites first, search.
    - Each card shows **phone, fax, email**, account # (Full), departments with their phone/ext/fax/email.
    - Actions: **Call**, **Send order** (DME/pharmacy; Full + Email & fax), and in "…": **Email…**, **Fax…**, Copy, Show what to say, Ask assistant, Edit, Delete.
    - Care only: numbers, Call, Copy, scripts.
13. **Documents** (Full): chips (All · Orders · LMN · Insurance · Other), doctor dropdown, newest first, expiry badges. **Scan** / **Upload**. "…" → Recently deleted.
14. **Scan document flow**: camera → thumbnails (**Add page** / **Done**, reorder, delete, document look) → Tag (purpose, doctor, date, title, renew-by) → **Save** → **Send to [last DME]** / **Done**.
15. **Document view**: PDF; **Send to…**; "…" Edit tags, Download, Delete (patient admin: Delete permanently).
16. **Draft (Outbox item)**: **Send by: Email | Fax**; To (email or fax number), Subject/Re, Body, **Attachments** (chips, **Add document**).
    - Email: **Send** (confirm). Without SMTP: **Download attachment** + **Open in my email app**.
    - Fax: **Preview fax PDF**, **Share** / **Download**, then **Mark as faxed**.
17. **Assistant** (Full): chat; Outbox/Inbox panel (Email & fax); inbox items **Reply** / **Ask assistant about this**; consent banner; provider-update confirm card.
18. **Tasks**: list + edit (Full); tick steps (all).
19. **Patient profile**: identity, clinical, contact & insurance (Full); "Patient admin: Name (Title)". Patient admin: **AI sharing** (two switches + "I am the patient / the patient's representative" + history), **Archive patient**.
20. **Members**: list (admin badge, title, level, Email & fax on/off). Patient admin: **Invite**, tap a person → level / switch / **Remove**. Others: **Leave**.
21. **Usage report**: date range → Print / Save as PDF.
22. **My profile**: name, title, change PIN/password, my patients, notifications (Provider messages, Low stock per patient).
23. **Computer admin** ("Keeps MediTrack running. No access to patient information."):
    - Accounts: unlock, reset secret, deactivate
    - Settings: allow new accounts; assistant, web search, inbox checking; email and connection status; storage used; Backup; Restore; Export audit log
    - **Patient admin**: reassign with a reason

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
  email_access INTEGER NOT NULL DEFAULT 1,       -- the "Email & fax" switch (only meaningful for 'full')
  notify_provider_messages INTEGER NOT NULL DEFAULT 1,
  notify_low_stock INTEGER NOT NULL DEFAULT 1,
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
  doc_date TEXT NOT NULL, title TEXT, renew_by TEXT,
  pages INTEGER, size_bytes INTEGER NOT NULL, sha256 TEXT NOT NULL,
  original_filename TEXT,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  deleted_at DATETIME, deleted_by INTEGER REFERENCES users(id),
  version INTEGER NOT NULL DEFAULT 1)
  -- index (patient_id, deleted_at, doc_date DESC)

document_files(
  document_id INTEGER PRIMARY KEY REFERENCES documents(id) ON DELETE CASCADE,
  pdf BLOB NOT NULL,                            -- always a PDF, max 20 MB
  thumb BLOB)

outbox_attachments(
  id INTEGER PK, outbox_id INTEGER NOT NULL REFERENCES outbox(id) ON DELETE CASCADE,
  document_id INTEGER REFERENCES documents(id) ON DELETE SET NULL,
  filename TEXT NOT NULL)

provider_emails_seen(
  id INTEGER PK, org_id INTEGER NOT NULL REFERENCES organizations(id),
  message_id TEXT NOT NULL,                     -- IMAP Message-ID (or UID+UIDVALIDITY)
  from_address TEXT NOT NULL, subject TEXT, received_at DATETIME,
  matched_patient_ids TEXT NOT NULL,            -- JSON array
  matched_provider_ids TEXT NOT NULL,           -- JSON array
  handled_at DATETIME, handled_by INTEGER REFERENCES users(id),   -- cleared from "Waiting on you"
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(org_id, message_id))                   -- no body stored; the body is fetched from IMAP on open

ai_consents(
  id INTEGER PK, patient_id INTEGER NOT NULL REFERENCES patients(id),
  scope TEXT NOT NULL CHECK(scope IN ('clinical','identity_admin')),
  granted_by INTEGER NOT NULL REFERENCES users(id),
  granted_as TEXT NOT NULL CHECK(granted_as IN ('patient','representative')),
  granted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  revoked_by INTEGER REFERENCES users(id), revoked_at DATETIME)

sessions(id TEXT PK, user_id INTEGER NOT NULL REFERENCES users(id),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP, last_seen_at DATETIME, expires_at DATETIME NOT NULL)

audit_log(id INTEGER PK, org_id INTEGER, patient_id INTEGER, user_id INTEGER,
  action TEXT NOT NULL, entity TEXT, entity_id INTEGER,
  summary TEXT,                                 -- short; no diagnoses, IDs or document titles
  via_assistant INTEGER NOT NULL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP)  -- append-only

settings(
  org_id INTEGER REFERENCES organizations(id),  -- NULL = whole install (e.g. VAPID keys, allow_signups)
  key TEXT NOT NULL, value TEXT NOT NULL,
  PRIMARY KEY (org_id, key))
  -- per org: assistant_enabled, assistant_web_search, inbox_checking_enabled, inbox_last_uid
  -- SMTP/IMAP: read through getMailConfig(orgId); MVP returns the .env values for the household org

push_subscriptions(id INTEGER PK, user_id INTEGER NOT NULL REFERENCES users(id),
  endpoint TEXT NOT NULL UNIQUE, keys_json TEXT NOT NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)
```

### Changed tables
- **users**: add `username UNIQUE`, `title`, `secret_type ('pin'|'password')`, `secret_hash` (`scrypt$salt$hash`), `must_reset_secret`, `is_computer_admin`, `active`, `failed_attempts`, `locked_until`, `last_login_at`. Users are **not** tied to one organization; access comes only from patient memberships, so one person can later belong to patients in different families. Old `role` and `pin_hash` are no longer read; `pin_hash` is cleared.
- **supplies**: add `patient_id NOT NULL`, `archived`, `alert_enabled DEFAULT 0`, `alert_sent_at`, `version`. Barcode `UNIQUE(patient_id, barcode)`. Quantity changes only via movements.
- **scan_log**: add `patient_id`, `quantity_before`, `quantity_after`, `reason`; action adds `'adjust'`; `user_id` from session.
- **providers**: add `patient_id`, `version`. Fax fields already exist (`fax`, department `fax`).
- **tasks**: add `patient_id`, `created_by`, `version`; steps get stable `id`s.
- **outbox**: add
  - `patient_id`, `created_by`, `sent_by`, `version`
  - `channel TEXT NOT NULL DEFAULT 'email' CHECK(channel IN ('email','fax'))`
  - `to_fax TEXT`, `to_name TEXT`
  - `sent_via TEXT CHECK(sent_via IN ('smtp','email_app','fax_manual','fax_service'))`
  - `in_reply_to TEXT` (Message-ID when replying)
  - status gains `'sent'` for manually faxed items (with `sent_via = 'fax_manual'`)
- **patient_profile**: replaced by `patients`; dropped after migration.

### Migration v0 → v1
1. Create the `organizations` row.
2. Existing users: kept for history, `active = 0`, `pin_hash` cleared.
3. First run (setup code) creates the first account (computer admin).
4. In the same step: if `patient_profile` has a name or `onboarded = 1`, or any supplies/providers/tasks exist, create a `patients` row ("My child" if unnamed) with `admin_user_id` = the new account; the member row is `migration`, `family`, `full`.
5. Set `patient_id` and `version = 1` on all existing rows; outbox rows get `channel = 'email'`; task steps get ids; supplies `alert_enabled = 0`.
6. Mark all current inbox messages as seen (so the first check doesn't flood notifications).
7. One-time prompt: "Choose which items should alert you when low."

### Timestamps
ISO-8601 UTC in the API; local time in the client.

---

## 8. Privacy and security

1. **Where data lives:** `server/meditrack.db` on the home computer (including documents), plus downloaded backups. Recommend disk encryption and a computer login password.
2. **Who can reach it:** depends on Open decision 2. Every API call and live stream needs a session; patient data needs a membership.
3. **One accountable owner per patient** (patient admin). Reassignment only by the computer admin, only to an existing member, with a reason, audited and notified.
4. **Joining:**
   - new accounts see nothing; patients are never searchable
   - invites are single-use, short-lived and announced to the patient admin
   - sign-up and code entry are rate-limited
   - first run is protected by a setup code shown only on the computer
5. **Access levels** enforced on the server with field stripping; changes apply immediately. The computer admin has no patient access.
6. **Documents and fax PDFs:**
   - documents are Full access only and stored in the database
   - served only through permission-checked endpoints with `no-store`
   - no patient names in URLs or filenames
   - views, downloads, sends and faxes are audited
   - recoverable delete for 30 days, then purged; the patient admin can delete permanently at once
   - fax cover sheets carry a confidentiality notice
7. **Provider email checks:** only sender, subject, Message-ID and match results are stored; bodies stay in the mailbox. Matching never sends anything to the AI.
8. **Authentication:** PIN or password, scrypt-hashed; lockout; 12 h idle sign-out; `HttpOnly` + `SameSite=Strict` (+ `Secure`) cookies.
9. **Browser attacks:**
   - no CORS; origin check
   - no runtime third-party scripts
   - headers: `nosniff`, `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY`
   - CSP `'self'` (+ `'unsafe-eval'` while in-browser Babel remains)
   - uploads checked by content
10. **AI provider:**
    - patient data, including document metadata, only with consent recorded by the patient admin, off by default, revocable
    - no document contents in MVP
    - never sends email or faxes; attachments need a human action
    - email content treated as untrusted
11. **Email:** a separate care-only address is recommended. The Email & fax switch controls who reads and sends.
12. **Push:** generic text only.
13. **Audit:** append-only for every sensitive action; CSV export.
14. **Secrets:** `.env` out of git (document that it holds the email app password); VAPID keys in `settings`.
15. **Logs:** the server console never prints request bodies, profile data, email contents, document data or codes.
16. **No compliance claims:** do not claim HIPAA compliance anywhere.

### Keeping the sign-up path open (built into the MVP)
These MVP choices mean a hosted sign-up service can come later without redesigning the data:
- **Organizations:** every patient belongs to an organization (one per family in a hosted service).
- **Per-patient scoping:** every record and API route is scoped to a patient; access comes only from memberships; users aren't tied to one install or organization.
- **Per-organization settings:** email (SMTP/IMAP), assistant and inbox settings go through `settings`/`getMailConfig(orgId)`, not straight from `.env`.
- **Audit log and consent records** already exist per patient and organization.
- **No install-wide assumptions:**
  - no "everyone on this install sees X"
  - the computer admin has no patient access
  - inbox matching is per organization
  - backups are the only install-wide operation

### What a sign-up service would additionally need (Later)
- Real hosting with HTTPS, monitoring, daily off-site encrypted backups, and encryption at rest.
- Email per family: each family connects its own mailbox (OAuth for Gmail/Outlook instead of app passwords), or the service provides addresses.
- Per-family AI and email costs, and possibly billing.
- Account recovery by email/SMS and 2-step sign-in.
- Terms of service and a privacy policy.
- **HIPAA-style obligations:**
  - Business Associate Agreements (BAAs) with hosting, AI, email, push and fax vendors (or those features turned off)
  - a risk assessment, policies and training
  - breach-notification procedures
  - retention rules
- Operator staff tooling (the "computer admin" becomes support staff, still with no patient access by default).
- Abuse controls: sign-up verification, stricter rate limits.

---

## 9. Visual style

**Keep** the current look: navy/blue header, white cards on light gray, colored badges, teal accent. It is calm and readable.

**Change, for phone-first simplicity:**
1. Bottom navigation; inline SVG icons + labels.
2. Touch targets ≥ 44px; the main action at the bottom; secondary actions in "…".
3. Inputs at 16px on phones.
4. Cards instead of tables under 640px.
5. Text contrast: `--gray-700` instead of `--gray-500` for text.
6. One status palette (red = out / error, orange = low / needs action, green = OK / done, blue = info). Always text + color.
7. Patient chip on every patient screen; people shown as "Name (Title)".
8. Undo toasts instead of confirm dialogs, except sending email, marking a fax as sent, and permanent delete.
9. Soft highlight on values someone else just changed.
10. Provider cards: phone, fax and email on their own lines with clear labels, so the fax number is never hidden.
11. Web app manifest + icon (also needed for iPhone notifications).

---

## 10. Open decisions

Plain-language questions for the owner, most important first. The spec's current default is in italics.

1. **Single family or sign-up service?**
   - **Single family:** MediTrack runs on your home computer, just for your family and the people you invite. It is private, and free to run apart from your own AI usage. Other families can't sign up; each would have to install their own copy.
   - **Sign-up service:** MediTrack is hosted on the internet and any family can create an account. That needs:
     - paid hosting with a secure (HTTPS) address, monitoring and off-site backups
     - email and AI costs for every family, and possibly billing
     - HIPAA-style obligations: signed agreements (BAAs) with every vendor that touches health data, a risk assessment, written policies, breach procedures
     - account recovery and 2-step sign-in
     - terms of service and a privacy policy

   *Recommendation and default: **build the single-family version first** (this spec) and use it with your family for a few months. The MVP already keeps the door open: families are separate "organizations", all data is per patient, settings are per family, and there's an audit log and consent records. Turning it into a sign-up service later is a separate project, not a rewrite.*
2. **How should phones connect to MediTrack?** It runs on your home computer. A secure connection is needed for live barcode scanning, notifications and the phone's "Share" button. Without one, everything else works: photo-based barcode scanning, document scanning, fax PDFs (by download) and live updates. The app works with all four options; start with 1 and switch later.

   | | 1. Home Wi-Fi only (as today) | 2. Private network app | 3. Security certificate on each phone | 4. Public web address |
   |---|---|---|---|---|
   | Day to day | Home only. Barcodes by photo. **No notifications** (so no "a provider emailed you" alerts). | Home and away. Everything works. | Home only. Everything works. | Anywhere. Everything works. |
   | What gets installed | Nothing. | A free app (e.g. Tailscale) on the home computer and **every phone**, including each nurse's. | A security file on the computer and **every phone**; several steps on iPhone; repeat for each new nurse. | Nothing on phones; a small program on the home computer. |
   | Cost | Free | Usually free for a family; check the plan's limits if many people need access. | Free, but needs someone comfortable with tech settings. | Roughly $10-20 a year for a web address, or a monthly hosting fee. |
   | Main downside | No notifications; not encrypted on Wi-Fi. | Nurses must agree to install an app. | Fiddly; redo for every new phone. | Reachable from the internet (sign-in still protects it); a company in the middle carries the traffic. Also the first step toward a sign-up service. |

   *Default: option 1 until you decide; option 2 recommended. Because "notify me when providers email" is part of the goal, option 1 alone won't meet it.*
3. **Invites only for now?** You asked that a nurse could request access and you'd accept or deny it. To keep things simple, the MVP has only invites: you send a code or link, they're in, and you can remove them with one tap. *Default: invites only; "request to join" later.* OK?
4. **Two access levels instead of many switches?** *Default: "Full access" (same as you; the default for family and nurses) or "Care only" (supplies, phone/fax numbers, tasks; no insurance, documents, email or AI), plus one switch to keep someone out of email & fax.* Enough for now?
5. **What should AI permission cover?** *Default: two switches, both off, set only by you as patient admin. "Medical info" covers diagnoses, equipment, notes, supply list and document names. "Personal & insurance info" covers name, birth date, address, insurance numbers and care team.* Right split?
6. **Resupply schedule** (allowed quantity per month, next order date): now or later? *Default: later.*
7. **Sign-out time:** *Default: 12 hours of inactivity for everyone.* OK, or should nurses be signed out sooner?
8. **Documents for "Care only" people:** *Default: they can't see documents.* Should they be able to view (not send) doctor's orders?
9. **Siblings and providers:** enter a shared pharmacy or supply company once for the household, or per child? *Default: per child (provider emails still notify for every child who has that provider).*
10. **Call scripts:** *Default: the child's name, never "he/she".* Keep?
11. **Starter supply list:** OK to offer the existing 35 trach / vent / G-tube items with counts at 0 and no alerts?
12. **Nurses who work for two families:** two separate logins on two home installs. OK until there's a sign-up service? (In a sign-up service, one login could cover both.)
