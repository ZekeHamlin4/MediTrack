# MediTrack Design Spec

## 0. Goal and core design principle (read first)

**Goal (owner's words):**
> "A single portal where families keep all their doctors and DME/supply companies (phone, fax, email), get notified when providers email them, have the AI write emails and faxes, and get help solving problems with those providers. Eventually other families should be able to sign up."

**Principle (owner's words):**
> **MediTrack must stay very simple.** It is for a tired parent of a medically complex child. Every common task (find a number, send an order, reply to a DME email) must take as few taps as possible. Anything that doesn't serve that goes under Later features.

**Business model (owner's words):**
> "I truly want this to be a free app, but to get this partnered with a nursing company like Maxim. Then from there we can have a contract and I get paid through that."

MediTrack is **free for families, always**. Revenue comes from contracts with home-nursing agencies (section 10).

How the builder applies these:
- **MVP rule:** a feature is in the MVP only if it (a) serves the goal and makes a common task faster, or (b) is needed for safety, privacy or running a hosted service responsibly. Everything else is in section 6 (Later).
- **Defaults instead of settings.** Every setting and every extra choice must earn its place.
- **One obvious button per screen**, in thumb reach. Secondary actions go in "…".
- **Never cut for simplicity:** sign-in and recovery, hashed secrets, server-side permission checks, per-family data isolation, AI consent, the stock log, encryption, backups.

### How the MVP covers the goal
| Goal part | Covered by |
|---|---|
| Single portal for all doctors and DME/supply companies | Care Team per patient: phone, **fax**, email for every provider and department, with **Call**, **Copy**, **Email…**, **Fax…**. One web address on any phone or computer (M14). |
| Notified when providers email | Core event, on by default: a push whenever **any** email arrives from a known provider address (M12, M18). |
| AI writes emails and faxes | Email drafts sent from the family's own address. Fax drafts are a PDF (cover sheet + letter + documents) sent with the family's fax app until built-in fax arrives (Later). Nothing goes out without a human tap. |
| Help solving provider problems | Assistant with care-team lookup, call scripts, step-by-step tasks, provider emails, and documents ready to send. |
| Other families can sign up | Hosted multi-family service, rolled out in phases: private beta → agency pilot → public sign-up (section 2). |
| Supplies, scanning, low-stock alerts, live stock | Kept: owner-requested, and they feed the most common DME task. They are also what an agency values (section 10). |

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

Status: **revision 7.** New in this revision:
- **business model:** free for families; revenue from agency contracts
- the phase plan now puts an **agency pilot before public sign-up**
- **hosting recommendation** for the private beta
- sign-in (email + password with optional phone PIN) and "Ask for access" on by default are now **decided**

Owner decisions kept from earlier rounds:
- hosted sign-up service
- everyone linked to a patient gets everything; one patient admin
- invites + access requests
- per-patient AI consent
- phone-first design
- live updates
- push notifications
- documents
- fax drafts
- web app now, native app later

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

## 2. Target: a free, hosted multi-family service, in phases

### What "hosted service" means here
- MediTrack runs on a server on the internet at one HTTPS address. Phones and computers use it from anywhere. HTTPS is always on, so live barcode scanning, push notifications and the share sheet work everywhere.
- Each family is a separate **family account** (`organizations` row, type `household`). Data is isolated per family and per patient.
- Families verify their email, connect their own email account, and invite their nurses.
- The owner runs the service as **service operator**: keeps it running, handles support, but has **no access to patient information** through the app.
- **Free for families.** No family billing is planned, ever. Assistant use is capped per family to control cost (M12). The owner covers costs until an agency contract pays for them.

### Phased plan (revision 7 order)
| Phase | Who uses it | What must be true before it starts |
|---|---|---|
| **1. Private beta** (now) | The owner's family and the people they invite. Sign-up closed (invite-only). | All MVP items (section 5). Hosting and AI under signed BAAs (section 9). Encryption at rest and in transit, backups, audit log. Email verification and password reset. Import from the home app. Installable phone web app with push. |
| **2. Agency pilot** | One home-nursing agency (e.g. a large agency such as Maxim) with a small group of its nurses and the families they serve, who join by invite. | **[Gate] items done** (marked in section 5): terms of service and privacy policy (lawyer-reviewed); written risk assessment and breach plan; BAAs with every vendor; **a BAA signed with the agency**; 2-step sign-in; data export and account deletion; monitoring, support email, tested restore. **Agency items** (section 10): security questionnaire answered; cyber-liability insurance (likely asked; verify); agency features A1-A3; a pilot agreement with success metrics. |
| **3. Public sign-up** | Any family (US only to start). | Everything in Phase 2, plus: Google/Microsoft email sign-in (OAuth) with Google's app verification and annual security assessment passed; sign-up abuse protection (bot check, rate limits); support capacity for strangers; the AI cap tuned to what the owner (or the agency contract) can fund. |
| **4. Grow** | More agencies and families. | Native iOS/Android apps (section 11), built-in fax sending, more agency reporting, SOC 2 if agencies require it. |

**Why the agency pilot comes before public sign-up:**
1. **It is where the money is.** Families never pay; a contract is the owner's only income. Public sign-up adds costs (AI, support, Google's security assessment) with no income.
2. **Smaller, safer group.** The pilot's families are invited through nurses they already trust. The owner handles a few dozen known families instead of strangers, and fixes problems before scale.
3. **Same legal work, done once.** An agency forces the HIPAA business-associate work (BAA, risk assessment, policies) that public sign-up also needs.
4. **Proof for the next partner.** Pilot metrics (section 10) are what sell the next agency, and also justify opening to everyone.

Public sign-up can still come later, or never, if agency partnerships cover the goal "other families can sign up" (families can always join through an agency or a nurse's invite).

### What happens to the current home-computer app and its data
- The home-computer mode is **retired** after the move. The code can still run locally for development only; launchers move to a developer section of the README.
- **Import:** in the hosted app, **Patient profile → "…" → Import from home MediTrack**.
  - The patient admin uploads `meditrack.db` from the home computer's `server` folder.
  - The server opens it read-only and imports into a **new patient** in the importer's family:
    - profile
    - providers (departments, fax, account numbers)
    - supplies (quantities, barcodes)
    - scan history (people shown as "Imported: Day Nurse")
    - tasks
    - unsent drafts
  - Old user accounts and PINs are **not** imported.
  - The uploaded file is deleted right after import. A summary screen confirms counts and the name/DOB split, and the import is audited.
- Afterwards the app says: "Stop the home MediTrack and delete `server/meditrack.db` from that computer; it contains health information."

### Simplicity audit (hosted target; unchanged in r7 except billing)
| Change | Why |
|---|---|
| **Removed:** connection-method options, setup code, launchers, local backup buttons, computer-admin settings | Hosting replaces them. |
| **Removed:** access levels and the "Email & fax" switch | Owner: "Everyone gets everything." |
| **Removed (r7): any family billing** | Owner: free app for families. |
| **Added (safety/hosting):** email verification, password reset, isolation tests, encrypted email credentials, minimal operator console, per-family AI cap | Required to run a free service responsibly. |
| **Added:** access requests by exact name + DOB | Owner request; designed to reveal nothing. |
| **In MVP:** pre-compiled client bundle | Faster phones, strict security policy, reusable by the native app. |
| **Inbox narrowed** to emails from known providers | Simpler; keeps personal mail private. |
| **Gate items, not Phase 1:** OAuth email, 2-step sign-in, export/delete, terms/privacy | Needed before outsiders, not for the owner's family beta. |
| **Agency features A1-A3:** Phase 2 work, not MVP | Built once a pilot agency is lined up (section 10). |

---

## 3. Users and roles

**Everyone linked to a patient gets everything** (owner decision). Anyone linked (family or nurse, including agency nurses) can see and do everything for that patient: medical info, insurance numbers, documents, the care email, the assistant, supplies, tasks, the care team.

> **Plain-words note (show in the app):** "Everyone you add can see and do everything for [first name]: medical information, insurance numbers, documents and the care email. Only add people you trust with all of it."

Shown on the **Invite** screen, the **Accept request** sheet, and the invitee's **Accept invite** screen ("You'll be able to see everything for [first name], including medical and insurance information.").

| Role | Who | Can |
|---|---|---|
| **Member** (title shown, e.g. Mom, Dad, Nurse, Home health aide) | Anyone linked to a patient | Everything for that patient, except the admin-only actions. |
| **Patient admin** (exactly one per patient) | Whoever created the patient profile, or someone it was transferred to | Everything, plus **only the admin can:** invite and remove people; accept/deny access requests; turn access requests on/off; give or withdraw AI consent (as the patient or the patient's representative); transfer admin. As the family account owner, also: connect the family email, import, permanently delete documents, archive the patient, and (Phase 2) share with an agency (A2). |
| **Agency admin** (Phase 2, section 10) | Staff of a partner agency | Manage the agency's nurse list and see agency reports. **No patient data** unless a family has shared (A2), and even then only what that sharing allows. |
| **Service operator** | The owner and any support staff | Run the service; no patient data in the app; 2-step sign-in required. |
| Doctor | No login (reserved role) | Receives documents, letters and the usage report by email or fax. |

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
8. AI data sharing implicit; the assistant uses a **beta header and web search**, which may not be covered by Anthropic's BAA (section 9).
9. Server trusts client-sent chat history.
10. Email passwords in plain text in `.env`; one mailbox for the whole install.

### 4b. Bugs
1. Deletes that fail still show "deleted" (`api` helper ignores `r.ok`).
2. Inline quantity edits overwrite and aren't logged.
3. No live updates.
4. UTC timestamps parsed as local time.
5. Profile/tasks not editable; step ticks overwrite the list.
6. Hard-coded categories.
7. "My son"/"his" in scripts.
8. Demo data seeded.

### 4c. Missing for the goal
1. No provider-email alerts.
2. No fax output.
3. No documents.
4. Not usable by other families or agencies: no accounts, no isolation, no hosting.
5. Phone layout: 9 tabs; small buttons.

---

## 5. MVP feature list (Phase 1 build)

Build in this order. Everything here ships in the private beta. **[Gate]** = must also be done before Phase 2 (agency pilot).

**M1. Data foundation and per-family isolation**
- `PRAGMA user_version` + numbered migrations (section 8). Fresh databases have no demo data.
- Every patient belongs to one family account. Every patient-scoped table has `patient_id`. Every route under `/api/patients/:pid/…` passes a membership check before any query. Family-level routes check that the caller is a patient admin in that family.
- **Isolation tests (required, in CI):** for every route, a member of family A gets **404** for family B's patients, documents, drafts and provider emails.
- Users are not tied to one family: a nurse can be linked to patients in several families with one login (this is also what agencies need).
- `organizations.type` already allows `agency`, so Phase 2 needs no schema rebuild.

**M2. Accounts, sign-in and recovery** (decided)
- **Sign up:** name, title (display only), email, password (min 10 characters; common-password check), "I am 18 or older" → **verify email** (6-digit code or link, 30 min).
  - Nothing patient-related works until verified.
  - Phase 1: sign-up only via an invite link or an operator allowlist.
- **Sign in:** email + password.
- **Quick PIN (optional):** after signing in on a phone, set a 6-digit PIN for that device. After 12 h idle, that device asks for the PIN instead of the password. 5 wrong PINs → full sign-in.
- **Recovery:** "Forgot password" → one-time email link (30 min) → new password; other sessions signed out. Changing the email address requires verifying the new one.
- **Lockout:** 5 failed passwords → 15 min; per-IP limits.
- **Secrets and tokens:** scrypt with per-user salt; tokens stored hashed.
- **Sessions:** web cookie (`HttpOnly`, `Secure`, `SameSite=Lax`), or bearer token for the future native app. 12 h idle, 30 days max; device list with "sign out".
- **[Gate] 2-step sign-in:** emailed code on new devices, available to all and required for operators and agency admins.
- Deactivate rather than delete, except "Delete my account" ([Gate], M16).

**M3. Permissions: everyone gets everything + one patient admin**
- `patients.admin_user_id` is the one patient admin. Members are `patient_members` rows (role label: `self`, `family`, `nurse`; `doctor` reserved).
- The server checks only "is a member" or "is the patient admin".
- Remove `cors()`. Allow cross-origin only for the future native app with bearer tokens. Origin check on state-changing cookie requests.
- Errors: 401 when not signed in, 403 for admin-only actions, 404 for anything outside the caller's patients.

**M4. Joining: invites (main path) and access requests** (on by default; decided)
*Invite:*
1. Patient admin: **Members → Invite someone** → optional label → trust note → **Create invite** → QR code, 8-character code, link, **Share**.
2. Invitee opens the link → signs up (verify email) or signs in → "[Admin] invited you to [first name]'s care team." + trust note → **Accept**.
- Single-use, 72 h, stored hashed. The admin is notified; the newcomer is highlighted with **Remove** for 7 days.

*Access request:*
- **"No patients yet" → Ask for access:** first name, last name, date of birth (all required), optional message → **Send**.
- **Same answer every time**, returned at the same speed (matching runs in the background): "Request sent. If a patient with exactly these details exists and their admin accepts requests, the admin will see it."
- **Exact match only:** normalized first + last + DOB against stored values. No partial matches, lists or suggestions. If several patients match, each admin is asked.
- **Nothing revealed before acceptance:**
  - the requester's list shows only what they typed ("J. Smith"), status **Waiting**
  - denied, blocked and unmatched requests all become **"No response"** after 14 days
  - **denials are never notified**; only acceptance shows the patient
- **Limits:** verified email; 3 requests per day and 10 per 30 days per account; per-IP limits; duplicates count once.
- **Storage:** typed details kept only as a keyed hash plus a short display hint for the requester's own list. Unmatched requests are purged after 30 days.
- **Admin side:**
  - push "someone asked to join your care team"
  - **Members → Requests** card: name, title, verified email, message, trust note
  - **Accept** / **Deny** / **Block** (only Accept is visible to the requester)
- **"Allow access requests" defaults to ON** (owner confirmed).
- Every request and decision is audited (never the readable typed details).

*Remove, leave, transfer, recovery:*
- **Remove** (admin): immediate, including live screens. Members can **Leave**, except the admin.
- **Transfer admin** (admin): Members → person → **Make patient admin** → they **Accept**. The old admin stays as a member. The new admin is asked to review AI consent.
- **Recovery:** the family contacts support. The operator verifies using existing members' verified emails, then reassigns admin to an **existing member**, with a written reason. Audited and shown to members. The operator can't add people or become a member.

**M5. Patient switcher**: patient chip → list → switch. The patient is in the URL (`/p/12/supplies`). 0 patients → "No patients yet" (**Enter invite code**, **Ask for access**, **Create a patient profile**).

**M6. Stock log**: quantities change only via movements (+/- in SQL; counts with before/after). Every movement is logged with the user. `PUT` cannot change `quantity`. Archive instead of delete.

**M7. Live updates**
- Server-Sent Events per open patient and per user. Events carry ids and minimal fields; clients refetch.
- Reconnect → refetch the current screen.
- Simultaneous edits: `version` check → "Sam (Night nurse) just changed this… please make your change again." Task steps are ticked individually.
- One app instance in Phase 1 (in-memory publish/subscribe). Shared pub/sub is Later.

**M8. Bug fixes from 4b**: call scripts use the child's name, no pronouns.

**M9. Adding a patient**
- Any verified user can create a patient profile and becomes its patient admin. The first patient creates the family account.
- Wizard:
  1. For me / for someone I care for + first name, last name, DOB, details
  2. Care team
  3. Supplies (starter list or empty; alert items)
  4. Connect care email (optional)
  5. Done

**M10. Scanning on phones**: live camera barcode scanning (HTTPS everywhere). Photo fallback kept.

**M11. Documents**: as in revision 5/6.
- camera capture, multi-page; one PDF per document
- upload PDF/JPEG/PNG; 20 MB / 30 pages
- tags (purpose, doctor, date, title, renew-by); filters; newest first
- **Send order** / **Send to…** by email or fax
- assistant sees metadata only, with clinical consent
- Recently deleted for 30 days; permanent delete by the admin
- audited
- Files are kept in the database on an encrypted disk in Phase 1.

**M12. Family email connection, provider messages and the assistant**
*Email connection* (patient admin, once per family):
- **Phase 1:** existing IMAP/SMTP code with an app password, stored **encrypted** with a key outside the database.
- **Phase 3 gate (public sign-up):** OAuth only (Google and Microsoft sign-in). Other providers keep the encrypted app-password option.
- **During the agency pilot:** app passwords remain acceptable, because there are fewer than 100 families and Google's testing-mode limits apply. **Verify with the agency's security team.**
- Shown at connect time: "Use a separate email address just for care and supply companies."

*Provider messages:*
- MediTrack shows **only emails from known providers**, never the rest of the mailbox. It stores sender, subject and Message-ID; bodies are fetched on open.
- **Provider-email alerts** (core, on by default): mailbox check every 5 min; match on provider or department email, or provider domain (excluding free-mail domains). Each match shows on Home and sends "MediTrack: a provider emailed you."
- The AI never runs on incoming mail by itself.

*Fax drafts:* one PDF (cover sheet with confidentiality notice + letter + documents) → **Share** to a fax app → **Mark as faxed**.

*Assistant:*
- **Consent:** set by the patient admin, per patient, off by default; two scopes (`clinical`, `identity_admin`).
- **Tools:** `draft_email`, `draft_fax`, `list_documents`, inbox tools limited to provider emails.
- **Behaviour:** problem-solving guidance in the system prompt; confirm card before provider changes; server-side conversation; background "assistant has an update" pushes.
- **AI cap per family** (r7, cost control, because the app is free):
  - a monthly limit of assistant requests per family account (default **150 requests/month**; service-wide setting the operator can change; Open decision 3)
  - My profile and the Assistant screen show "**X of 150 assistant requests left this month**"
  - at the limit the assistant says so politely; drafts, documents, calls and everything else keep working
  - agency contracts can raise the cap for their families (A3)
- **BAA requirements** (section 9): use only Anthropic's HIPAA-eligible features. **Remove the `server-side-fallback` beta header and `fallbacks`; web search off** unless listed as eligible.

**M13. Pre-compiled client and web app shell**: esbuild bundle (no in-browser Babel, no CDNs, CSP `'self'`); manifest, icons, service worker.

**M14. Phone-first navigation, Home quick actions, computer Overview** (section 7).

**M15. Printable usage report**: helps with provider and insurance problems, and is the basis for agency reports later.

**M16. Operator console and data lifecycle**
- **Operator console** (2-step sign-in, no patient data):
  - accounts: unlock, disable, force sign-out
  - patient-admin recovery
  - service settings: sign-up open/closed, assistant on/off, web search on/off, **AI cap**
  - health page; **service metrics** (counts only: families, active users, provider emails handled, orders sent, assistant requests), used for pilots (section 10)
- **Backups** are handled by the host (section 9).
- **[Gate] Download my family's data** (patient admin; ZIP of JSON + documents).
- **[Gate] Delete my family account / my account** (data deleted within 30 days; backups age out).

**M17. Audit log (written)**: append-only, per family and patient. Logs sign-ins, failures, resets, invites, requests, removals, transfers, recoveries, profile edits, AI consent, documents, emails/faxes, imports, exports, deletions and operator actions. No viewer in MVP; the operator can export a family's log on request.

**M18. Push notifications** (web push in the installed web app)
- **Events:** provider emailed you (core, on); assistant has an update (on); low stock for alert items (on); joined / asked to join / admin transfer (always).
- **Text is always generic.** Two switches per patient: **Provider messages**, **Low stock**.
- **iPhone:** requires iOS/iPadOS 16.4+ and adding to the Home Screen; a one-time card explains the 3 steps. Android works from the browser.
- **Sending is abstracted** (`notify(user, event)`; `platform` = webpush now, APNs/FCM later).

New server dependencies: `multer`, `pdf-lib`, `web-push`, `esbuild` (build only); later `googleapis` / `@microsoft/microsoft-graph-client`.

---

## 6. Later features

- **Native iOS/Android apps** (Phase 4; section 11).
- **Built-in fax sending** via a fax service that signs a BAA (verify vendor); email-to-fax.
- More agency reporting and SSO (if agencies ask; section 10).
- Managed PostgreSQL and more than one app instance; documents in encrypted object storage.
- Access levels or per-person switches, *could add if a family or agency needs it*.
- Doctor login.
- Faster email alerts (Gmail/Graph push instead of 5-minute checks).
- Document auto-crop; assistant reading document contents (clinical consent); renewal reminders.
- Resupply schedule (Open decision 7); expiry/lot numbers; go-bag checklist; one-tap reorder of all low items.
- Task assignment; shift notes; offline mode; persisted chats (opt-in); email notification fallback.
- **Not planned:** family billing of any kind.

---

## 7. Screens

**Navigation (phone):** bottom bar **Home · Supplies · Care Team · Documents · Assistant**.
- Header: patient chip, live dot, menu (**My profile**, **Patient profile**, **Members**, **Tasks**, **Usage report**, **Sign out**).
- **Computer:** the same items in a top bar, plus **Overview**.

1. **Landing / Sign in**: email, password (or device PIN), **Forgot password**, **Create account** (invite-only in Phase 1).
2. **Create account**: name, title, email, password, 18+ checkbox, terms link ([Gate]) → **Verify email**.
3. **Forgot / reset password**.
4. **No patients yet**: **Enter invite code** · **Ask for access** · **Create a patient profile**.
5. **Accept invite**: inviter, patient first name, trust note → **Accept**.
6. **Ask for access**: first name, last name, DOB, message → **Send** → same confirmation always → **My requests**.
7. **Home (phone)**:
   - Waiting on you (provider emails with **Draft reply** / **Reply**; drafts; faxes to send; requests and transfers for the admin)
   - Quick contacts (phone, fax, **Call**, **Send order**)
   - Running low (**−1 / +**)
   - Issues & tasks
   - **Scan supply** / **Scan document**
   - iPhone notifications card
8. **Overview (computer)**: Home blocks side by side; "All my patients" table.
9. **Supplies**, **Scan supply**, **Supply detail**, **History**.
10. **Care Team**: phone, fax, email on every card; **Call**, **Send order**; "…" Email…, Fax…, Copy, scripts, Ask assistant, Edit, Delete.
11. **Documents**, **Scan document flow**, **Document view**, **Draft (email/fax)**.
12. **Assistant**: chat, "X of 150 left this month", Provider emails panel, Outbox, consent banner.
13. **Tasks**.
14. **Patient profile**: details; "Patient admin: Name (Title)". Admin: **AI sharing**, **Connect care email**, **Import from home MediTrack**, **Archive patient**, **Download family data** [Gate], **Share with agency** (Phase 2, A2).
15. **Members**: list. Admin: **Invite someone**, **Requests**, **Allow access requests**, per person **Remove** / **Make patient admin**. Others: **Leave**. Agency nurses show an agency badge (Phase 2).
16. **Admin transfer request**.
17. **My profile**: name, title, email, password, device PIN, devices, my patients, notifications, AI requests left, **Delete my account** [Gate].
18. **Operator console**: accounts, recovery, service settings (AI cap), health, metrics.
19. **Agency console** (Phase 2, section 10): nurses, families sharing with the agency, reports.

---

## 8. Data

Migrations use `PRAGMA user_version`. Fresh hosted databases start empty. Changes in r7 are marked **(r7)**; the rest is as in revision 6.

```
organizations(id PK, name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'household' CHECK(type IN ('household','agency','clinic')),
  ai_monthly_cap INTEGER,                    -- (r7) NULL = service default; agency contracts can raise it
  created_by INTEGER REFERENCES users(id), deleted_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP)

ai_usage(org_id INTEGER NOT NULL REFERENCES organizations(id),          -- (r7)
  month TEXT NOT NULL,                       -- 'YYYY-MM'
  requests INTEGER NOT NULL DEFAULT 0,
  input_tokens INTEGER NOT NULL DEFAULT 0, output_tokens INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (org_id, month))               -- counts only; used for the cap and cost reporting

email_connections(org_id PK, provider ('imap','gmail','outlook'), address, secret_enc BLOB,
  imap/smtp host+port, connected_by, status ('ok','needs_reconnect','error'),
  last_checked_at, last_uid, created_at)

users(id PK, name, title, email UNIQUE NOCASE, email_verified_at, password_hash,
  is_operator, twofa_enabled, failed_attempts, locked_until, last_login_at,
  adult_confirmed_at, active, deleted_at, created_at)

auth_tokens(id PK, user_id, purpose ('verify_email','reset_password','login_code','change_email'),
  token_hash, new_email, expires_at, used_at, created_at)

sessions(id PK (hashed), user_id, kind ('cookie','bearer'), device_label, device_pin_hash, pin_failed,
  created_at, last_seen_at, idle_expires_at, absolute_expires_at)

patients(id PK, org_id, admin_user_id, first_name, last_name, dob, match_key (HMAC; indexed),
  allow_access_requests DEFAULT 1, parent_*, address…, insurance_*, medicaid_id,
  diagnoses, equipment, notes, onboarded, archived, version, created_by, created_at, updated_at)

patient_members(id PK, patient_id, user_id, role ('self','family','nurse','doctor'),
  agency_org_id INTEGER REFERENCES organizations(id),   -- (r7) set when the member joined as an agency nurse (Phase 2)
  notify_provider_messages, notify_low_stock, joined_via ('creator','invite','request','import','transfer','recovery'),
  invite_id, join_request_id, added_by, version, created_at, removed_at, removed_by)

invites, join_requests, request_blocks, admin_transfers,
documents, document_files, outbox_attachments, provider_emails_seen,
ai_consents, audit_log (with actor_kind 'member'|'operator'|'agency_admin'|'system'), settings,
push_subscriptions(platform 'webpush'|'apns'|'fcm')          -- as in revision 6
```

**Phase 2 tables** (agency pilot; create when building A1-A3, not in Phase 1):
```
agency_staff(org_id REFERENCES organizations(id),    -- org.type = 'agency'
  user_id REFERENCES users(id),
  role TEXT CHECK(role IN ('agency_admin','agency_nurse')),
  added_by, created_at, removed_at,
  PRIMARY KEY (org_id, user_id))

agency_shares(patient_id REFERENCES patients(id),    -- family consent to share with an agency (A2)
  agency_org_id REFERENCES organizations(id),
  level TEXT NOT NULL DEFAULT 'roster' CHECK(level IN ('roster')),   -- roster = which agency nurses are linked + activity counts; no health data
  granted_by REFERENCES users(id),                   -- must be the patient admin
  granted_at, revoked_at,
  PRIMARY KEY (patient_id, agency_org_id))
```

**Changed existing tables** (as in revision 5/6):
- `supplies`, `scan_log`, `providers`, `tasks`, `outbox` get `patient_id` and `version`.
- `outbox` also gets `channel`, `to_fax`, `to_name`, `sent_via`, `in_reply_to`, `created_by`, `sent_by`.
- `supplies` also gets `alert_enabled` / `alert_sent_at`; barcodes unique per patient.

**Import mapping (home v0 → hosted):** unchanged from revision 6.

---

## 9. Privacy, security, HIPAA, hosting and money

### Security baseline (all phases)
- **Encryption:** HTTPS only (HSTS); TLS to database, email and AI; encrypted disk and backups; app-level encryption for email credentials.
- **Access control and logging:** per-family isolation with tests; member/admin checks; operator has no patient data; audit log; no PHI in application logs or error reports.
- **No trackers:** no third-party trackers, analytics pixels or session replay.
- **Headers:** CSP `'self'`, `nosniff`, `no-referrer`, `frame-ancestors 'none'`; uploads checked by content.
- **Push:** generic push text only.

### Hosting: recommendation for the private beta
**Recommendation: a managed hosting platform that signs a BAA, such as a Render HIPAA-enabled workspace.**

In plain words: you rent a ready-made, locked-down home for MediTrack on the internet. The platform company:
- keeps the servers patched and running
- provides the secure web address (HTTPS) automatically
- keeps backups
- signs the health-data agreement (BAA) with you

You don't need to hire anyone to manage servers. You click "deploy" and get a bill each month.

**Why this and not the alternatives:**
| Option | Good | Not so good | Fit for the beta |
|---|---|---|---|
| **Managed platform with a BAA (recommended)** | No technical staff needed; BAA is self-serve from the settings page; HTTPS and backups built in | Costs more per month than a raw server; the HIPAA upgrade can't be undone (fine for MediTrack) | **Best** |
| Big cloud (AWS, Google Cloud, Azure) | Cheapest at scale; every BAA and security report an agency could ask for | Needs a technical person to set up and maintain correctly; easy to misconfigure | Revisit later |
| HIPAA-specialist platform (e.g. Aptible) | Compliance features and paperwork help | Usually more expensive (**verify pricing**) | Consider at the agency pilot if the agency wants more compliance paperwork |

**Rough monthly cost for the private beta (estimates, verify before signing):**
| Item | Estimate |
|---|---|
| Platform plan with HIPAA/BAA | ~$250/month minimum is reported for older plans; newer plans reportedly charge 20% on top of compute with no minimum but need a higher plan tier. **Sources disagree; verify on the pricing page.** |
| One app server + encrypted disk | ~$25-$85/month |
| Off-site encrypted backup storage | ~$5-$20/month |
| AI (owner's family, under the cap) | ~$5-$30/month |
| **Total (beta)** | **roughly $300-$450/month** |

Setup in the beta:
- one app instance with SQLite on an encrypted persistent disk
- continuous encrypted off-site backup (e.g. Litestream to BAA-covered storage)
- daily snapshots kept 30 days
- a monthly test restore

**When to revisit hosting:**
- **at the start of an agency pilot**, if the agency's security questionnaire asks for things the platform can't show (e.g. specific audit reports, data location, uptime guarantees)
- at **about 50 active families**, or when more than one app instance is needed (move to managed PostgreSQL)
- when hosting costs pass **~$1,000/month**

### HIPAA in plain words
- **Families using MediTrack directly:** HIPAA probably does not apply. The FTC Health Breach Notification Rule does (since 2024 it covers health apps not covered by HIPAA): breaches and unauthorized sharing must be reported to users and the FTC within 60 days. State health-privacy laws may also apply. **Lawyer to confirm.**
- **Once an agency partners (Phase 2):** the agency is very likely a HIPAA covered entity. MediTrack then becomes its **business associate**, signs a **BAA with the agency**, and must meet the HIPAA Security Rule in full for that work (section 10). Building to HIPAA level from Phase 1 means no rework.
- **What HIPAA-level means here:**
  1. BAAs with every vendor that handles health data (hosting, Anthropic; email vendor only if it sees health data; push services see only generic text, which a lawyer should confirm)
  2. encryption at rest and in transit
  3. access logging
  4. a written risk assessment, updated yearly
  5. a breach response plan
  6. minimum-necessary access (operators see no patient data)
  7. policies and training once there is staff

### AI vendor (Anthropic)
- BAA via Anthropic sales. A "HIPAA-ready" API organization blocks non-covered features with an error. Beta features are generally not covered; Batch and Files APIs are listed as not covered. Sources conflict on the retention setup.
- **Verify** the current eligibility table, and **whether a minimum spend or plan is required for the BAA**.
- Builder: remove the beta header and `fallbacks`; web search off until confirmed eligible; use a covered model.

### Email providers (OAuth, Phase 3 gate)
- **Google:** reading Gmail is a restricted scope. More than 100 users needs app verification and an annual CASA security assessment (reported ~$500-$1,000+/year, weeks to months). Testing mode is capped at 100 users and reportedly expires sign-ins after 7 days. **Verify.**
- **Microsoft:** delegated `Mail.Read` / `Mail.Send` reportedly works for personal accounts without publisher verification. **Verify.**

### Terms of Service and Privacy Policy [Gate]
Lawyer-written before Phase 2. They must cover:
- what is collected and why
- the AI provider (only with the patient admin's consent)
- no selling or advertising use
- everyone linked sees everything
- **what an agency can and can't see**
- breach notification
- export and deletion
- the 18+ rule
- **not medical advice; not for emergencies (call 911)**

### Money (r7)
- **Families never pay.** No family billing, subscriptions or ads, now or later.
- **Cost control:** the AI cap per family (M12). Everything else costs little per family.
- **Until a contract exists:** the owner pays hosting, AI and legal costs.
- **Revenue:** contracts with home-nursing agencies (section 10). The contract is invoiced outside the app; no billing system is needed in MediTrack. A contract can raise the AI cap for the agency's families.

**Cost estimates (rough, not quotes):**
| Item | When | Estimate |
|---|---|---|
| Hosting + backups (beta) | Phase 1 | ~$300-$450/month |
| AI per active family (under a 150-request cap) | ongoing | ~$1-$10/month |
| Lawyer: terms, privacy policy, HIPAA/FTC review, agency BAA review | before Phase 2 | ~$2,000-$10,000 one-time |
| Cyber-liability insurance | before Phase 2 (agencies usually ask) | ~$1,000-$5,000/year (**uncertain; get quotes**) |
| Penetration test | before or during the pilot (often asked) | ~$5,000-$20,000 (**uncertain**) |
| SOC 2 (only if an agency requires it) | Phase 4 | ~$20,000-$60,000 first year including tooling and auditor (**uncertain; wide range**) |
| Google CASA assessment | Phase 3 | ~$500-$5,000+/year |
| Apple / Google developer accounts | Phase 4 | $99/year / $25 one-time |

### Sources checked (Nov 2026; re-verify before signing anything)
- Anthropic: [API and data retention / HIPAA-ready](https://platform.claude.com/docs/en/manage-claude/api-and-data-retention), [BAA FAQ](https://privacy.claude.com/en/articles/8114513-will-anthropic-sign-a-business-associate-agreement-baa-and-if-so-for-which-products)
- Render: [HIPAA](https://render.com/security/hipaa), [workspace plans](https://render.com/docs/new-workspace-plans.md)
- AWS: [HIPAA compliance](https://aws.amazon.com/compliance/hipaa-compliance/); [Lightsail status (third party)](https://www.accountablehq.com/post/how-to-get-a-baa-with-aws-steps-requirements-and-covered-hipaa-services)
- FTC: [Health Breach Notification Rule](https://www.ftc.gov/system/files/ftc_gov/pdf/p205405healthbreachnotificationrule.pdf)
- Google OAuth: [Nylas](https://developer.nylas.com/docs/provider-guides/google/google-verification-security-assessment-guide/), [Nango](https://nango.dev/docs/api-integrations/google-shared/google-security-review), [100-user limit](https://www.unipile.com/google-oauth-100-user-limit/)
- Microsoft Graph: [Unipile](https://www.unipile.com/microsoft-graph-oauth-email/)
- iOS web push: [Apple](https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers)
- App Store 4.2: [Apple forums](https://developer.apple.com/forums/thread/115230), [Capgo](https://capgo.app/blog/how-to-pass-app-store-review-2026/)

The agency-related items in section 10 (questionnaires, SOC 2, insurance, SSO) are general industry practice, **not verified for any specific agency**. Ask the agency.

---

## 10. Partnering with a nursing agency (plain words)

### Why an agency would pay
- **Nurse time saved:** nurses stop hunting for supply phone numbers, re-faxing orders and chasing DME companies. Orders, documents and contacts are one tap away.
- **Fewer supply problems:** low-stock alerts and fast reorders mean fewer missed shifts or ER visits because a trach or vent supply ran out.
- **Happier families:** families who feel supported stay with the agency, and supply problems are a common complaint.
- **Documentation:** the stock log, sent orders and provider messages give a clear record of what was done and when.

### What changes legally
- A home-nursing agency is almost certainly a **HIPAA covered entity**. When its nurses use MediTrack as part of their work, MediTrack is acting as the agency's **business associate**.
- MediTrack signs a **BAA with the agency** (agencies usually supply their own template; have the lawyer review it). MediTrack must then follow the HIPAA Security Rule, notify the agency of breaches within the BAA's deadline, and have BAAs with its own vendors (hosting, Anthropic).
- **Data ownership:** the family's data stays the **family's**. The agency's official clinical records stay in the agency's own system; MediTrack is not the agency's medical record. The contract must say this plainly. Export and deletion stay with the family.

### What agencies typically ask for before signing (general practice; uncertain for any specific agency)
- A **security questionnaire** (often a standard one, or the agency's own). Answers come from section 9 and the risk assessment.
- **Proof of security:** a penetration test report is common. **SOC 2** is often asked by large organizations, but a pilot may accept a questionnaire and a plan (**uncertain; ask**).
- **Cyber-liability insurance** (**likely; amount varies**).
- **Uptime** expectations (e.g. 99.5% or better), support hours, incident contacts.
- **Data ownership and export** terms, and what happens to data if the contract ends.
- **Single sign-on (SSO)** with the agency's staff accounts (**sometimes; more likely after a pilot**).
- Training materials for nurses.

### Agency features that move up the roadmap (Phase 2)
- **A1. One nurse login across many families.** Already in the design (users aren't tied to one family). Add an agency badge on Members, and "my patients" grouped by family.
- **A2. Agency admin view, with family consent.**
  - An agency account (`organizations.type = 'agency'`) with agency admins and a nurse list.
  - The agency admin sees **which of its nurses are linked to which families only for families that turned on "Share with [Agency]"** in Patient profile (patient admin only, off by default, revocable).
  - The roster shows names and link dates; **no health data**.
  - **Offboarding:** when a nurse leaves the agency, the agency admin can **end that nurse's agency links**. The family is notified, and only links marked as agency links are removed (**owner to confirm**, Open decision 5).
- **A3. Agency reporting** (counts only, no health data): families sharing, active nurses, orders sent, provider emails handled, low-stock alerts resolved, assistant requests, time-to-send for orders. Monthly CSV/PDF. A contract can raise the AI cap for the agency's families.

### How "everyone linked sees everything" works with agency nurses
- An agency nurse sees a family's data **only because the family linked them** (invite or accepted request), exactly like any other member. They then see everything for that patient, including insurance numbers and the care email. The trust note applies.
- **The family stays patient admin.** The agency can't add its nurses to a family, can't see any family's data through its agency account, and can't change AI consent.
- The agency's only family-related powers are the roster view (with the family's share switch on) and ending its own nurses' agency links.

### What the owner needs to show an agency
1. **A working private beta** used by the owner's family (and their nurses) for **2-3 months**.
2. **Metrics** from the operator console: orders sent and time-to-send, provider emails handled, low-stock alerts and stock-outs avoided, documents stored, nurse and family feedback (a short survey).
3. **A short demo** (2-minute video) of the common tasks and their tap counts.
4. **A security one-pager:** hosting with a BAA, encryption, access control, audit log, AI BAA, breach plan.
5. **Draft pilot terms:** number of nurses/families, length (e.g. 3 months), success metrics, the BAA, and what happens after.
6. Terms of service and privacy policy (lawyer-reviewed) and proof of insurance, if the agency asks.

---

## 11. Phone app path

Unchanged from revision 6:
- **Now:** installable web app with web push. iPhone needs iOS/iPadOS 16.4+ and Home Screen install.
- **Later (Phase 4):** Capacitor wrappers for App Store / Google Play with native push. The native app should bundle the client and use native camera, share and push, because Apple reportedly rejects thin website wrappers (guideline 4.2).
- **Trigger to move earlier:** if beta or pilot users on iPhone miss notifications, **or if the partner agency requires an App Store app.**
- **Wrapper-ready design rules:**
  1. JSON API only
  2. cookie or bearer auth
  3. one client bundle with device adapters
  4. one `notify()` with `push_subscriptions.platform`
  5. deep links use the same paths

---

## 12. Visual style

**Keep** the current look: navy/blue header, white cards on light gray, colored badges, teal accent.

**Change, for phone-first simplicity:**
1. Bottom navigation; SVG icons + labels.
2. Touch targets ≥ 44px; main action at the bottom.
3. Inputs at 16px.
4. Cards on phones.
5. `--gray-700` for text.
6. One status palette with text + color.
7. Patient chip everywhere; people shown as "Name (Title)"; "Admin" and agency badges.
8. Undo instead of confirms, except sending and permanent delete.
9. Soft highlight on others' changes.
10. Phone, fax and email on separate labelled lines.
11. The trust note in the orange "needs attention" style.
12. App icon and splash.
13. The AI cap counter is calm gray text, not a warning, until fewer than 10 requests are left.

---

## 13. Open decisions

Plain-language questions for the owner, most important first. Answered this round and removed: sign-in (email + password, optional phone PIN), "Ask for access" on by default, and the business model (free for families; agency contracts).

1. **Approve the hosting recommendation?** *Recommendation: a managed hosting platform that signs a health-data agreement (BAA), for example a Render HIPAA workspace. Roughly $300-$450 a month for the beta, no technical staff needed. Revisit at the agency pilot, at about 50 families, or above about $1,000 a month.* Approve, or do you have someone technical who would rather run it on a big cloud provider?
2. **Approve the order: private beta → agency pilot → public sign-up?** *Default: yes. The agency pilot comes before opening to everyone, because that's where the contract (and your income) comes from and it's a smaller, safer group.* Public sign-up may come later, or never if agencies cover it.
3. **How much AI can each family use for free?** *Default: 150 assistant requests per family per month (roughly $1-$10 per active family; estimate). Everything else in the app is unlimited.* Higher, lower, or fine?
4. **A lawyer and insurance before the agency pilot:** the plan assumes a lawyer for terms, privacy policy and the agency's BAA (roughly $2,000-$10,000), and quotes for cyber-liability insurance. OK to budget for these?
5. **Agency offboarding:** when a nurse leaves the agency, can the agency end that nurse's access to the families they were linked to through the agency (the family is told), or should only the family be able to remove them? *Default: the agency can end agency links; families can always remove anyone.*
6. **US only to start?** *Default: yes.*
7. **Resupply schedule** (allowed quantity per month, next order date): now or later? *Default: later.*
8. **Call scripts:** *Default: the child's name, never "he/she".* Keep?
9. **AI permission split:** *Default: two switches, both off: "medical info" and "personal & insurance info".* Right?
10. **Siblings and providers:** a shared pharmacy or supply company entered once per family, or per child? *Default: per child.*
11. **Starter supply list:** OK to offer the 35 trach / vent / G-tube items with counts at 0?
