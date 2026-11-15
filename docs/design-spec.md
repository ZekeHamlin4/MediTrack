# MediTrack Design Spec

## 0. Goal, principle and constraints (read first)

**Goal (owner's words):**
> "A single portal where families keep all their doctors and DME/supply companies (phone, fax, email), get notified when providers email them, have the AI write emails and faxes, and get help solving problems with those providers. Eventually other families should be able to sign up."

**Principle (owner's words):**
> **MediTrack must stay very simple.** It is for a tired parent of a medically complex child. Every common task (find a number, send an order, reply to a DME email) must take as few taps as possible. Anything that doesn't serve that goes under Later features.

**Business model (owner's words):**
> "I truly want this to be a free app, but to get this partnered with a nursing company like Maxim. Then from there we can have a contract and I get paid through that."

**Budget constraint (owner, revision 8):**
> "I don't have money for this."

**Phase 1 must run at about $0-20 a month.** Anything that costs money waits until an agency pilot (or other outside funding) pays for it.

How the builder applies these:
- **MVP rule (Phase 1):** a feature is in only if it (a) serves the goal and makes a common task faster, or (b) is needed for safety or privacy, **and (c) costs nothing to run**. Everything else is in section 6 (Later) or Appendix A (hosted design, Phase 2+).
- **Defaults instead of settings.** One obvious button per screen, in thumb reach.
- **Never cut (all free):** hashed passwords, server-side permission checks, same-origin checks, AI consent, the stock log, the audit log, backups.
- **Build for later without paying now:** keep the family/patient scoping, the API shape and the notification abstraction so the hosted version (Phase 2) is an upgrade, not a rewrite.

### How Phase 1 covers the goal
| Goal part | Phase 1 (Family edition) |
|---|---|
| Single portal for all doctors and DME/supply companies | Care Team with phone, **fax**, email per provider and department. Reachable from every family phone, at home or away, through a free private network (M10). |
| Notified when providers email | Free web push from the home computer whenever **any** email arrives from a known provider (M12, M18). The computer must be on. |
| AI writes emails and faxes | Claude API, pay-as-you-go with a hard monthly cap, or switched off for $0 (M12). Fax drafts are PDFs sent with the family's fax app. |
| Help solving provider problems | Assistant (when on), built-in call scripts, tasks, documents. |
| Other families can sign up | Later: the agency pilot brings hosting (Phase 2, funded by the agency); public sign-up only with funding (Phase 3). |

### Target tap counts (from Home, signed in, patient selected)
| Common task | Taps | Path |
|---|---|---|
| Find a provider's number (phone or fax) | **0-1** | Home "Quick contacts" or **Care Team** (1). |
| Call a provider | **1-2** | Home quick contact **Call** (1), or **Care Team** → **Call** (2). |
| Email an order already in the app | **4** | **Care Team** → **Send order** → **Send** → confirm. |
| Fax an order | **5** | **Care Team** → **Send order** → **Fax** → **Share** to fax app → **Mark as faxed**. |
| Scan a new order and send it | **≤ 7** | **Scan document** → pages → **Done** → **Save** → **Send to [last DME]** → **Send** → confirm. |
| Read and reply to a provider email | **3-4** | Push or Home card → **Draft reply** / **Reply** → **Send** → confirm. |
| Log supply use / restock | **2** | **Supplies** → **−1** / **+**; or **Scan supply** → **Used**. |
| Check stock | **0-1** | "Running low" on Home, or **Supplies**. |

Saves show a 5-second **Undo**. Sending email has one confirm.

---

Status: **revision 8.** The plan is reworked for **near-zero cost**.

1. **Phase 1, "Family edition":** the existing home-computer app evolves in place. Phones reach it securely through a free private network (Tailscale's free personal plan), which gives HTTPS, live scanning, push notifications and access away from home.
2. **Phase 2, agency pilot:** funded by the agency. Hosting, BAAs, lawyer and insurance are part of the pilot agreement.
3. **Phase 3, public sign-up:** only with funding.

Owner decisions kept from earlier rounds:
- sign-in with email + password, with an optional phone PIN
- "Ask for access" on by default
- everyone linked to a patient gets everything; one patient admin
- invites + access requests
- per-patient AI consent
- several patients per install
- live updates
- documents
- fax drafts
- free for families forever

Scope: evolve the existing code. Do not rewrite it.

---

## 1. Current state

**Stack**
- Server: Node 22+, Express 4, `better-sqlite3` (`server/meditrack.db`), `nodemailer` (SMTP), `imapflow` (IMAP), `@anthropic-ai/sdk` (model `claude-opus-5-5` by default, `ASSISTANT_MODEL` overrides; web search on by default; a beta request header).
- Client: one page (`client/index.html` + `client/care.jsx`). React 18 development build, Babel standalone and Quagga from public CDNs.
- Runs on a home computer via `Start MediTrack.bat` / `.command`; phones use `http://<LAN-IP>:3000` on home Wi-Fi. One child per install. Email settings in `.env`.

**Screens:**
- Setup wizard (family info → care team via manual entry or NPI search)
- Care Team (phone/fax/email/account #, departments, scripts, favorites)
- Assistant (chat; Outbox; Inbox)
- Tasks
- Dashboard
- Supplies
- Scan (barcode; free "Logged by")
- Portal (read-only, not enforced)
- Activity
- Users

**Data:** `users`, `supplies`, `scan_log`, `patient_profile`, `providers`, `tasks`, `outbox`. Seeds 5 demo users (plain-text PINs) and 35 demo supplies.

**No** login, permission checks, documents, attachments, fax output, provider-email alerts, live updates or backups.

---

## 2. Phases

| Phase | Who | Runs on | Cost to the owner | Before it starts |
|---|---|---|---|---|
| **1. Family edition** (now) | The owner's family and the people they invite (nurses, relatives) | The family's own home computer + a free private network | **~$0-20/month** (section 9) | Nothing paid. Build M1-M18. |
| **2. Agency pilot** | One home-nursing agency (e.g. a large agency such as Maxim), some of its nurses and the families they serve | Hosted service (Appendix A), **paid for by the agency or an upfront pilot fee** | $0 from the owner; costs are in the pilot agreement | 2-3 months of real Family edition use, metrics, a demo video (section 10). A signed pilot agreement that covers hosting, BAAs, lawyer review, insurance and security work. |
| **3. Public sign-up** | Any family | Hosted | Paid by agency contracts or other funding | Funding in place; everything in Appendix A including Google email verification. |
| **4. Grow** | More agencies | Hosted; native apps | Contract-funded | Section 11. |

**Other no-cost routes to fund Phase 2+** (general options to look into; none is promised):
- health-technology grants and foundation programs
- startup accelerators
- a technical co-founder who contributes work instead of money
- an agency's own innovation or pilot programs

### What happens to the existing home app
It **evolves in place**: the same folder, launcher and database file, upgraded by a migration (section 8). No separate import step in Phase 1. When Phase 2 starts, the hosted service imports a Family edition backup file (Appendix A).

---

## 3. Users and roles (Phase 1)

**Everyone linked to a patient gets everything.** The patient admin is the only special role for patient data.

> **Plain-words note (show in the app):** "Everyone you add can see and do everything for [first name]: medical information, insurance numbers, documents and the care email. Only add people you trust with all of it."

Shown on Invite, Accept request and Accept invite screens.

| Role | Who | Can |
|---|---|---|
| **Member** (title shown, e.g. Mom, Dad, Nurse, Home health aide) | Anyone linked to a patient | Everything for that patient, except admin-only actions. |
| **Patient admin** (one per patient) | Whoever created the patient profile, or someone it was transferred to | Plus **only the admin:** invite/remove people; accept/deny access requests; turn requests on/off; AI consent; transfer admin; connect the care email; permanently delete documents; archive the patient. |
| **Home admin** (a flag; the first account) | Whoever set MediTrack up on the home computer (usually also a patient admin) | Computer-side settings: AI on/off and monthly spending cap, backups, unlock accounts, set a temporary password, reassign a patient admin to an existing member. The role gives **no extra patient access** in the app. Honest note: whoever controls the computer can technically reach the database file, which is why backups are encrypted and the computer should have a login password. |
| Doctor | No login | Receives documents, letters and the usage report by email or fax. |

**Keep it to your own family in Phase 1.** Add only patients your family cares for (e.g. siblings). Don't put another family's child on this computer; that's where legal obligations begin (section 9).

---

## 4. Gaps and problems (current code)

### 4a. Security
1. No login.
2. No permission checks.
3. `app.use(cors())` lets any website read data and trigger sending.
4. Plain-text demo PINs.
5. "Logged by" impersonation.
6. Plain HTTP on Wi-Fi; camera and push blocked on phones.
7. Unpinned CDN scripts; in-browser Babel.
8. AI sharing implicit; no spending limit.
9. Server trusts client chat history.
10. Email password in plain text in `.env`.

### 4b. Bugs
1. Failed deletes show "deleted" (`api` helper ignores `r.ok`).
2. Inline quantity edits overwrite and aren't logged.
3. No live updates.
4. UTC timestamps parsed as local time.
5. Profile/tasks not editable; step ticks overwrite.
6. Hard-coded categories.
7. "My son"/"his".
8. Demo data seeded.

### 4c. Missing for the goal
1. No provider-email alerts.
2. No fax output.
3. No documents.
4. No secure phone access away from home.
5. No backups.
6. Phone layout (9 tabs, small buttons).

---

## 5. Phase 1 build (Family edition): all free to run

Build in this order. Nothing here needs a paid service.

**M1. Data foundation and migration in place**
- `PRAGMA user_version` + numbered migrations in `db.js`; v0 → v1 upgrades the existing `meditrack.db` (section 8). Fresh installs have no demo data.
- **Keep the multi-family structure** even though Phase 1 has one family:
  - one `organizations` row (type `household`)
  - every patient-scoped table has `patient_id`
  - every route is `/api/patients/:pid/…` with a membership check
- Multi-family isolation tests are **postponed to Phase 2**. The checks themselves are in from day one.

**M2. Accounts and sign-in** (free)
- **Who can sign up:** anyone who can reach the app. In Phase 1 that already requires the family to have given them access to the private network (M10), so sign-up is effectively by invitation. The home admin can switch sign-up off.
- **Sign up:** name, title (display only), email, password (min 10 characters; common-password check), "I am 18 or older".
- **Email verification:** postponed to Phase 2. In Phase 1 an invite link, or the home admin's approval, proves who joins.
- **Sign in:** email + password. **Quick PIN** (optional): 6 digits per device; after 12 h idle the device asks for the PIN; 5 wrong → full sign-in.
- **Forgot password:**
  - **if the family email is connected (M12):** send a one-time reset link from the family's own mailbox (free)
  - **otherwise:** the home admin sets a temporary password that must be changed at next sign-in
- **Security details:**
  - lockout after 5 failures for 15 min
  - scrypt hashes; reset tokens stored hashed
  - `HttpOnly`, `Secure` (on HTTPS), `SameSite=Lax` session cookie
  - device list with "sign out"
- **First run:**
  1. the server prints a one-time **setup code** in the MediTrack window
  2. the Welcome screen asks for it
  3. the first account becomes **home admin**
  4. the migrated or new patient's admin is that account
- 2-step sign-in: Phase 2.

**M3. Permissions: everyone gets everything + one patient admin**
- Server checks "is a member" / "is the patient admin" / "is home admin" on every call.
- Remove `cors()`. Same-origin check on state-changing requests.
- Errors: 401 when not signed in, 403 for admin-only actions, 404 for anything outside the caller's patients.

**M4. Joining: invites and access requests**
- **Invites (main path):**
  - patient admin → **Members → Invite someone** → trust note → QR code, code, link → **Share**
  - invitee signs up or signs in → **Accept**
  - single-use, 72 h
- **Access requests (on by default):**
  - exact first name + last name + DOB against patients **on this install**
  - the same answer every time ("If a matching patient exists, their admin has been asked")
  - nothing revealed before acceptance; denials never notified ("No response" after 14 days)
  - 3 per day per account
  - stored as a keyed hash; audited
- **Remove / Leave / Transfer admin** (admin-initiated, the other person accepts).
- **Recovery:** the home admin reassigns a patient admin to an **existing member**, with a reason, audited.

**M5. Patient switcher**: patient chip → list → switch; patient in the URL.

**M6. Stock log**: +/- movements, counts with before/after, every change logged with the user, archive instead of delete.

**M7. Live updates**: Server-Sent Events per patient and per user (in memory; one process). Refetch on reconnect. `version` checks with "please make your change again".

**M8. Bug fixes from 4b**; call scripts use the child's name.

**M9. Adding a patient**: wizard (for me / someone I care for; first, last, DOB; care team; supplies with alert items; connect care email; done).

**M10. Secure phone access: free private network (Tailscale)**
**Recommendation:** Tailscale's free **Personal** plan. Reported terms: free for non-commercial use, up to 6 users in your private network, unlimited personal devices, and device sharing with outside users. **Verify current limits on tailscale.com/pricing.**

What it gives, for $0:
- **HTTPS:** a private web address like `https://mt-home.<your-tailnet>.ts.net` with a real certificate (Tailscale "HTTPS certificates" + `tailscale serve`). Live barcode scanning, "Add to Home Screen" and web push all work, including on iPhone.
- **Access away from home:** any phone with Tailscale switched on reaches MediTrack, on Wi-Fi or mobile data.
- **Not on the public internet:** only devices in, or shared into, the family's private network can reach it. **Do not** use Tailscale Funnel or any public tunnel.

Setup (README step-by-step, with screenshots):
1. Install Tailscale on the home computer and sign in. In the Tailscale admin page: turn on **MagicDNS** and **HTTPS certificates**.
2. Name the computer something **non-identifying** (e.g. `mt-home`), never the child's name. Machine names on certificates appear in public certificate logs (**verify** in Tailscale's HTTPS docs).
3. MediTrack runs `tailscale serve` for its port (or the README gives the one command). The server binds to **localhost only** in this mode, so plain-HTTP access from the Wi-Fi is off.
4. **Family members:** install Tailscale on their phones, signed into the family's network (counts toward the 6 users).
5. **Nurses:** install Tailscale with their **own** free account. The family **shares the MediTrack computer** with them (Tailscale "Share", invite link). Shared users only see that one computer. Whether they count toward the 6 users needs **verifying**.
6. On each phone: open the address in Safari/Chrome → **Add to Home Screen** → open from the icon → **Turn on notifications**.

Fallback, also free: **Home Wi-Fi only** (today's setup). Phones at home use `http://<computer>:3000`; no push, barcode by photo, not encrypted on Wi-Fi. Settings shows which mode is active.

Considered and not recommended for Phase 1: a public tunnel or public hosting. Free tunnels exist, but they put MediTrack on the public internet, which needs stronger security and a domain.

**M11. Documents**
- camera capture, multi-page; one PDF per document (`pdf-lib`)
- upload PDF/JPEG/PNG; 20 MB
- tags (purpose, doctor, date, title, renew-by); filters
- **Send order** / **Send to…** by email or fax
- Recently deleted for 30 days
- stored in the database, so they are included in backups

**M12. Family email, provider messages, assistant**
*Email:*
- The patient admin connects the family's Gmail/Outlook with an **app password** (free). It is stored **encrypted** with a key kept in a separate file outside the database (`server/secret.key`, created on first run, included in the encrypted backup).
- Recommendation shown: use a separate email address only for care and supply companies.

*Provider messages:*
- Check every 5 min; only emails from known providers are shown; bodies are not stored.
- Push "MediTrack: a provider emailed you."
- The AI never runs on incoming mail by itself.

*Fax drafts:* PDF with cover sheet → **Share** to a fax app → **Mark as faxed**.

*Assistant (pay-as-you-go, capped, optional):*
- **Off = $0.** With no `ANTHROPIC_API_KEY`, or with "Assistant: off" in Settings, everything else works: drafts, scripts, documents, fax PDFs, alerts.
- **Consent:** the patient admin, per patient, off by default, two scopes (`clinical`, `identity_admin`).
- **Hard monthly spending cap in MediTrack:**
  - home admin setting "**Monthly AI limit**" (default **$10**)
  - after every API call MediTrack records tokens used and estimated cost (`ai_usage`; per-model prices in a small table in `settings` that the home admin can update)
  - once the month's estimate reaches the cap, the assistant stops until the 1st: "This month's AI limit is reached. Everything else still works."
  - Settings shows "$4.10 of $10 used this month"
- **Second safety net at Anthropic:** turn **off auto-reload** of prepaid credits and load a small amount (e.g. $10). Where available, set a monthly spend limit in the Anthropic Console. Console spend limits are documented; setting them by API is an early-access preview. **Verify** both in the Console.
- **Default model: a lower-cost tier** (e.g. a Sonnet-class model) via `ASSISTANT_MODEL`; the home admin can switch. Lower `max_tokens` (e.g. 4,000) and fewer tool rounds (e.g. 6) to keep each request cheap.
- **Web search:** on by default (helps solve provider problems); home admin can turn it off.
- **Kept from earlier revisions:** server-side conversation, confirm card before provider changes, tools `draft_email` / `draft_fax` / `list_documents`.

**M13. Pre-compiled client and web app shell**: esbuild bundle (no CDNs, no in-browser Babel), manifest, icons, service worker. Free.

**M14. Phone-first navigation, Home quick actions, computer Overview** (section 7).

**M15. Printable usage report.**

**M16. Home admin settings and backups** (free)
- **Settings** (home admin):
  - connection mode and status
  - sign-up on/off
  - AI on/off, monthly limit, model, web search
  - email status
  - accounts: unlock, temporary password, deactivate
  - patient-admin recovery
- **Automatic encrypted backups** every night at 2 am and on demand:
  - a single file (database + secret key) encrypted with a **backup passphrase** chosen at setup (AES-256-GCM via Node `crypto`; key derived with scrypt)
  - **destination:** a folder the family picks, either a **USB drive** or their **own cloud-drive folder** (Google Drive / OneDrive / iCloud Drive sync folder)
  - keep the last 14
  - Settings shows "Last backup: today 2:00 am"; a Home banner appears if the last backup is older than 3 days
- **Restore:** choose a backup file, enter the passphrase, confirm.
- **Plain warning at setup:** "Write the backup passphrase down and keep it safe. Without it, backups can't be opened, not even by us."

**M17. Audit log** (written; CSV export from Settings).

**M18. Push notifications** (standard web push, free)
- VAPID keys generated on first run. Works on the Tailscale HTTPS address.
- **Events:** provider emailed you (core); assistant has an update; low stock (alert items); joined / asked to join / admin transfer.
- **Generic text** only. Two switches per patient.
- **iPhone:** iOS/iPadOS 16.4+ and Home Screen install required; a one-time card explains the 3 steps.
- **The computer must be on** for pushes to be sent; tapping a notification needs Tailscale on (see section 9 "Downsides").
- Sending is abstracted (`notify()`; `platform` = webpush now; APNs/FCM later).

**Postponed to Phase 2 (hosted; Appendix A)**, with code structure kept ready:
- email verification service and signup emails
- Google/Microsoft OAuth and Google app verification
- managed hosting, BAAs, operator console
- multi-family isolation tests
- 2-step sign-in
- "delete my family account"
- importing into the hosted service

---

## 6. Later features

- **Phase 2+:** everything in Appendix A (hosting, OAuth email, verification, 2-step sign-in, agency features A1-A3, data export/delete, operator console).
- Native iOS/Android apps (section 11).
- Built-in fax sending (a fax service with a BAA).
- Access levels or per-person switches, *could add if needed*.
- Doctor login.
- Document auto-crop; assistant reading document contents.
- Resupply schedule; expiry/lot numbers; go-bag checklist; one-tap reorder of all low items.
- Task assignment; shift notes; offline mode.
- **Other families running their own free Family edition** (Open decision 5).
- **Not planned:** family billing of any kind.

---

## 7. Screens (Phase 1)

**Navigation (phone):** bottom bar **Home · Supplies · Care Team · Documents · Assistant** (Assistant hidden when AI is off).
- Header: patient chip, live dot, menu (**My profile**, **Patient profile**, **Members**, **Tasks**, **Usage report**, **Settings** (home admin), **Sign out**).
- Computer: top bar + **Overview**.

1. **Welcome / first run**: setup code → create the home admin account → backup passphrase and folder → connection mode (Tailscale guide or Home Wi-Fi only) → add first patient (or upgrade the existing one).
2. **Sign in**: email, password (or device PIN), **Forgot password**, **Create account**.
3. **Create account**: name, title, email, password, 18+.
4. **No patients yet**: **Enter invite code** · **Ask for access** · **Create a patient profile**.
5. **Accept invite** (trust note) / **Ask for access** (same confirmation always).
6. **Home (phone)**:
   - Waiting on you (provider emails, drafts, faxes, requests)
   - Quick contacts (phone, fax, **Call**, **Send order**)
   - Running low
   - Issues & tasks
   - **Scan supply** / **Scan document**
   - "Get notifications on iPhone" card
   - backup warning if needed
7. **Overview (computer)**.
8. **Supplies**, **Scan supply**, **Supply detail**, **History**.
9. **Care Team** (phone, fax, email on every card; **Call**, **Send order**; "…" Email…, Fax…, Copy, scripts, Ask assistant, Edit, Delete).
10. **Documents**, **Scan document flow**, **Document view**, **Draft (email/fax)**.
11. **Assistant**: chat; "AI limit: $X of $Y this month" (home admin) or "Assistant available" (others); Provider emails; Outbox; consent banner.
12. **Tasks**.
13. **Patient profile**: details; admin: **AI sharing**, **Connect care email**, **Archive patient**.
14. **Members**: list; admin: **Invite someone**, **Requests**, **Allow access requests**, **Remove**, **Make patient admin**; others: **Leave**.
15. **My profile**: name, title, email, password, device PIN, devices, notifications.
16. **Settings** (home admin): connection status, sign-up, AI (on/off, monthly limit, model, web search, usage), email, accounts, patient-admin recovery, backups (folder, passphrase change, **Back up now**, **Restore**), audit export.

---

## 8. Data (Phase 1)

Migrations use `PRAGMA user_version`. The existing `meditrack.db` is **upgraded in place** (v0 → v1).

**v1 tables:**
- `organizations`: one household row; `type` already allows `agency` for later.
- `patients`
- `patient_members`: role label, notify switches
- `invites`
- `join_requests`, `request_blocks`
- `admin_transfers`
- `ai_consents`
- `documents`, `document_files`, `outbox_attachments`
- `provider_emails_seen`
- `email_connections` (`provider = 'imap'` only in Phase 1; `secret_enc` encrypted)
- `sessions` (cookie; device PIN)
- `auth_tokens` (`reset_password` only in Phase 1)
- `audit_log`
- `settings`
- `push_subscriptions` (`platform`)
- `ai_usage`

These are as defined in revisions 6-7, with these Phase 1 differences:
- `users.is_home_admin` (instead of `is_operator`); `email_verified_at` stays NULL until Phase 2.
- `ai_usage(org_id, month, requests, input_tokens, output_tokens, est_cost_cents)`.
- `settings` keys: `signups_open`, `assistant_enabled`, `ai_monthly_limit_cents` (default 1000), `assistant_model`, `assistant_web_search`, `model_prices_json`, `connection_mode` (`tailscale` | `lan`), `backup_dir`, `backup_last_at`, `backup_kdf_salt`, `vapid_public_key`, `vapid_private_key`.
- **Not created in Phase 1:** `agency_staff`, `agency_shares` (Phase 2).

**Existing tables:**
- `supplies`, `scan_log`, `providers`, `tasks`, `outbox` get `patient_id` and `version`.
- `outbox` also gets `channel`, `to_fax`, `to_name`, `sent_via`, `in_reply_to`, `created_by`, `sent_by`.
- `supplies` also gets `alert_enabled` / `alert_sent_at`; barcodes unique per patient.

**Migration v0 → v1 (in place):**
1. Create the household row.
2. Old users: `active = 0`, PINs cleared.
3. First run (setup code) creates the home admin account.
4. Create the patient from `patient_profile` (split the name; confirm the DOB) with that account as patient admin.
5. Backfill `patient_id` and `version`.
6. Mark the current inbox as seen.
7. Prompt to pick alert items.
8. Run a first backup immediately.

---

## 9. Privacy, legal and cost (Phase 1)

### Is a lawyer or a BAA needed to start? (plain words; confirm with a lawyer when there's money)
- **HIPAA generally applies to "covered entities"** (doctors, hospitals, nursing agencies that bill insurance, health plans and billing clearinghouses) **and their "business associates"** (companies doing work for them). It generally does **not** apply to a family keeping their own child's records.
- So a family running MediTrack **on their own computer for their own child** generally does **not** need BAAs, a hosting agreement or a lawyer to start.
- **The family still decides what goes to the AI.** AI consent stays: off by default, per patient, set by the patient admin.
  - Anthropic's API terms describe how API data is handled (for example, whether it is used for training, and retention); **read the current terms** before turning sharing on.
  - When AI sharing is off, the assistant still works with `[placeholders]`.
- **Inviting your own nurses** to see your child's information is the family's choice, like handing them a binder. The trust note explains what they'll see.
- **What changes, and when to stop and get advice:**
  1. **The moment MediTrack holds another family's data** (another family's child on your computer, or you hosting it for others), you are holding other people's health information. The FTC Health Breach Notification Rule then likely applies to you, and state laws may too. Don't do this in Phase 1.
  2. **The moment an agency is involved** (an agency using MediTrack for its patients, or paying for it), MediTrack likely becomes the agency's business associate. That means a BAA with the agency, BAAs with vendors (hosting, AI), a risk assessment and policies. That is Phase 2, and the pilot agreement pays for it.
  3. **Commercial use:** Tailscale's free plan is for non-commercial use. An agency pilot means moving to the hosted setup (or a paid plan the agency covers).
- This section is a plain-language summary, **not legal advice**.

### Security basics (all free)
- **Encryption in transit:** HTTPS via Tailscale; the server binds to localhost only in Tailscale mode.
- **Encryption at rest:** encrypted email password; encrypted backups. **Recommend** turning on the computer's built-in disk encryption (BitLocker on Windows Pro / Device Encryption, FileVault on Mac) and a computer login password.
- **Access control:** hashed passwords, lockout, server-side checks, same-origin checks, no CORS.
- **Logging:** audit log; no health details in logs.
- **No third-party trackers.**
- **Push:** generic notification text.

### Downsides of the Family edition (be honest with families)
- **The home computer must stay on and awake** (plugged in; sleep turned off; MediTrack set to start at login). If it's off: no remote access, no notifications, no inbox checks. Phones show "Can't reach MediTrack; is the home computer on?"
- **Everyone needs Tailscale switched on** to open MediTrack, on each phone, including each nurse's. Notifications still arrive, but tapping them needs Tailscale connected.
- **Backups are the family's job:** a USB drive or their own cloud-drive folder. The backup passphrase must not be lost.
- **One computer = one point of failure.** If it breaks, restore the latest backup onto another computer.
- **Updates:** the family downloads new versions (README explains how). The database is upgraded automatically on start.

### Phase 1 cost (estimates)
| Item | Monthly cost (estimate) | Notes |
|---|---|---|
| Home computer | $0 | The one the family already has. |
| Electricity to keep it on 24/7 | ~$1-$10 | A laptop uses far less than a desktop; depends on local rates. |
| Tailscale Personal | $0 | Free, non-commercial; up to 6 users; device sharing for nurses (verify limits). |
| HTTPS certificate | $0 | Provided through Tailscale (Let's Encrypt). |
| Web push notifications | $0 | Standard web push. |
| Email (Gmail/Outlook app password) | $0 | Family's existing account. |
| Claude API | **$0 with AI off**; **~$2-$10 typical** with AI on | One family, a few dozen assistant requests a month on a lower-cost model. Hard cap default $10. Third-party price lists (Oct 2026, unverified) put Sonnet-class at about $2/$10 per million input/output tokens and Opus-class at about $4/$20, which makes one request roughly $0.03-$0.20. **Verify on Anthropic's pricing page.** |
| Backups | $0 | USB drive the family owns, or their existing cloud drive's free space. (A USB drive is ~$10 one-time if they don't have one.) |
| **Total** | **~$0-$20/month** | Mostly the AI cap plus electricity. |

### What costs money later, and who pays
| Item | Phase | Rough cost (estimate) | Who pays |
|---|---|---|---|
| Hosting with a BAA, backups, monitoring | 2 | ~$300-$450/month | Agency (pilot agreement / pilot fee) |
| Anthropic BAA (may need a sales agreement; minimum spend unknown, **verify**) | 2 | Usage + any minimum | Agency |
| Lawyer: pilot agreement, BAA, terms, privacy policy | 2 | ~$2,000-$10,000 one-time | Agency / pilot fee, or a grant |
| Cyber-liability insurance | 2 | ~$1,000-$5,000/year (**uncertain**) | Agency / pilot fee |
| Penetration test / security questionnaire work | 2 | ~$5,000-$20,000 (**uncertain**) | Agency, if they require it |
| Paid private-network plan (if Family edition is used commercially) | 2 | varies (**verify**) | Agency |
| Google email app verification + annual CASA assessment | 3 | ~$500-$5,000+/year | Agency contracts / funding |
| SOC 2 | 4 | ~$20,000-$60,000 first year (**uncertain**) | Agency contracts, only if required |
| Apple / Google developer accounts | 4 | $99/year / $25 one-time | Contract revenue |

### Sources checked (Nov 2026; re-verify before relying on them)
- Tailscale: [free plans](https://tailscale.com/docs/account/manage-plans/free-plans-discounts), [HTTPS certificates](https://tailscale.com/kb/1153/enabling-https/), [device sharing](https://tailscale.com/blog/sharing-over-tailscale); third-party free-tier summaries: [CostBench](https://www.costbench.com/software/business-vpn/tailscale/free-plan/), [SSD Nodes](https://www.ssdnodes.com/learn/is-tailscale-free-plan-limits)
- Anthropic: [spend limits](https://platform.claude.com/docs/en/api/admin/spend_limits/create.md), [API and data retention](https://platform.claude.com/docs/en/manage-claude/api-and-data-retention); third-party price lists: [BenchLM](https://benchlm.ai/anthropic/api-pricing), [Finout](https://finout.io/blog/anthropic-api-pricing)
- FTC: [Health Breach Notification Rule](https://www.ftc.gov/system/files/ftc_gov/pdf/p205405healthbreachnotificationrule.pdf)
- Apple: [web push for Home Screen web apps](https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers)

---

## 10. Partnering with a nursing agency (funded by the agency)

**The pitch uses the working Family edition**, not a hosted product:
1. **2-3 months of real use** by the owner's family and their nurses.
2. **Metrics** (from the audit log and `ai_usage`; counts only): orders sent and time-to-send, provider emails handled, low-stock alerts and stock-outs avoided, documents stored, AI cost per month, nurse and family feedback.
3. **A 2-minute demo video** of the common tasks and their tap counts.
4. **A one-page summary** of the design: security basics, AI consent, everyone-sees-everything with a single family admin, and the plan for the hosted version.

**Why an agency would pay:**
- nurse time saved
- fewer supply/DME problems and missed-supply emergencies
- family satisfaction and retention
- a clear record of orders and messages

**What the pilot agreement covers (so the owner pays nothing):**
- hosting with a BAA (Appendix A)
- a BAA between MediTrack and the agency, and vendor BAAs (including the AI)
- lawyer review of the agreement, terms and privacy policy
- cyber-liability insurance if the agency requires it
- security work the agency asks for (questionnaire, penetration test)
- AI usage for pilot families
- either **paid directly by the agency** or through an **upfront pilot fee**

**What changes legally:** the agency is very likely a HIPAA covered entity, so MediTrack becomes its business associate (BAA, Security Rule, breach notification to the agency). The family's data stays the family's; the agency's clinical record stays in the agency's own system.

**Agency features built during the pilot (A1-A3, Appendix A):**
- A1. one nurse login across many families
- A2. an agency admin view of its nurses and their linked patients, **only for families who switch on "Share with [Agency]"**, with no health data
- A3. agency reports (counts only)

The family always stays patient admin; the agency sees no family data without the family's link.

**What agencies typically ask** (general practice; ask the specific agency):
- security questionnaire
- penetration test or SOC 2
- cyber insurance
- uptime and support terms
- data ownership and export
- sometimes single sign-on

---

## 11. Phone app path

- **Phase 1:** installable web app (PWA) with free web push over the Tailscale HTTPS address. iPhone needs iOS/iPadOS 16.4+ and Home Screen install.
- **Phase 4:** native iOS/Android via Capacitor, bundling the client (thin website wrappers are reportedly rejected by Apple under guideline 4.2). Needs paid developer accounts, so it waits for contract revenue.
- **Wrapper-ready rules (kept):**
  1. JSON API only
  2. cookie or bearer auth
  3. one client bundle with device adapters
  4. one `notify()` with a `platform` field
  5. deep links use the same paths

---

## 12. Visual style

**Keep** the current look: navy/blue header, white cards, colored badges, teal accent.

**Change, for phone-first simplicity:**
1. Bottom navigation; SVG icons + labels.
2. Touch targets ≥ 44px; main action at the bottom.
3. Inputs at 16px.
4. Cards on phones.
5. `--gray-700` for text.
6. One status palette with text + color.
7. Patient chip everywhere; "Name (Title)"; "Admin" badge.
8. Undo instead of confirms, except sending and permanent delete.
9. Soft highlight on others' changes.
10. Phone, fax and email on separate lines.
11. Trust note in the orange "needs attention" style.
12. AI limit shown in calm gray until less than 20% is left.
13. "Can't reach MediTrack" screen with a friendly checklist: home computer on? Tailscale on?

---

## 13. Open decisions

Plain-language questions for the owner, most important first. Removed this round because they no longer apply: hosting choice, lawyer/insurance budget, phase-order approval, US-only (no public sign-up soon).

1. **Which home computer will run MediTrack, and can it stay on all the time?** It needs to be plugged in, with sleep turned off, for notifications and access away from home. A laptop is fine (and uses less electricity). Windows or Mac?
2. **OK to use Tailscale (free)?** Everyone who uses MediTrack installs the free Tailscale app on their phone, including each nurse with their own free account, and keeps it switched on. Up to 6 family members are free (verify), and nurses get access through "sharing" the MediTrack computer. *Default: yes; Home Wi-Fi only is the fallback (no notifications).*
3. **AI: on with a monthly limit, or off?** *Default: on, with a $10/month hard limit, using a lower-cost model. Typical use is probably $2-$10 a month (estimate).* Or start with AI off ($0) and turn it on later?
4. **Where should backups go?** *Default: an encrypted backup every night to a folder you choose: a USB drive plugged into the computer, or your own Google Drive / OneDrive / iCloud folder.* Which do you have?
5. **Other families before an agency?** Other families could install their own free Family edition on their own computer, so you never hold their data and no legal setup is needed. It costs you nothing, but each family needs some tech comfort (Tailscale, keeping a computer on). *Default: not until the setup guide is tested with your own family.* Interested?
6. **Agency offboarding (for the pilot):** when a nurse leaves an agency, can the agency end that nurse's agency-linked access (the family is told), or only the family? *Default: the agency can end agency links.*
7. **Resupply schedule** (allowed quantity per month, next order date): now or later? *Default: later.*
8. **Call scripts:** *Default: the child's name, never "he/she".* Keep?
9. **AI permission split:** *Default: two switches, both off: "medical info" and "personal & insurance info".* Right?
10. **Siblings and providers:** a shared pharmacy or supply company entered once per family, or per child? *Default: per child.*
11. **Starter supply list:** OK to offer the 35 trach / vent / G-tube items with counts at 0?

---

## Appendix A. Hosted design for Phase 2+ (parked; funded by the pilot)

Condensed from revisions 6-7. Build this only when an agency pilot (or other funding) pays for it.

- **Hosting:** a managed platform that signs a BAA (e.g. a Render HIPAA workspace; reported ~$250/month minimum or a 20% compute surcharge depending on plan; **verify**), or a big cloud (AWS/Google/Azure) if the agency prefers. HTTPS, encrypted disk, continuous encrypted off-site backups, daily snapshots kept 30 days, monthly test restore. Revisit at ~50 families or more than one instance (managed PostgreSQL).
- **Accounts:**
  - email verification (code or link) through a sending service
  - password reset by email
  - 2-step sign-in (required for operators and agency admins)
  - 18+
  - device PIN kept
- **Isolation:** per-family `organizations`; membership checks; **isolation tests in CI** (family A gets 404 for family B on every route).
- **Email:** OAuth with Google and Microsoft (no stored passwords).
  - Google: reading Gmail is a restricted scope; more than 100 users needs app verification + an annual CASA security assessment (reported ~$500-$1,000+/year; **verify**).
  - Microsoft: reportedly no publisher verification needed for personal accounts (**verify**).
  - App passwords encrypted as a fallback.
- **AI:** Anthropic BAA via sales (HIPAA-ready organization blocks non-eligible features; beta features generally not covered; **verify** retention and any minimum spend). Remove the beta header and `fallbacks`; web search only if eligible. A per-family AI cap (requests or $), raised by agency contracts.
- **Operator console** (no patient data):
  - accounts
  - patient-admin recovery
  - service settings
  - health and metrics
- **Data lifecycle:** "Download my family's data", "Delete my account / family account" (30 days; backups age out).
- **Import:** a Family edition encrypted backup (or a v0 `meditrack.db`) → a new family on the hosted service; the file is deleted after import.
- **Legal:** terms of service and privacy policy (lawyer-reviewed); written risk assessment; breach-response plan; BAAs with hosting, AI and any vendor that sees health data; FTC Health Breach Notification Rule for direct-to-family users; state laws.
- **Agency features:**
  - A1. one login across families, with agency badges
  - A2. agency accounts (`organizations.type = 'agency'`), `agency_staff`, `agency_shares` (family consent, roster only, no health data), offboarding of agency links
  - A3. counts-only reports
- **Native apps** (Phase 4): Capacitor, APNs/FCM via `notify()`.
