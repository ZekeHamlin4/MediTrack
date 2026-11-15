# MediTrack Design Spec

## 0. Goal and core design principle (read first)

**Goal (owner's words):**
> "A single portal where families keep all their doctors and DME/supply companies (phone, fax, email), get notified when providers email them, have the AI write emails and faxes, and get help solving problems with those providers. Eventually other families should be able to sign up."

**Principle (owner's words):**
> **MediTrack must stay very simple.** It is for a tired parent of a medically complex child. Every common task (find a number, send an order, reply to a DME email) must take as few taps as possible. Anything that doesn't serve that goes under Later features.

How the builder applies these:
- **MVP rule:** a feature is in the MVP only if it (a) serves the goal and makes a common task faster, or (b) is needed for safety, privacy or running a hosted service responsibly. Everything else is in section 6 (Later).
- **Defaults instead of settings.** Every setting and every extra choice must earn its place.
- **One obvious button per screen**, in thumb reach. Secondary actions go in "…".
- **Never cut for simplicity:** sign-in and recovery, hashed secrets, server-side permission checks, per-family data isolation, AI consent, the stock log, encryption, backups.

### How the MVP covers the goal
| Goal part | Covered by |
|---|---|
| Single portal for all doctors and DME/supply companies | Care Team per patient: phone, **fax**, email for every provider and department, with **Call**, **Copy**, **Email…**, **Fax…**. Works on any phone or computer through one web address (M14). |
| Notified when providers email | Core event, on by default: a push whenever **any** email arrives from a known provider address (M12, M17). |
| AI writes emails and faxes | Email drafts sent from the family's own address; fax drafts as a PDF (cover sheet + letter + documents) sent with the family's fax app until built-in fax (Later). Nothing goes out without a human tap. |
| Help solving provider problems | Assistant with care-team lookup, call scripts, step-by-step tasks, provider emails, documents ready to send. |
| **Other families can sign up** | **Now the target** (owner decision, revision 6): a hosted multi-family service, rolled out in phases (section 2). |
| Supplies, scanning, low-stock alerts, live stock | Kept: owner-requested, and they feed the most common DME task (knowing what to reorder). |

### Target tap counts (from Home, signed in, patient selected)
| Common task | Taps | Path |
|---|---|---|
| Find a provider's number (phone or fax) | **0-1** | Home "Quick contacts" (up to 4 favorites) or **Care Team** (1). |
| Call a provider | **1-2** (+ phone's call confirm) | Home quick contact **Call** (1), or **Care Team** → **Call** (2). |
| Email an order already in the app | **4** | **Care Team** (1) → **Send order** (2) → **Send** (3) → confirm (4). |
| Fax an order (until built-in fax) | **5** | **Care Team** (1) → **Send order** (2) → **Fax** (3) → **Share** to fax app (4) → **Mark as faxed** (5). |
| Scan a new order and send it | **≤ 7** | **Scan document** (1) → pages (2) → **Done** (3) → **Save** (4) → **Send to [last DME]** (5) → **Send** (6) → confirm (7). |
| Read and reply to a provider email | **3-4** | Push or Home "Waiting on you" (1) → **Draft reply** / **Reply** (2) → **Send** (3) → confirm (4). |
| Approve an assistant draft | **3** | Home draft (1) → **Send** (2) → confirm (3). |
| Log supply use / restock | **2** | **Supplies** (1) → **−1** / **+** (2); or **Scan supply** (1) → **Used** (2). |
| Check stock | **0-1** | "Running low" on Home, or **Supplies** (1). |

Used/Restocked taps save immediately with a 5-second **Undo**. Sending email has one confirm.

---

Status: **revision 6.** New in this revision:
- **target is now a hosted sign-up service** (phased)
- **everyone linked to a patient gets everything**; the patient admin is the only special role
- joining by **invite or by request** (exact name + DOB, privacy-safe)
- a path to a real phone app

Owner decisions kept from earlier rounds:
- goal and simplicity principle
- phone-first design
- per-patient AI consent
- several patients per user
- one patient admin
- live updates
- push notifications
- documents
- fax drafts

Remaining questions are at the end.
Scope: evolve the existing code. Do not rewrite it. Reuse components, endpoints and tables wherever possible.

---

## 1. Current state

**Stack**
- Server: Node 22+, Express 4, `better-sqlite3` (`server/meditrack.db`), `nodemailer` (SMTP), `imapflow` (IMAP), `@anthropic-ai/sdk`.
- Client: one page (`client/index.html` + `client/care.jsx`). React 18 development build, Babel standalone (JSX compiled in the browser) and Quagga, all from public CDNs.
- A **home-computer app**: started with `Start MediTrack.bat` / `.command`; phones use `http://<LAN-IP>:3000`. One child per install. Email settings install-wide in `.env`.
- The assistant uses a beta request header (`server-side-fallback-2026-07-01`) and the web search tool.

**Screens:**
- Setup wizard (family info → care team via manual entry or NPI search, which returns phone and fax)
- Care Team (cards with phone/fax/email/account #, departments, scripts, favorites)
- Assistant (chat; Outbox; Inbox)
- Tasks
- Dashboard
- Supplies
- Scan (barcode; free "Logged by")
- Portal (read-only supplies, not enforced)
- Activity
- Users

**Data:** `users`, `supplies`, `scan_log`, `patient_profile`, `providers`, `tasks`, `outbox`. First start seeds 5 demo users (plain-text PINs) and 35 demo supplies.

**No** login, permission checks, documents, attachments, fax output, provider-email alerts or live updates.

---

## 2. Target: a hosted multi-family service, in phases

### What "hosted service" means here
- MediTrack runs on a server on the internet at one HTTPS address (e.g. `app.meditrack…`). Phones and computers use it from anywhere. **HTTPS is always on**, so live barcode scanning, push notifications and the phone share sheet work everywhere. (The earlier "how should phones connect" question is settled.)
- Each family is a separate **family account** (`organizations` row). Data is isolated per family and per patient.
- Families sign up themselves, verify their email, connect their own email account, and invite their nurses.
- The owner runs the service as **service operator**: keeps it running, handles support, but has **no access to patient information** through the app.

### Phased plan
| Phase | Who uses it | What must be true |
|---|---|---|
| **1. Private beta** | The owner's family and the people they invite. Sign-up is closed (invite-only accounts). | All MVP items (section 5). Hosting and AI under signed BAAs (section 9). Encryption at rest and in transit, backups, audit log. Email verification and password reset. Import from the home app. Installable phone web app with push. |
| **2. Open sign-up** | Any family (US only to start; Open decision 5). | **Gate: before strangers can sign up, all of these are true:** (1) Terms of Service and Privacy Policy, reviewed by a lawyer. (2) Written risk assessment and breach-response plan. (3) BAAs in place with every vendor that handles health data. (4) Email connection by OAuth for Gmail and Outlook, with Google's app verification and security assessment passed (section 9). (5) 2-step sign-in available to all and required for operators. (6) "Download my family's data" and "Delete my family account". (7) Abuse protection on sign-up (rate limits, email verification, bot check). (8) Monitoring and alerting, a support email, and a tested restore. (9) A decision on pricing and AI usage limits (Open decision 3). An outside security test is recommended. |
| **3. Grow** | More families; possibly agencies. | Billing (if paid), native iOS/Android apps (section 10), built-in fax sending, agency features. |

### What happens to the current home-computer app and its data
- The home-computer mode is **retired** after the move. The code can still run locally for development only; the launchers move to a developer section of the README.
- **Import:** in the hosted app, **Patient profile → "…" → Import from home MediTrack**.
  - The patient admin uploads the `meditrack.db` file from the home computer's `server` folder.
  - The server opens it read-only and imports into a **new patient** in the importer's family:
    - profile
    - providers (with departments, fax, account numbers)
    - supplies (with current quantities and barcodes)
    - scan history (people shown as "Imported: Day Nurse")
    - tasks
    - unsent drafts
  - Old user accounts and PINs are **not** imported.
  - The uploaded file is deleted right after import. A summary screen shows counts, and the import is audited.
- After a successful import, the app shows: "Stop the home MediTrack and delete `server/meditrack.db` from that computer; it contains health information."
- Supported source: the current schema (v0). Any home install updated before the move is imported the same way.

### Simplicity audit, re-run for the hosted target
| Change | Why |
|---|---|
| **Removed:** connection-method options, setup code, launchers, local backup/restore buttons, "computer admin" settings screen | Hosting replaces them; the operator handles backups. |
| **Removed:** access levels ("Full access / Care only") and the "Email & fax" switch | Owner: "Everyone gets everything." Fewer decisions. |
| **Added (safety/hosting):** email verification, password reset, per-family isolation tests, encrypted email credentials, operator console (minimal) | Required to run a service for strangers. |
| **Added:** request to join by exact name + DOB | Owner request; designed so it reveals nothing (M4). |
| **Moved into MVP:** pre-compiled client bundle | Faster on phones, allows a strict security policy, and needed for the future native app. |
| **Inbox narrowed:** MediTrack shows only emails from known providers, never the whole mailbox | Simpler, and keeps personal email private. |
| **Kept from revision 5's cuts:** no conflict-resolution screen, no event replay, no audit viewer, two notification switches, no patient search | Same reasons as before. |
| **Phase 2 gate, not Phase 1:** OAuth email with Google verification, 2-step sign-in, data export/delete, terms/privacy | Needed before strangers; not needed for the owner's family beta. |
| **Later:** billing, native apps, built-in fax, Postgres, document object storage | Not needed until there are many families. |

---

## 3. Users and roles

**Everyone linked to a patient gets everything** (owner decision). Anyone linked (family or nurse) can see and do everything for that patient: medical info, insurance numbers, documents, the care email, the assistant, supplies, tasks, the care team.

> **Plain-words note (show in the app):** "Everyone you add can see and do everything for [first name]: medical information, insurance numbers, documents and the care email. Only add people you trust with all of it."

This note appears on the **Invite** screen, the **Accept request** sheet, and the invitee's **Accept invite** screen (worded for them: "You'll be able to see everything for [first name], including medical and insurance information.").

| Role | Who | Can |
|---|---|---|
| **Member** (title shown, e.g. Mom, Dad, Nurse, Home health aide) | Anyone linked to a patient | Everything for that patient, except the admin-only actions below. |
| **Patient admin** (exactly one per patient) | Whoever created the patient profile, or someone it was transferred to; can be a parent, the patient (18+), or a nurse | Everything, plus **only the admin can:** add (invite) and remove people; accept/deny access requests; turn access requests on/off; give or withdraw AI consent (as the patient or the patient's representative); transfer admin. As the family account owner, also: connect the family email, import from the home app, permanently delete documents, archive the patient. |
| **Service operator** | The owner and any support staff | Run the service: unlock/disable accounts, patient-admin recovery, service settings, backups. **No patient data through the app.** Must use 2-step sign-in. |
| Doctor | No login (reserved role value) | Receives documents, letters and the usage report by email or fax. |

Accounts are for **adults (18+)**. A patient under 18 is managed by a parent or guardian.

---

## 4. Gaps and problems (in the current code)

### 4a. Security
1. No login; anyone who reaches the app sees and changes everything and can send email as the parent.
2. No permission checks on any endpoint.
3. `app.use(cors())` lets any website read health data and trigger sending.
4. Plain-text PINs, known demo PINs, never checked.
5. Anyone can log as anyone ("Logged by").
6. Plain HTTP.
7. Unpinned CDN scripts; in-browser Babel (needs `unsafe-eval`).
8. AI data sharing is implicit. The assistant uses a **beta header and web search**, which may not be covered by Anthropic's BAA (section 9).
9. Server trusts client-sent chat history.
10. Email passwords sit in plain text in `.env`; a single mailbox serves the whole install.

### 4b. Bugs
1. Deletes that fail still show "deleted" (`api` helper ignores `r.ok`).
2. Inline quantity edits overwrite and aren't logged.
3. No live updates.
4. UTC timestamps parsed as local time.
5. Profile and tasks not editable; step ticks overwrite the list.
6. Hard-coded categories.
7. "My son"/"his" in scripts.
8. Demo data seeded.

### 4c. Missing for the goal
1. No provider-email alerts.
2. No fax output.
3. No documents.
4. Not usable by other families: no accounts, no isolation, no hosting.
5. Phone layout: 9 tabs; small buttons.

---

## 5. MVP feature list (Phase 1 build)

Build in this order. Everything here ships in the private beta. Items marked **[Gate]** must also be finished before Phase 2.

**M1. Data foundation and per-family isolation**
- `PRAGMA user_version` + numbered migrations (section 8). Fresh databases have no demo data.
- **Isolation:**
  - every patient belongs to one family account (`organizations`)
  - every patient-scoped table has `patient_id`
  - every route under `/api/patients/:pid/…` passes a membership check before any query
  - family-level routes (email connection, import) check that the caller is a patient admin in that family
- **Isolation tests (required, in CI):** for every route, a member of family A gets **404** for family B's patients, documents, drafts and provider emails.
- Users are not tied to one family: a nurse can be linked to patients in several families with one login.

**M2. Accounts, sign-in and recovery**
- **Sign up:** name, title (display only), email, password (min 10 characters; checked against a common-password list) → **verify email** (6-digit code or link, 30 min). Nothing patient-related works until the email is verified.
  - Phase 1: sign-up only via an invite link, or an operator allowlist.
  - Phase 2: open.
- **Sign in:** email + password.
- **Quick PIN (optional):** after signing in on a phone, the user can set a 6-digit PIN for that device. On that device, after 12 h idle, the app asks for the PIN instead of the password. 5 wrong PINs → full sign-in required.
  - This replaces the earlier "PIN *or* password" choice, because a PIN alone is too weak for an internet service (Open decision 1).
- **Recovery:** "Forgot password" → email link (one-time, 30 min) → new password. All other sessions are signed out. Changing the email address requires verifying the new address.
- **Lockout:** 5 failed passwords → 15 min; per-IP limits.
- **Secrets:** scrypt with per-user salt; reset and verification tokens stored hashed; never returned by the API.
- **Sessions:**
  - web: `HttpOnly`, `Secure`, `SameSite=Lax` cookie (Lax so email links work)
  - native later: bearer token (section 10)
  - lifetime: 12 h idle, 30 days max, and the device PIN extends it
  - list and sign out other devices in My profile
- **[Gate] 2-step sign-in:** an emailed code at sign-in on a new device, available to everyone and required for operators.
- Accounts are 18+ (checkbox at sign-up). Accounts are deactivated, not deleted, except under "Delete my account" ([Gate], M16).

**M3. Permissions: everyone gets everything + one patient admin**
- `patients.admin_user_id` = the one patient admin. Members are rows in `patient_members` (role label: `self`, `family`, `nurse`; `doctor` reserved).
- The server checks only "is a member" or "is the patient admin" (the admin-only list in section 3).
- Remove `cors()`. Allow cross-origin only for the future native app origins with bearer tokens. Add an origin check on state-changing cookie requests.
- Errors: 401 when not signed in, 403 for admin-only actions, 404 for anything outside the caller's patients.
- *Owner decision:* no access levels or per-person switches. Could be added later if a family asks.

**M4. Joining: invites (main path) and access requests**
*Invite (simplest, recommended in the UI):*
1. Patient admin: **Members → Invite someone** → optional label ("Night nurse") → the trust note → **Create invite** → QR code, code (8 characters), link, **Share**.
2. Invitee opens the link → signs up (verify email) or signs in → "[Admin name] invited you to [first name]'s care team." + trust note → **Accept** → in.
- Single-use, expires in 72 h, stored hashed.
- The admin gets "someone joined your care team"; the newcomer is highlighted with **Remove** for 7 days.

*Access request (find by exact name + date of birth):*
- **Where:** "No patients yet" → **Ask for access** → patient's **first name**, **last name**, **date of birth** (all required), optional message ("Night nurse from Sunrise Home Health") → **Send**.
- **Same answer every time:** "Request sent. If a patient with exactly these details exists and their admin accepts requests, the admin will see it." The answer is identical whether or not a match exists, and is returned at the same speed: matching runs in a background job after the response.
- **Exact match only:**
  - first name, last name and DOB are normalized (trim, lowercase, collapse spaces, strip accents and punctuation) and compared with the patient's stored first/last name and DOB
  - no partial matches, no lists, no "did you mean", no search
  - if several patients match (rare), each one's admin is asked
- **Nothing is revealed before acceptance:**
  - the requester's list shows only what they typed ("J. Smith, sent 3 Nov"), status **Waiting**
  - a denied, blocked or unmatched request looks exactly the same and becomes **"No response"** after 14 days
  - **denials are never notified**, because a denial would confirm the patient exists
  - only acceptance shows anything: the patient appears in the requester's list, and they get "you've been given access"
- **Limits:**
  - verified email required
  - 3 requests per account per day, 10 per 30 days, plus per-IP limits
  - the same details twice count once
  - the requester can cancel
- **Storage:** the typed details are stored only as a keyed hash (HMAC with a server secret) plus a short display hint (first initial + last name) for the requester's own list. Unmatched requests are purged after 30 days.
- **Admin side:**
  - push "someone asked to join your care team"
  - **Members → Requests** card: requester name, title, verified email, message, date, and the trust note
  - **Accept** / **Deny** / **Block this person** (all silent to the requester except Accept)
- **Admin setting "Allow access requests": default ON.** Justification:
  - the owner wants nurses to find a patient this way
  - the same answer every time, silent denials and exact-match-only mean an outsider learns nothing whether it is on or off
  - the remaining risk is unwanted requests reaching the admin, which rate limits, Block and the off switch handle
  - with requests off, the response is still the same, so turning it off reveals nothing either
- **Audit:** every request (requester, time, matched or not, but never the typed details in readable form), accept, deny, block.

*Removing, leaving, transfer, recovery:*
- **Remove** (admin only) takes effect immediately, including live screens. Members can **Leave**, except the admin.
- **Transfer admin** (admin only): Members → person → **Make patient admin** → they **Accept** → switched. The old admin stays as a member. The new admin is asked to review AI consent. Audited.
- **Recovery** (admin gone or lost access): the family contacts support. The operator verifies the request using the existing members' verified emails, then reassigns admin to an **existing member**, with a written reason. Audited; all members see "Admin reassigned by MediTrack support on [date]". The operator cannot add new people or make themselves a member.

**M5. Patient switcher**: patient chip in the header and on Scan sheets → list → switch. The current patient is in the URL (`/p/12/supplies`). 0 patients → "No patients yet" (**Enter invite code**, **Ask for access**, **Create a patient profile**).

**M6. Stock log**
- Quantities change only via movements (`add`/`remove` as +/- in SQL; `check`/`adjust` with before/after).
- Every movement is logged with the user. `PUT` cannot change `quantity`. No "Logged by" dropdown. Archive instead of delete.

**M7. Live updates**
- Server-Sent Events per open patient (`/api/patients/:pid/events`) and per user (`/api/me/events`).
- Events carry ids and minimal fields; clients refetch through checked endpoints. Heartbeat 25 s. Removal closes the stream.
- Reconnect → refetch the current screen.
- Simultaneous edits: `version` check → "Sam (Night nurse) just changed this. Your screen is updated. Please make your change again."
- Task steps are ticked individually.
- Hosting note: SSE needs a host that allows long-lived connections. One app instance in Phase 1 (in-memory publish/subscribe). With more than one instance (Later), add a shared pub/sub (e.g. Postgres LISTEN/NOTIFY or Redis).

**M8. Bug fixes from 4b.** Call scripts use the child's name, no pronouns (Open decision 8).

**M9. Adding a patient**
- Any verified user can create a patient profile and becomes its patient admin. The first patient also creates their family account; further patients go into the same family by default.
- Wizard:
  1. **For me / for someone I care for**, then first name, last name, DOB, other details
  2. Care team
  3. Supplies (starter list or empty; choose alert items)
  4. **Connect your care email** (optional; M12)
  5. Done

**M10. Scanning on phones**: live camera barcode scanning (HTTPS everywhere). The "take a photo" fallback stays for phones that refuse camera access.

**M11. Documents**: as in revision 5.
- capture by camera, multi-page, cleaned up on the phone, combined into one PDF on the server
- upload PDF/JPEG/PNG; 20 MB, 30 pages
- tags (purpose, doctor, date, title, renew-by); filters; newest first
- **Send order** from Care Team; **Send to…** from a document; email or fax draft
- assistant sees metadata only, with clinical consent
- Recently deleted for 30 days; permanent delete by the admin
- audited
- Hosted storage: Phase 1 keeps files in the database (encrypted disk, included in backups). Moving to encrypted object storage is Later, when size requires it.

**M12. Family email connection, provider messages and the assistant**
*Connecting the family's email* (patient admin, once per family):
- **Phase 1 (beta):** the existing IMAP/SMTP code with an app password, entered in the app.
  - The password is stored **encrypted** (app-level encryption with a key held outside the database, e.g. in the host's secret store or a KMS).
  - Reason: Google limits unverified apps to 100 test users, and reportedly expires their sign-in after 7 days (needs re-checking), which would force weekly reconnects in the beta.
- **[Gate] Phase 2: OAuth only**, so no passwords are stored:
  - **Sign in with Google** (Gmail API): reading mail is a Google "restricted scope", which requires app verification and an annual third-party security assessment (CASA) before more than 100 users.
  - **Sign in with Microsoft** (Graph `Mail.Read`, `Mail.Send`): reportedly works for personal Outlook.com accounts without publisher verification, though verification removes a warning.
  - Other providers (Yahoo, iCloud) keep the encrypted app-password option.
- **Recommendation shown at connect time:** use a separate email address just for care and supply companies.

*What MediTrack shows and stores:*
- MediTrack shows **only emails from known providers** (matched to a patient's care team), never the rest of the mailbox.
- It stores sender, subject, Message-ID and match results; bodies are fetched on open and not stored.
- Replies and new emails go out from the family's own address.

*Provider-email alerts (core, on by default):*
- The server checks each connected mailbox every 5 minutes.
- Matching: exact provider or department email; provider domain except free-mail domains.
- Each match:
  - shows on Home under "Waiting on you"
  - sends a push "MediTrack: a provider emailed you." to that patient's members
- The AI never runs on incoming mail by itself.

*Fax drafts:*
- A fax draft becomes one PDF: cover sheet with a confidentiality notice + letter + documents.
- **Share** to a fax app, then **Mark as faxed**.
- Built-in fax sending is Later; the draft model is ready for it.

*Assistant:*
- **Consent:** set by the patient admin (as the patient or representative), per patient, off by default, two scopes: `clinical`, `identity_admin`.
- **Tools:** `draft_email`, `draft_fax`, `list_documents`, and inbox tools limited to provider emails.
- **Problem-solving guidance** in the system prompt.
- **Confirm card** before the assistant changes a provider.
- **Server-side conversation;** background jobs with an "assistant has an update" push.
- **BAA requirements** (section 9): use only features on Anthropic's HIPAA-eligible list. **Remove the `server-side-fallback` beta header and the `fallbacks` parameter, and turn web search off by default**, unless Anthropic's eligibility table lists them. A HIPAA-ready organization rejects ineligible features with an error, so the code must not depend on them.

**M13. Pre-compiled client and web app shell**
- Replace in-browser Babel and CDN scripts with a small build step (esbuild) producing pinned, local bundles. This allows a CSP of `'self'` without `unsafe-eval`, and the same bundle is reused by the native app later.
- Add a web app manifest, icons and a service worker (installable "Add to Home Screen" app).

**M14. Phone-first navigation, Home quick actions, computer Overview** (section 7).

**M15. Printable usage report** (owner request; helps with provider and insurance problems).

**M16. Operator console and data lifecycle**
- **Operator console** (2-step sign-in required, no patient data shown):
  - accounts: search by email, unlock, disable, force sign-out
  - patient-admin recovery (M4)
  - service settings: sign-up open/closed, assistant on/off, web search on/off
  - health page: queue, mailbox-check errors, backup status
- **Backups:** handled by the host (section 9), not a button.
- **[Gate] Download my family's data:** patient admin; ZIP of JSON + documents, emailed link valid 24 h.
- **[Gate] Delete my family account / my account:** confirm with password; data deleted within 30 days; backups age out within the backup retention window. Stated in the privacy policy.

**M17. Audit log (written)**
- Append-only, per family and patient. Logs sign-ins, failures, lockouts, password resets; invites, requests, accepts, denials, removals, transfers, recoveries; profile edits; AI consent; document views/downloads/sends; emails and faxes; imports, exports, deletions; and operator actions.
- No viewer in MVP. The operator can export a family's log on request (support or legal).

**M18. Push notifications** (web push in the installed web app)
- **Events:**
  - **provider emailed you** (core, on)
  - **assistant has an update** (on)
  - **low stock** for items with "Alert when low" (on)
  - **someone joined / asked to join / admin transfer** (always)
- **Text is always generic**, with no patient, provider, item or health details.
- **Settings:** two switches per patient: **Provider messages**, **Low stock**.
- **iPhone:** web push works only after the user adds MediTrack to the Home Screen (iOS/iPadOS 16.4 or later), and permission can only be requested after a tap.
  - The app shows a one-time **"Get notifications on iPhone"** card with 3-step instructions (Share → Add to Home Screen → open from the icon → **Turn on notifications**).
  - Android Chrome works from the browser or the installed app.
- **Sending is abstracted** (`notify(user, event)` → web push now; APNs/FCM later), so the native app needs no server rewrite.

New server dependencies: `multer`, `pdf-lib`, `web-push`, `esbuild` (build only); later `googleapis` / `@microsoft/microsoft-graph-client` for OAuth email.

---

## 6. Later features

- **Native iOS/Android apps** (section 10).
- **Billing and plans** (Phase 3; Open decision 3).
- **Built-in fax sending** via a fax service that signs a BAA (verify vendor); email-to-fax.
- Access levels or per-person switches, *could add if a family needs it*.
- Managed PostgreSQL and more than one app instance; documents in encrypted object storage.
- Agency/clinic accounts (staff management, organization admins).
- Doctor login.
- Faster email alerts (push from Gmail/Graph instead of 5-minute checks).
- Document auto-crop; assistant reading document contents (clinical consent); renewal reminders.
- Resupply schedule (Open decision 7); expiry/lot numbers; go-bag checklist; one-tap reorder of all low items.
- Task assignment; shift notes; offline mode; persisted chats (opt-in); email notification fallback for people without push.

---

## 7. Screens

**Navigation (phone):** bottom bar **Home · Supplies · Care Team · Documents · Assistant**.
- Tasks open from Home and the menu.
- Header: patient chip, live dot, menu (**My profile**, **Patient profile**, **Members**, **Tasks**, **Usage report**, **Sign out**).
- **Computer:** the same items in a top bar, plus **Overview**.

1. **Landing / Sign in**: email, password (or device PIN), **Forgot password**, **Create account** (Phase 2; Phase 1 via invite).
2. **Create account**: name, title, email, password, "I am 18 or older", link to terms (Phase 2) → **Verify email** (code entry).
3. **Forgot / reset password**: email → link → new password.
4. **No patients yet**: **Enter invite code** · **Ask for access** · **Create a patient profile**.
5. **Accept invite**: inviter, patient first name, trust note → **Accept**.
6. **Ask for access**: first name, last name, DOB, message → **Send** → same confirmation always → **My requests** (Waiting / No response / Cancel).
7. **Home (phone)**:
   - Waiting on you (provider emails with **Draft reply** / **Reply**; drafts; faxes to send; requests and transfers for the admin)
   - Quick contacts (phone, fax, **Call**, **Send order**)
   - Running low (**−1 / +**)
   - Issues & tasks
   - **Scan supply** / **Scan document**
   - the "Get notifications on iPhone" card until push is on
8. **Overview (computer)**: Home blocks side by side; "All my patients" table when there are several.
9. **Supplies**, **Scan supply**, **Supply detail**, **History**: as in revision 5 (no access-level differences).
10. **Care Team**: phone, fax, email on every card; **Call**, **Send order**; "…" **Email…**, **Fax…**, Copy, scripts, Ask assistant, Edit, Delete.
11. **Documents**, **Scan document flow**, **Document view**, **Draft (email/fax)**: as in revision 5.
12. **Assistant**: chat; Provider emails panel (only matched emails) with **Reply** / **Ask assistant**; Outbox; consent banner.
13. **Tasks**.
14. **Patient profile**: details; "Patient admin: Name (Title)". Admin: **AI sharing**, **Connect care email**, **Import from home MediTrack**, **Archive patient**, **Download family data** [Gate].
15. **Members**: list (admin badge, titles).
    - **Admin:** **Invite someone** (trust note), **Requests** (Accept / Deny / Block, trust note), **Allow access requests** on/off, per person **Remove** / **Make patient admin**.
    - **Others:** **Leave**.
16. **Admin transfer request**: **Accept** / **Decline**.
17. **My profile**: name, title, email (change → verify), password, device PIN, signed-in devices, my patients, notifications, **Delete my account** [Gate].
18. **Operator console** (separate area, 2-step sign-in): accounts, recovery, service settings, health.

---

## 8. Data

Migrations use `PRAGMA user_version`. Fresh hosted databases start empty. Changes from revision 5 are marked **(r6)**.

```
organizations(id PK, name TEXT NOT NULL,                     -- one per family account
  type TEXT NOT NULL DEFAULT 'household' CHECK(type IN ('household','agency','clinic')),
  created_by INTEGER REFERENCES users(id), deleted_at DATETIME,      -- (r6)
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP)

email_connections(                                          -- (r6) one per family
  org_id INTEGER PRIMARY KEY REFERENCES organizations(id),
  provider TEXT NOT NULL CHECK(provider IN ('imap','gmail','outlook')),
  address TEXT NOT NULL,
  secret_enc BLOB NOT NULL,          -- app password or OAuth refresh token, encrypted with a key held outside the DB
  imap_host TEXT, imap_port INTEGER, smtp_host TEXT, smtp_port INTEGER,   -- 'imap' only
  connected_by INTEGER NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'ok' CHECK(status IN ('ok','needs_reconnect','error')),
  last_checked_at DATETIME, last_uid TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP)

users(id PK,
  name TEXT NOT NULL, title TEXT,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE, email_verified_at DATETIME,          -- (r6)
  password_hash TEXT NOT NULL,                                                     -- (r6) scrypt$salt$hash
  is_operator INTEGER NOT NULL DEFAULT 0,                                          -- (r6) replaces computer admin
  twofa_enabled INTEGER NOT NULL DEFAULT 0,                                        -- (r6) [Gate]
  failed_attempts INTEGER DEFAULT 0, locked_until DATETIME, last_login_at DATETIME,
  adult_confirmed_at DATETIME,                                                     -- (r6) 18+ checkbox
  active INTEGER NOT NULL DEFAULT 1, deleted_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP)
  -- old columns (role, pin_hash) are not used by the hosted service

auth_tokens(id PK, user_id INTEGER NOT NULL REFERENCES users(id),                  -- (r6)
  purpose TEXT NOT NULL CHECK(purpose IN ('verify_email','reset_password','login_code','change_email')),
  token_hash TEXT NOT NULL, new_email TEXT,
  expires_at DATETIME NOT NULL, used_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP)

sessions(id TEXT PK,                                         -- random 32 bytes; stored hashed (r6)
  user_id INTEGER NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL DEFAULT 'cookie' CHECK(kind IN ('cookie','bearer')),          -- (r6) bearer = native app
  device_label TEXT, device_pin_hash TEXT,                                         -- (r6) quick PIN per device
  pin_failed INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP, last_seen_at DATETIME,
  idle_expires_at DATETIME NOT NULL, absolute_expires_at DATETIME NOT NULL)

patients(id PK, org_id INTEGER NOT NULL REFERENCES organizations(id),
  admin_user_id INTEGER NOT NULL REFERENCES users(id),
  first_name TEXT NOT NULL, last_name TEXT NOT NULL,                               -- (r6) split for exact matching
  dob TEXT NOT NULL,                                                               -- (r6) required (YYYY-MM-DD)
  match_key TEXT NOT NULL,             -- (r6) HMAC(server secret, normalized first|last|dob); indexed
  allow_access_requests INTEGER NOT NULL DEFAULT 1,                                -- (r6)
  parent_name, parent_phone, parent_email, address, city, state, zip,
  insurance_name, insurance_member_id, medicaid_id, diagnoses, equipment, notes,
  onboarded, archived, version, created_by, created_at, updated_at)

patient_members(id PK, patient_id, user_id,
  role TEXT NOT NULL CHECK(role IN ('self','family','nurse','doctor')),            -- label only
  notify_provider_messages INTEGER NOT NULL DEFAULT 1, notify_low_stock INTEGER NOT NULL DEFAULT 1,
  joined_via TEXT CHECK(joined_via IN ('creator','invite','request','import','transfer','recovery')),
  invite_id, join_request_id, added_by, version, created_at, removed_at, removed_by)
  -- (r6) access_level and email_access REMOVED: every member has full access
  -- partial UNIQUE (patient_id, user_id) WHERE removed_at IS NULL

invites(id PK, patient_id, code_hash UNIQUE, label TEXT,
  role TEXT CHECK(role IN ('family','nurse')),
  created_by, created_at, expires_at, status ('open','used','cancelled','expired'), used_by, used_at)
  -- (r6) access fields removed

join_requests(id PK,                                                               -- (r6)
  requester_id INTEGER NOT NULL REFERENCES users(id),
  details_key TEXT NOT NULL,           -- same HMAC as patients.match_key; never the typed name/DOB
  display_hint TEXT NOT NULL,          -- e.g. "J. Smith", for the requester's own list only
  message TEXT,
  matched_patient_ids TEXT,            -- JSON; filled by the background matcher; never sent to the requester
  status TEXT NOT NULL DEFAULT 'waiting'
    CHECK(status IN ('waiting','accepted','denied','blocked','cancelled','expired')),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP, expires_at DATETIME NOT NULL,   -- +14 days
  decided_by INTEGER REFERENCES users(id), decided_at DATETIME)
  -- requester API maps denied/blocked/unmatched-expired to the same 'no_response'
  -- index (requester_id, created_at); unmatched rows purged after 30 days

request_blocks(patient_id, user_id, created_by, created_at, PRIMARY KEY(patient_id, user_id))  -- (r6)

admin_transfers(id PK, patient_id, from_user_id, to_user_id,                        -- (r6, back)
  kind TEXT CHECK(kind IN ('transfer','recovery')), started_by, reason,
  status TEXT CHECK(status IN ('pending','accepted','declined','cancelled','expired')),
  created_at, expires_at, decided_at)

documents, document_files, outbox_attachments,
provider_emails_seen, ai_consents, audit_log         -- as in revision 5
  -- provider_emails_seen.org_id now references the family's email connection
  -- audit_log gains actor_kind ('member','operator','system') (r6)

settings(org_id NULL = service-wide, key, value, PRIMARY KEY(org_id, key))
  -- service-wide: signups_open, assistant_enabled, assistant_web_search, vapid keys

push_subscriptions(id PK, user_id,
  platform TEXT NOT NULL DEFAULT 'webpush' CHECK(platform IN ('webpush','apns','fcm')),   -- (r6) native-ready
  endpoint_or_token TEXT NOT NULL UNIQUE, keys_json TEXT,
  created_at, last_success_at)
```

**Changed existing tables** (as in revision 5):
- `supplies`, `scan_log`, `providers`, `tasks` and `outbox` get `patient_id` and `version`.
- `outbox` also gets `channel` (`email`/`fax`), `to_fax`, `to_name`, `sent_via`, `in_reply_to`, `created_by`, `sent_by`.
- `supplies` also gets `alert_enabled` / `alert_sent_at`; barcodes are unique per patient.

**Import mapping (home v0 → hosted):**
- `patient_profile` → `patients`; `child_name` is split into first/last, and the importer confirms the split and the DOB on the summary screen.
- `providers`, `supplies`, `tasks` → the new patient.
- `scan_log` → with `user_id` NULL and `reason` "Imported: [old user name]".
- `outbox` drafts → drafts; sent items → sent history.
- `users` → not imported.

---

## 9. Privacy, security, HIPAA, legal and cost

### Security baseline (all phases)
- **Encryption in transit:** HTTPS only (HSTS); TLS for database, email and AI connections.
- **Encryption at rest:** encrypted disk/volume for the database and backups (host-provided). Email credentials and OAuth tokens are also encrypted at app level with a key outside the database.
- **Access control:** per-family isolation (M1) with tests; member/admin checks (M3); operator has no patient-data access in the app.
- **Access logging:** audit log (M17); host access logs; no PHI in application logs or error reports.
- **No third-party trackers or analytics** in the app (no ad pixels, no session replay). Health apps have been penalized by the FTC for sharing data with advertisers.
- **Headers and policies:**
  - CSP `'self'` (no `unsafe-eval` after M13), `nosniff`, `Referrer-Policy: no-referrer`, `frame-ancestors 'none'`
  - uploads checked by content
- **Push text is generic**, so push services never see health details.

### Hosting and backups
**Requirement:** a host that **signs a BAA** and offers encrypted disks, private networking, automated encrypted backups, and long-lived connections (for live updates).

**Options** (verify current terms before signing):

| Option | BAA | Effort for the owner | Notes |
|---|---|---|---|
| **Managed platform with a HIPAA plan, e.g. Render HIPAA workspace** | Yes: self-serve BAA from workspace settings | Lowest | Reported pricing is a 20% surcharge on compute with a $250/month minimum on older plans, and no minimum on newer plans. Sources disagree on which plan is needed, so **verify**. Enabling HIPAA on a workspace is irreversible. |
| **AWS** (e.g. EC2 + encrypted EBS + S3 for backups) | Yes: accepted in AWS Artifact; covers only "HIPAA-eligible" services | Higher; needs someone technical | Use only services on AWS's eligible list. Lightsail is reportedly **not** eligible: **verify**. SES (for sign-up emails) eligibility: **verify**. |
| Google Cloud / Azure | Both are widely reported to offer BAAs: **verify** | Higher | Similar to AWS. |
| HIPAA-specialist platforms (e.g. Aptible) | Yes (their business model) | Low | Typically more expensive: **verify pricing**. |

**Recommendation:** Phase 1 on a managed platform with a BAA, to keep it simple for a non-technical owner. Keep SQLite on one instance with an encrypted persistent disk, plus continuous encrypted off-site replication (e.g. Litestream to BAA-covered object storage) and daily snapshots kept 30 days. Test a restore monthly. Move to managed PostgreSQL (Later) when more than one instance is needed.

### HIPAA in plain words
- **Does HIPAA legally apply?** Probably **not**, as long as families sign up directly for their own use. HIPAA applies to doctors, insurers and billing clearinghouses, and to companies working *for* them under a BAA. It would apply if an agency or clinic used MediTrack for its patients. **Confirm with a lawyer.**
- **What applies instead:** the **FTC Health Breach Notification Rule**. Since 2024 it explicitly covers health apps not covered by HIPAA. After a breach, MediTrack must notify affected people and the FTC without unreasonable delay and within 60 days, and penalties are large. Unauthorized *sharing* (not just hacking) counts as a breach. **State health-privacy laws may also apply; a lawyer should check which.**
- **The owner wants HIPAA-level protection anyway.** That means:
  1. **BAAs** with every vendor that stores or processes health data:
     - **hosting** (required)
     - **AI**: Anthropic (required)
     - **email:** the family's own Gmail/Outlook is their account, not a MediTrack vendor. Sign-up/reset emails contain no health data, so a BAA is not strictly needed there. If a vendor might see health data, use one that signs a BAA.
     - **push services:** Apple/Google don't sign BAAs, as far as known, so send only generic encrypted text. This position should be confirmed by a lawyer.
     - **error monitoring/logging:** only if it can receive health data
  2. **Encryption** at rest and in transit (above).
  3. **Access logging** (audit log).
  4. A **written risk assessment**, updated yearly and when things change.
  5. A **breach response plan** (who decides, who is notified, within what time).
  6. **Minimum necessary:** operators don't see patient data; logs carry no health details.
  7. Staff training and written policies once there is staff.

### AI vendor (Anthropic)
- Anthropic offers a BAA for the Claude API through its sales team. A dedicated "HIPAA-ready" API organization is provisioned, and it **blocks requests that use features not covered** (returns an error).
- Covered features are listed in Anthropic's feature-eligibility table. **Beta features are generally not covered**, and the Batch and Files APIs are listed as not covered.
- Reports conflict on whether zero-data-retention is required or a separate 30-day-retention HIPAA configuration is used. **Verify on Anthropic's current page before signing.**
- **Action for the builder:**
  - remove the beta header and `fallbacks`
  - check whether web search and any other tool used are on the eligible list (web search off until confirmed)
  - keep the model set to one listed as covered

### Email providers (OAuth)
- **Google:** reading Gmail is a restricted scope. More than 100 users requires Google app verification plus an annual **CASA** security assessment by an approved assessor. Reported cost ranges from roughly $500-$1,000 a year (self-serve tier) to much more on other tracks, and it takes weeks to months. **Unverified "testing" apps** are capped at 100 users and reportedly expire sign-ins after 7 days.
- **Microsoft:** personal Outlook.com and Microsoft 365 mailboxes reportedly work with delegated `Mail.Read` / `Mail.Send` without publisher verification. Verification mainly removes a consent-screen warning. **Verify.**

### Terms of Service and Privacy Policy [Gate]
Written with a lawyer before Phase 2. They must say, in plain words:
- what is collected
- that the AI provider processes it (only with the patient admin's consent)
- no selling or advertising use
- who can see what (everyone the admin links sees everything)
- breach notification
- export and deletion
- the 18+ rule
- **MediTrack is not medical advice and not for emergencies (call 911)**

### Cost per family (rough estimates, clearly not quotes)
| Item | Estimate |
|---|---|
| Compliant hosting, database, backups, monitoring (fixed) | ~$300-$800 / month total |
| Google CASA assessment (fixed, yearly, Phase 2) | ~$500-$5,000+ / year (estimates vary widely) |
| Lawyer for terms, privacy policy and HIPAA/FTC review (one-time) | ~$2,000-$10,000 |
| AI usage per active family | ~$1-$15 / month, depending on how much they chat and how many drafts |
| Storage, sign-up emails, push | under $0.50 / family / month |
| Apple / Google developer accounts (Phase 3) | $99/year Apple, $25 one-time Google |

At 10 families the fixed costs dominate (roughly $40-$100 per family per month). At 500 families it's roughly $2-$5 plus AI per family per month.

### Billing
**Not in MVP.**
- Phase 1 beta is free (the owner pays).
- Phase 2 can open free with an AI usage cap per family (e.g. a monthly number of assistant requests) or as a paid plan (Open decision 3).
- Billing (e.g. a card subscription) is Phase 3 / Later.

### Sources checked for this section (Nov 2026; re-verify before signing anything)
- Anthropic: [API and data retention / HIPAA-ready](https://platform.claude.com/docs/en/manage-claude/api-and-data-retention), [BAA FAQ](https://privacy.claude.com/en/articles/8114513-will-anthropic-sign-a-business-associate-agreement-baa-and-if-so-for-which-products)
- Render: [HIPAA](https://render.com/security/hipaa), [workspace plans](https://render.com/docs/new-workspace-plans.md)
- AWS: [HIPAA compliance](https://aws.amazon.com/compliance/hipaa-compliance/) (third-party guides for Lightsail status: [accountablehq](https://www.accountablehq.com/post/how-to-get-a-baa-with-aws-steps-requirements-and-covered-hipaa-services))
- FTC: [Health Breach Notification Rule final rule](https://www.ftc.gov/system/files/ftc_gov/pdf/p205405healthbreachnotificationrule.pdf)
- Google OAuth verification: [Nylas guide](https://developer.nylas.com/docs/provider-guides/google/google-verification-security-assessment-guide/), [Nango guide](https://nango.dev/docs/api-integrations/google-shared/google-security-review), [100-user limit](https://www.unipile.com/google-oauth-100-user-limit/)
- Microsoft Graph mail: [Unipile guide](https://www.unipile.com/microsoft-graph-oauth-email/)
- iOS web push: [Apple developer docs](https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers)
- App Store 4.2 and web wrappers: [Apple forums](https://developer.apple.com/forums/thread/115230), [Capgo guide](https://capgo.app/blog/how-to-pass-app-store-review-2026/)

---

## 10. Phone app path

**Recommendation:** build now as an **installable web app (PWA) with web push** (M13, M18). Wrap it later as native iOS/Android apps with **Capacitor** for App Store / Google Play and native push. The native app is in **Later (Phase 3)**.

**Why not native now:**
- The PWA already delivers notifications:
  - on Android it works from the browser
  - on iPhone it needs iOS/iPadOS 16.4+ **and** the app added to the Home Screen, which the onboarding card walks through
- App Store review adds time and risk. Apple's "minimum functionality" rule (4.2) reportedly rejects apps that are just a website in a wrapper. Push alone is often judged thin, so the native app should bundle the client and use native camera, share sheet and push from the first screen. That is worth doing once the product is stable.
- **Trigger to move it earlier:** if beta users on iPhone struggle with "Add to Home Screen" or miss notifications.

**Design rules now, so native is a wrapper, not a rewrite:**
1. **All features through the JSON API** (`/api/...`); no server-rendered pages.
2. **Auth works with cookies (web) and bearer tokens (native)** (`sessions.kind`). CORS allows only the native app's own origins, and only with bearer tokens.
3. **One client bundle** (M13), loaded by the browser and by Capacitor; device features behind small adapters:
   - camera: file input now → Capacitor Camera later
   - share: Web Share API → Capacitor Share
   - push: Web Push → Capacitor Push Notifications (APNs/FCM)
4. **Notifications through one function** `notify(user, event)` with `push_subscriptions.platform` (`webpush` | `apns` | `fcm`). Payload: `{type, patientId, path}`, no health details.
5. **Deep links use the same paths** as the web app (`/p/12/documents/5`), so a notification opens the same screen in both.

---

## 11. Visual style

**Keep** the current look: navy/blue header, white cards on light gray, colored badges, teal accent.

**Change, for phone-first simplicity:**
1. Bottom navigation; SVG icons + labels.
2. Touch targets ≥ 44px; main action at the bottom.
3. Inputs at 16px.
4. Cards on phones.
5. `--gray-700` for text.
6. One status palette with text + color.
7. Patient chip everywhere; people shown as "Name (Title)"; "Admin" badge.
8. Undo instead of confirms, except sending and permanent delete.
9. Soft highlight on others' changes.
10. Phone, fax and email on separate labelled lines on provider cards.
11. The trust note uses the orange "needs attention" style, not red. It informs; it isn't an error.
12. App icon and splash for the installed app.

---

## 12. Open decisions

Plain-language questions for the owner, most important first. Answered and removed this round: single family vs sign-up service (sign-up service), how phones connect (hosted with HTTPS), permissions (everyone gets everything), "Care only" questions, and nurses with two families (one login now works across families).

1. **Signing in:** for an internet service, a 6-digit PIN alone is too easy to guess. *Default: everyone signs in with email + password, then can set a 6-digit PIN to unlock quickly on their own phone.* OK?
2. **"Ask for access" on by default?** *Default: on. A nurse who types the exact name and birth date sends you a request, and they learn nothing unless you accept. You can turn it off.* Or should it start off?
3. **Free or paid when strangers can sign up, and who pays for AI?** *Default: the private beta is free (you pay); open sign-up starts free with a monthly limit on assistant use; paid plans come later.* What do you want?
4. **Hosting choice:** *Default: a managed platform with a health-privacy plan (simplest; roughly $300-$800 a month all-in including backups and monitoring).* Or a big cloud provider (cheaper at scale, but needs someone technical)?
5. **US only to start?** *Default: yes. The provider lookup and the privacy rules are US-based.*
6. **A lawyer before open sign-up:** the spec assumes you'll have a lawyer write the terms and privacy policy and confirm which health-privacy laws apply (FTC rule, state laws, HIPAA if agencies join). OK to plan for that (roughly $2,000-$10,000)?
7. **Resupply schedule** (allowed quantity per month, next order date): now or later? *Default: later.*
8. **Call scripts:** *Default: the child's name, never "he/she".* Keep?
9. **AI permission split:** *Default: two switches, both off: "medical info" and "personal & insurance info".* Right?
10. **Siblings and providers:** a shared pharmacy or supply company entered once per family, or per child? *Default: per child.*
11. **Starter supply list:** OK to offer the 35 trach / vent / G-tube items with counts at 0?
