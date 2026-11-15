# MediTrack Design Spec

## Phase 1a: build this first (owner decision)

**Build only Phase 1a now.** Everything else in Phase 1 waits until the owner has used 1a for a few weeks and decides what comes next. Step numbers (M…) refer to section 5.

**In Phase 1a:**

| # | What | From section 5 |
|---|---|---|
| 1 | **Sign-in and permission checks** | M2, M3 |
| 2 | **Phone access over Tailscale** (HTTPS, Add to Home Screen) | M10 |
| 3 | **Documents: scan with the phone camera or upload, tag, and email from the Care Team** ("Send order" / "Send to…" by email) | M11 |
| 4 | **Provider email alerts:** connect the family mailbox, check every 5 minutes, show only known-provider emails, push "a provider emailed you" (incl. the offline summary) | M12 (email part only) + M18 |
| 5 | **Nightly encrypted backup** to iCloud Drive, with restore | M16 (backups only) |

**Minimum groundwork these need** (build only the parts that 1a uses):
- **M0** install, auto-start and stay-awake: alerts and phone access are useless if the Mac sleeps or MediTrack isn't running.
- **M1** migrations: needed for accounts, sessions, documents and backups, with the existing data upgraded in place and no demo data.
- **M13, the web app shell only:** a manifest and a service worker, needed for Home Screen install, web push and the offline screen. The esbuild bundle and no-CDN work wait.
- **Safety basics the spec never cuts** (section 0), limited to what 1a touches: audit-log writes for sign-in, documents, email and backups (M17, no viewer), and same-origin checks (M3).

**Phase 1a simplifications (until M4 Joining is built):**
- The home admin adds accounts (Settings → Add person: name, title, email, temporary password). Open sign-up stays off.
- Every active account is a member of the family's patient(s). The "everyone sees everything" trust note is shown when the home admin adds a person.
- The home admin can deactivate an account and unlock it after lockouts.
- No patient switcher (M5). If the install has one patient, it is selected automatically.

**Existing screens during 1a:**
- Care Team, Supplies, Tasks and the other current screens keep working as they do today, behind sign-in. They aren't redesigned yet.
- **Exception: the current Assistant is hidden in 1a.** It sends patient data to the AI without the consent switches and the $10 limit, which come with M12's assistant part. The owner can ask for it back sooner.
- The current bugs (section 4b) are fixed only where 1a touches the same code. The rest come with M8.

**Not in 1a:** M4 joining (invites and requests), M5 patient switcher, M6 stock log, M7 live updates, M8 bug fixes, M9 patient wizard, the M12 assistant and fax drafts, M13 bundling, M14 navigation redesign, M15 usage report, M16 settings beyond backups, the M17 audit viewer and export, and M18 events other than provider email.

**Done when:**
- the owner and a nurse can sign in on their phones over Tailscale
- a doctor's order can be scanned and emailed to a DME company from its Care Team card
- a provider email produces a push notification within about 5 minutes
- a nightly encrypted backup appears in iCloud Drive and restores on a test install

---

## 0. Goal, principle and constraints (read first)

**Goal (owner's words):**
> "A single portal where families keep all their doctors and DME/supply companies (phone, fax, email), get notified when providers email them, have the AI write emails and faxes, and get help solving problems with those providers. Eventually other families should be able to sign up."

**Principle (owner's words):**
> **MediTrack must stay very simple.** It is for a tired parent of a medically complex child. Every common task (find a number, send an order, reply to a DME email) must take as few taps as possible. Anything that doesn't serve that goes under Later features.

**Business model (owner's words):**
> "I truly want this to be a free app, but to get this partnered with a nursing company like Maxim. Then from there we can have a contract and I get paid through that."

**Budget constraint (owner):**
> "I don't have money for this."

Phase 1 must run at about $0-20 a month. Anything that costs money waits until an agency pilot (or other outside funding) pays for it.

How the builder applies these:
- **MVP rule (Phase 1):** a feature is in only if it (a) serves the goal and makes a common task faster, or (b) is needed for safety or privacy, **and (c) costs nothing (or nearly nothing) to run**. Everything else is in section 6 (Later) or Appendix A (hosted design, Phase 2+).
- **Defaults instead of settings.** One obvious button per screen, in thumb reach.
- **Never cut (all free):** hashed passwords, server-side permission checks, same-origin checks, AI consent, the stock log, the audit log, encrypted backups.
- **Build for later without paying now:** keep the family/patient scoping, the API shape and the notification abstraction so the hosted version (Phase 2) is an upgrade, not a rewrite.

### How Phase 1 covers the goal
| Goal part | Phase 1 (Family edition on the owner's Mac) |
|---|---|
| Single portal for all doctors and DME/supply companies | Care Team with phone, **fax**, email per provider and department. Reachable from every family phone, at home or away, through Tailscale (M10). |
| Notified when providers email | Free web push from the Mac whenever **any** email arrives from a known provider (M12, M18). The Mac must be on. |
| AI writes emails and faxes | Claude API, **on**, with a **$10/month hard limit** (M12). Fax drafts are PDFs sent with the family's fax app. |
| Help solving provider problems | Assistant, built-in call scripts, tasks, documents. |
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

Status: **revision 10.** New in this revision: **Phase 1a** (top of this spec) is the first build; all seven open decisions are settled with their defaults (section 13).

Revision 9 added:
- The Family edition is **Mac-first** (the owner's only computer).
- **Tailscale is approved.**
- **AI is on**, with a $10/month hard limit.
- **Backups go to iCloud Drive** (encrypted), with an optional USB copy.

Owner decisions kept from earlier rounds:
- near-zero-cost Phase 1; agency-funded Phase 2
- free for families forever
- sign-in with email + password, optional phone PIN
- "Ask for access" on by default
- everyone linked to a patient gets everything; one patient admin
- invites + access requests
- per-patient AI consent
- documents, fax drafts, live updates

Scope: evolve the existing code. Do not rewrite it.

---

## 1. Current state

**Stack**
- Server: Node 22+, Express 4, `better-sqlite3` (`server/meditrack.db`), `nodemailer` (SMTP), `imapflow` (IMAP), `@anthropic-ai/sdk` (model `claude-opus-5-5` by default, `ASSISTANT_MODEL` overrides; web search on by default; a beta request header).
- Client: one page (`client/index.html` + `client/care.jsx`). React 18 development build, Babel standalone and Quagga from public CDNs.
- Runs on a home computer via `Start MediTrack.command` (Mac) or `Start MediTrack.bat` (Windows). Both:
  - check Node ≥ 22
  - copy `.env.example` to `.env`
  - run `npm install` on first launch
  - start the server in a Terminal window that must stay open
- Phones use `http://<LAN-IP>:3000` on home Wi-Fi. One child per install. Email settings in `.env`.

**Screens:**
- Setup wizard
- Care Team
- Assistant (chat; Outbox; Inbox)
- Tasks
- Dashboard
- Supplies
- Scan
- Portal
- Activity
- Users

**Data:** `users`, `supplies`, `scan_log`, `patient_profile`, `providers`, `tasks`, `outbox`. Seeds 5 demo users (plain-text PINs) and 35 demo supplies.

**No** login, permission checks, documents, attachments, fax output, provider-email alerts, live updates, auto-start or backups.

---

## 2. Phases

| Phase | Who | Runs on | Cost to the owner | Before it starts |
|---|---|---|---|---|
| **1. Family edition** (now) | The owner's family and the people they invite | **The owner's Mac** + Tailscale (free) | **~$0-20/month** (section 9) | Nothing paid. Build **Phase 1a** first (top of spec); the rest of M0-M18 after a few weeks of use. |
| **2. Agency pilot** | One home-nursing agency (e.g. a large agency such as Maxim), some of its nurses and their families | Hosted service (Appendix A), **paid for by the agency or an upfront pilot fee** | $0 from the owner | 2-3 months of real Family edition use, metrics, demo video (section 10). Signed pilot agreement covering hosting, BAAs, lawyer review, insurance, security work. |
| **3. Public sign-up** | Any family | Hosted | Paid by agency contracts or other funding | Funding in place; everything in Appendix A. |
| **4. Grow** | More agencies | Hosted; native apps | Contract-funded | Section 11. |

**Other no-cost routes to fund Phase 2+** (general options to look into; none is promised):
- health-technology grants and foundation programs
- startup accelerators
- a technical co-founder who contributes work instead of money
- an agency's own innovation or pilot programs

**The existing home app evolves in place** (same folder and database file, upgraded by a migration). When Phase 2 starts, the hosted service imports a Family edition backup file (Appendix A).

**Windows:** the `.bat` launcher stays in the repo, but Windows setup is **not part of Phase 1** (Later, if other families need it).

---

## 3. Users and roles (Phase 1)

**Everyone linked to a patient gets everything.** The patient admin is the only special role for patient data.

> **Plain-words note (show in the app):** "Everyone you add can see and do everything for [first name]: medical information, insurance numbers, documents and the care email. Only add people you trust with all of it."

Shown on Invite, Accept request and Accept invite screens.

| Role | Who | Can |
|---|---|---|
| **Member** (title shown, e.g. Mom, Dad, Nurse, Home health aide) | Anyone linked to a patient | Everything for that patient, except admin-only actions. |
| **Patient admin** (one per patient) | Whoever created the patient profile, or someone it was transferred to | Plus **only the admin:** invite/remove people; accept/deny access requests; turn requests on/off; AI consent; transfer admin; connect the care email; permanently delete documents; archive the patient. |
| **Home admin** (a flag; the first account) | The owner, who runs MediTrack on the Mac | Computer-side settings: AI on/off and monthly limit, backups, unlock accounts, set a temporary password, reassign a patient admin to an existing member. The role gives **no extra patient access** in the app. Whoever controls the Mac can technically reach the database file, which is why backups are encrypted and the Mac should have FileVault and a login password. |
| Doctor | No login | Receives documents, letters and the usage report by email or fax. |

**Keep it to your own family in Phase 1.** Don't put another family's child on this Mac; that's where legal obligations begin (section 9).

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
1. Failed deletes show "deleted".
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
6. Server only runs while a Terminal window stays open; doesn't start at login or survive restarts.
7. Phone layout (9 tabs, small buttons).

---

## 5. Phase 1 build (Family edition, Mac): all free to run

Build in this order.

**M0. Mac setup: install, auto-start, stay awake** (new in r9)
- **Install Node:** the README links to the **nodejs.org macOS installer (LTS, version 22 or newer)**. The existing launcher already checks the version and opens the download page if it's missing or too old. Keep that.
- **New `Install MediTrack.command`** (double-click, in the repo root):
  1. Runs the same checks as `Start MediTrack.command` (Node ≥ 22, `.env`, `npm install`, client build).
  2. Writes a **LaunchAgent** at `~/Library/LaunchAgents/com.meditrack.server.plist` with:
     - `ProgramArguments`: the full path to `node` and `server/index.js`
     - `WorkingDirectory`: `server/`
     - `RunAtLoad = true`: start at login
     - `KeepAlive = true`: restart automatically if it crashes or is killed
     - `StandardOutPath` / `StandardErrorPath` → `~/Library/Logs/MediTrack/` (rotated by the app; no health data in logs)
     - `EnvironmentVariables`: `MEDITRACK_KEEP_AWAKE=1`
  3. Loads it (`launchctl bootstrap gui/$(id -u) …`), waits for the server, and opens `http://localhost:3000` for first-run setup.
  4. Prints plain next steps (Tailscale, phones).
- **New `Uninstall MediTrack.command`:** unloads and removes the LaunchAgent. It never deletes data.
- `Start MediTrack.command` stays for manual runs. If the LaunchAgent is already running, it just opens the browser.
- **Keep awake (two layers):**
  1. **App layer:** when `MEDITRACK_KEEP_AWAKE=1`, the server starts `caffeinate -i -s -w <server pid>`. This keeps the Mac from idle-sleeping while MediTrack runs (`-s` applies only when on power). The screen can still turn off. Stopping MediTrack ends `caffeinate` automatically.
  2. **System Settings** (README step with screenshots; first-run checklist reminds the owner):
     - **MacBook:** System Settings → **Battery** → **Options…** → turn on **"Prevent automatic sleeping on power adapter when the display is off"**. Optionally turn on **"Wake for network access"**.
     - **iMac / Mac mini / Mac Studio:** System Settings → **Energy** → turn on **"Prevent automatic sleeping when the display is off"** and **"Start up automatically after a power failure"** (desktops only).
     - Exact menu names vary slightly by macOS version: **verify on the owner's macOS**.
- **Laptop lid:** **keep the lid open and the charger plugged in.** A MacBook with the lid closed sleeps unless it has an external display, power and keyboard/mouse attached ("clamshell mode"), and `caffeinate` doesn't stop lid-close sleep. The display can turn off; that's fine.
- **The Mac is also the family's everyday computer:**
  - MediTrack uses little memory or CPU when idle; normal use is unaffected.
  - It runs under the owner's macOS user account and keeps running while the owner is logged in, including with the screen locked.
  - **Restarts and macOS updates:** after a restart, MediTrack (LaunchAgent) and Tailscale start again **when the owner logs in**. With FileVault on (recommended), the Mac waits at the login screen after any restart, so **MediTrack is offline until someone logs in**.
  - Automatic macOS updates may restart the Mac overnight. **Recommendation:** in System Settings → General → Software Update → **Automatic updates**, keep security responses on but turn off **"Install macOS updates"**. Install updates by hand, then log in right away.
  - A one-line README tip: "After the Mac restarts, log in once so MediTrack comes back."
- **When the Mac is off, asleep or logged out:**
  - **Phones:** the installed app's service worker shows a friendly offline screen from its cache: **"MediTrack is offline. The home Mac is off, asleep or restarting. Notifications will resume when it's back."** It includes a **Try again** button and a checklist (Mac on and logged in? Tailscale on on this phone?).
  - **Notifications stop** while the Mac is off.
  - **When it comes back:** MediTrack checks the mailbox right away. Emails that arrived meanwhile produce **one** summary push ("MediTrack: 3 provider emails arrived while MediTrack was offline."). Missed low-stock checks run once.
  - **Uptime:** Settings shows "Online since [time]" and the last offline period. The audit log records server start/stop.

**M1. Data foundation and migration in place**
- `PRAGMA user_version` + numbered migrations in `db.js`; v0 → v1 upgrades the existing `meditrack.db` (section 8). Fresh installs have no demo data.
- Keep the multi-family structure (one household row, `patient_id` everywhere, `/api/patients/:pid/…` with membership checks). Multi-family isolation tests are postponed to Phase 2.

**M2. Accounts and sign-in** (free)
- **Sign-up:** anyone who can reach the app. That already requires access via Tailscale. The home admin can turn sign-up off.
- **Fields:** name, title (display only), email, password (min 10 characters), "I am 18 or older". Email verification is postponed to Phase 2.
- **Sign in:** email + password. **Quick PIN** (optional) per device; after 12 h idle the device asks for the PIN; 5 wrong → full sign-in.
- **Forgot password:** a reset link sent from the family's connected mailbox (M12), or a temporary password set by the home admin.
- **Security:** lockout after 5 failures for 15 min; scrypt; hashed tokens; `HttpOnly`, `Secure`, `SameSite=Lax` cookie; device list.
- **First run:**
  1. A one-time **setup code** is shown in the MediTrack log window and in the macOS notification that `Install MediTrack.command` triggers.
  2. Create the home admin account.
  3. Choose the backup passphrase.
  4. Upgrade or create the first patient.

**M3. Permissions:** member / patient admin / home admin checks on every call. Remove `cors()`. Same-origin check. Errors: 401, 403, 404.

**M4. Joining:**
- **Invites:** main path; trust note; single-use; 72 h.
- **Access requests:** on by default; exact name + DOB on this install; the same answer every time; silent denials; 3 per day; hashed; audited.
- **Remove, Leave, Transfer admin.**
- **Recovery:** the home admin reassigns the patient admin to an existing member.

**M5. Patient switcher.** **M6. Stock log** (+/- movements, logged). **M7. Live updates** (SSE, in memory; refetch on reconnect; `version` checks). **M8. Bug fixes;** call scripts use the child's name. **M9. Adding a patient** (wizard).

**M10. Secure phone access: Tailscale** (approved)
- **Plan:** Tailscale's free **Personal** plan. Reported terms: non-commercial use, up to 6 users, unlimited personal devices, device sharing with outside users (**verify** on tailscale.com/pricing).
- **On the Mac:**
  1. Install **Tailscale for Mac** (Mac App Store or tailscale.com download) and sign in.
  2. Set it to **launch at login** (Tailscale menu → Settings).
  3. In the Tailscale admin page, turn on **MagicDNS** and **HTTPS certificates**.
  4. Rename the Mac in Tailscale to something **non-identifying** (e.g. `mt-home`), never the child's name. Certificate names can appear in public certificate logs (**verify** in Tailscale's HTTPS docs).
- **Serving MediTrack over HTTPS:** run `tailscale serve --bg 3000` once. The README gives the exact command. On the App Store version, enable the CLI from Tailscale's menu first (**verify** the current menu item).
  - The serve setting is meant to persist across restarts (**verify**). MediTrack's Settings shows a warning if the HTTPS address isn't answering.
  - Phones then use `https://mt-home.<tailnet>.ts.net`.
- **Local only:** in Tailscale mode, MediTrack binds to **localhost only**, so there's no plain-HTTP access from the Wi-Fi.
- **Phones:**
  - family members install Tailscale and sign into the family's network
  - **nurses** install Tailscale with their own free account, and the family **shares the Mac** with them (Tailscale "Share"; whether shared users count toward the 6 needs **verifying**)
  - then open the address → **Add to Home Screen** → open from the icon → **Turn on notifications**
- **Camera and HTTPS notes:**
  - Live barcode scanning and web push need HTTPS. The `ts.net` address provides it on every phone.
  - On the Mac itself, `http://localhost:3000` also counts as secure, so the Mac's camera works there too, though phones are the main scanners.
  - iPhone push needs iOS/iPadOS 16.4+ and the Home Screen install.
- **Fallback:** "Home Wi-Fi only" mode (plain HTTP on the LAN; no push; barcode by photo).
- **Do not** use Tailscale Funnel or any public tunnel.

**M11. Documents**
- camera capture → one PDF
- upload; 20 MB
- tags, filters
- **Send order** / **Send to…** by email or fax
- Recently deleted for 30 days
- stored in the database, so included in backups
- **Phone-side image cleanup keeps scans small** (about 200-400 KB per page; see backup sizing in M16)

**M12. Family email, provider messages, assistant**
- **Email:** the family's Gmail/Outlook with an **app password**, stored encrypted (key in `server/secret.key`, included in the encrypted backup). Shown at connect: use a separate address for care and supply companies.
- **Provider messages:** check every 5 min; only known-provider emails shown; push "a provider emailed you"; AI never runs on incoming mail by itself.
- **Fax drafts:** PDF → Share → Mark as faxed.
- **Assistant: ON** (owner decision) with a **$10/month hard limit**:
  - MediTrack records tokens and estimated cost per call (`ai_usage`; prices in `settings`, editable) and stops the assistant for the rest of the month at $10: "This month's AI limit is reached. Everything else still works."
  - Settings shows "$4.10 of $10 used this month".
  - **Second safety net:** in the Anthropic Console, turn **off auto-reload**, load a small prepaid amount (e.g. $10), and set a monthly spend limit where available (**verify** in the Console).
  - **Default model:** a lower-cost tier (e.g. Sonnet-class) via `ASSISTANT_MODEL`; `max_tokens` about 4,000; at most 6 tool rounds.
  - **Consent per patient stays off by default:** the assistant works with `[placeholders]` until the patient admin turns sharing on.
  - **Web search:** on (home admin can turn it off).
  - **Kept:** server-side conversation, provider-change confirm card, `draft_email` / `draft_fax` / `list_documents`.

**M13. Pre-compiled client and web app shell**
- esbuild bundle (no CDNs); manifest, icons.
- **Service worker** caches the app shell so the offline screen (M0) shows when the Mac is unreachable.

**M14. Phone-first navigation, Home quick actions, computer Overview.** **M15. Printable usage report.**

**M16. Home admin settings and backups (iCloud Drive by default)**
- **Default destination: the owner's iCloud Drive**, folder `iCloud Drive/MediTrack Backups` (on disk: `~/Library/Mobile Documents/com~apple~CloudDocs/MediTrack Backups`).
- **Why iCloud Drive is the smarter default:**
  - it's **off-site**: a copy survives the Mac being lost, stolen, damaged or failing
  - a USB drive sitting next to the Mac usually goes down with it (theft, fire, spills, power surge)
  - it's already on the Mac and costs nothing extra at first
- **Encrypted before it leaves MediTrack:**
  - each backup is a single file (database + `secret.key`) encrypted with the **backup passphrase** (AES-256-GCM; key derived with scrypt)
  - Apple only ever stores the encrypted file
  - files are written to a temporary name and then renamed, so iCloud never uploads a half-written backup
- **Schedule and retention:**
  - nightly at 2 am (and **Back up now**)
  - keep the **last 7 nightly** backups plus **1 per month for the last 3 months** (about 10 files)
- **Size estimate** (rough):
  - database without documents: ~1-5 MB
  - scanned documents: ~0.2-0.4 MB per page, so a 2-page order is ~0.5-1 MB
  - a family adding ~10 documents a month adds ~5-10 MB/month, so after a year one backup is roughly **60-150 MB**
  - 10 kept files ≈ **0.6-1.5 GB** after a year (less in the first months)
- **Is free iCloud (5 GB) enough?**
  - At first, yes: likely well under 1 GB in the first months.
  - **But the free 5 GB is shared with iPhone backups and photos, which often fill it.** Settings shows the total size of the backup folder and warns if a backup fails to write.
  - If iCloud is full: either free up space, reduce retention (e.g. 5 nightly + 2 monthly), or upgrade to the smallest paid iCloud+ tier (about $0.99/month in the US at the time of writing; **verify**), still within budget.
- **Optional extra:** a second copy to a **USB drive** when plugged in. Settings → Backups → "Also copy to: [choose drive]"; copies the newest backup whenever that drive is present.
- **Status:** Settings shows "Last backup: today 2:00 am · in iCloud Drive". A Home banner appears if the last backup is older than 3 days.
- **Restore:** choose a backup file (from iCloud Drive or USB), enter the passphrase, confirm. Works on a new Mac after reinstalling MediTrack.
- **At setup:** "Write the backup passphrase down and keep it safe (not only on this Mac). Without it, backups can't be opened, not even by us."
- **Other Settings** (home admin):
  - connection mode and HTTPS status
  - uptime
  - sign-up on/off
  - AI (on/off, monthly limit, model, web search, usage)
  - email status
  - accounts (unlock, temporary password, deactivate)
  - patient-admin recovery
  - audit export

**M17. Audit log** (written; CSV export; includes server start/stop).

**M18. Push notifications** (standard web push, free)
- **Events:** provider emailed you; assistant has an update; low stock (alert items); joined / asked to join / admin transfer; "emails arrived while offline" summary.
- **Text and settings:** generic text only; two switches per patient.
- **Sending:** abstracted through `notify()` (`platform` field).
- **Works only while the Mac is on, awake and logged in.**

**Postponed to Phase 2 (Appendix A):** email verification service, OAuth email and Google verification, managed hosting and BAAs, operator console, multi-family isolation tests, 2-step sign-in, account deletion, importing into the hosted service, Windows setup.

---

## 6. Later features

- **Phase 2+:** everything in Appendix A.
- Windows (and Linux) Family edition setup, if other families need it.
- Native iOS/Android apps (section 11).
- Built-in fax sending.
- Access levels or per-person switches, *could add if needed*.
- Doctor login.
- Document auto-crop; assistant reading document contents.
- Resupply schedule; expiry/lot numbers; go-bag checklist; one-tap reorder.
- Task assignment; shift notes; offline editing.
- Other families running their own free Family edition, once the setup guide is tested on the owner's Mac (decision 6, section 13).
- **Not planned:** family billing of any kind.

---

## 7. Screens (Phase 1)

**Navigation (phone):** bottom bar **Home · Supplies · Care Team · Documents · Assistant**.
- Header: patient chip, live dot, menu (**My profile**, **Patient profile**, **Members**, **Tasks**, **Usage report**, **Settings** (home admin), **Sign out**).
- Computer: top bar + **Overview**.

1. **Welcome / first run (on the Mac)**:
   1. setup code
   2. create the home admin account
   3. backup passphrase (iCloud Drive folder preselected)
   4. "Keep this Mac awake" checklist (Battery/Energy setting, lid open + plugged in, log in after restarts)
   5. Tailscale guide
   6. add or upgrade the first patient
2. **Sign in**: email, password (or device PIN), **Forgot password**, **Create account**.
3. **Create account**: name, title, email, password, 18+.
4. **No patients yet**: **Enter invite code** · **Ask for access** · **Create a patient profile**.
5. **Accept invite** (trust note) / **Ask for access** (same confirmation always).
6. **Home (phone)**:
   - Waiting on you
   - Quick contacts
   - Running low
   - Issues & tasks
   - **Scan supply** / **Scan document**
   - iPhone notifications card
   - backup warning if needed
7. **Offline screen** (cached): "MediTrack is offline. The home Mac is off, asleep or restarting…" + **Try again** + checklist.
8. **Overview (computer)**.
9. **Supplies**, **Scan supply**, **Supply detail**, **History**.
10. **Care Team**.
11. **Documents**, **Scan document flow**, **Document view**, **Draft (email/fax)**.
12. **Assistant**: chat; "$X of $10 this month" (home admin) or "Assistant available" (others); Provider emails; Outbox; consent banner.
13. **Tasks**.
14. **Patient profile**: admin: **AI sharing**, **Connect care email**, **Archive patient**.
15. **Members**.
16. **My profile**.
17. **Settings** (home admin):
    - **Mac status:** online since, keep-awake on, HTTPS address check
    - **Backups:** iCloud folder, size, last backup, **Back up now**, **Restore**, optional USB copy, passphrase change
    - **AI:** limit, usage, model, web search
    - email, sign-up, accounts, recovery, audit export

---

## 8. Data (Phase 1)

Migrations use `PRAGMA user_version`. The existing `meditrack.db` is **upgraded in place** (v0 → v1).

**v1 tables:**
- `organizations`: one household row
- `patients`
- `patient_members`
- `invites`
- `join_requests`, `request_blocks`
- `admin_transfers`
- `ai_consents`
- `documents`, `document_files`, `outbox_attachments`
- `provider_emails_seen`
- `email_connections`: `imap` only; secret encrypted
- `sessions`
- `auth_tokens`: `reset_password` only
- `audit_log`
- `settings`
- `push_subscriptions`
- `ai_usage`

These are as in revisions 6-8, with:
- `users.is_home_admin`.
- `ai_usage(org_id, month, requests, input_tokens, output_tokens, est_cost_cents)`.
- **`settings` keys:**
  - access and AI: `signups_open`, `assistant_enabled` (default **1**), `ai_monthly_limit_cents` (default **1000**), `assistant_model`, `assistant_web_search`, `model_prices_json`
  - connection: `connection_mode` (`tailscale` | `lan`)
  - backups: `backup_dir` (default the iCloud Drive path), `backup_copy_dir` (optional USB), `backup_keep_nightly` (7), `backup_keep_monthly` (3), `backup_last_at`, `backup_kdf_salt`
  - other: `server_started_at`, `vapid_public_key`, `vapid_private_key`
- Not created in Phase 1: `agency_staff`, `agency_shares`.

**Existing tables:**
- `supplies`, `scan_log`, `providers`, `tasks`, `outbox` get `patient_id` and `version`.
- `outbox` also gets the fax/channel fields.
- `supplies` also gets `alert_enabled` / `alert_sent_at`; barcodes unique per patient.

**Migration v0 → v1 (in place):**
1. Household row.
2. Old users deactivated, PINs cleared.
3. Setup code → home admin account.
4. Patient from `patient_profile` (name split and DOB confirmed), with that account as patient admin.
5. Backfill `patient_id` / `version`.
6. Mark the inbox as seen.
7. Pick alert items.
8. **Run the first encrypted backup to iCloud Drive immediately.**

---

## 9. Privacy, legal and cost (Phase 1)

### Is a lawyer or a BAA needed to start? (plain words; confirm with a lawyer when there's money)
- **HIPAA generally applies to covered entities** (doctors, hospitals, nursing agencies that bill insurance, health plans, billing clearinghouses) **and their business associates**. It generally does **not** apply to a family keeping their own child's records on their own Mac.
- So Phase 1 generally needs **no BAAs, no hosting agreement and no lawyer** to start.
- **The family still decides what goes to the AI:** consent per patient, off by default, set by the patient admin. Read Anthropic's current API data terms before turning sharing on.
- **Backups in iCloud Drive are encrypted by MediTrack before upload**, so Apple stores only an unreadable file.
- **What changes:**
  1. **holding another family's data** (the FTC Health Breach Notification Rule and state laws likely apply; don't do this in Phase 1)
  2. **an agency getting involved** (MediTrack likely becomes the agency's business associate; that's Phase 2, paid by the pilot)
  3. **commercial use** (Tailscale's free plan is non-commercial)
- This is a plain-language summary, **not legal advice**.

### Security basics (all free)
- HTTPS via Tailscale; localhost-only binding.
- Encrypted email password and backups.
- **Turn on FileVault** (System Settings → Privacy & Security → FileVault) and use a Mac login password.
- Hashed passwords, lockout, server-side checks, same-origin checks, no CORS.
- Audit log; no health details in logs (`~/Library/Logs/MediTrack`).
- No trackers; generic push text.

### Downsides of the Family edition (be honest)
- **The Mac must stay on, awake and logged in**: lid open, plugged in, sleep prevented (M0). If it's off or restarting, phones show "MediTrack is offline" and notifications stop until it's back.
- **After a restart or macOS update, someone must log in** before MediTrack comes back (FileVault).
- **Everyone needs Tailscale switched on**, including each nurse. Tapping a notification needs Tailscale connected.
- **Backups depend on iCloud space**; the passphrase must not be lost.
- **One Mac = one point of failure**; restore from iCloud onto another Mac if needed.

### Phase 1 cost (estimates)
| Item | Monthly cost (estimate) | Notes |
|---|---|---|
| The owner's Mac | $0 | Already owned. |
| Electricity to keep it on 24/7 | ~$1-$5 | MacBooks and Mac minis use little power when idle; depends on local rates. |
| Tailscale Personal | $0 | Free, non-commercial; verify limits. |
| HTTPS certificate | $0 | Through Tailscale. |
| Web push | $0 | |
| Email (Gmail/Outlook app password) | $0 | |
| Claude API (AI on) | **~$2-$10; hard limit $10** | Lower-cost model; roughly $0.03-$0.20 per request (third-party price lists, Oct 2026; **verify** on Anthropic's pricing page). |
| Backups in iCloud Drive | $0 at first | Free 5 GB is likely enough for months **if** not already full of photos/phone backups. Smallest iCloud+ tier ~$0.99/month (US; verify) if needed. |
| Optional USB drive | ~$10 one-time | Only if the owner wants a second copy. |
| **Total** | **~$2-$16/month** | Mostly AI, plus electricity, plus iCloud+ if needed. |

### What costs money later, and who pays
| Item | Phase | Rough cost (estimate) | Who pays |
|---|---|---|---|
| Hosting with a BAA, backups, monitoring | 2 | ~$300-$450/month | Agency / pilot fee |
| Anthropic BAA (minimum spend unknown, **verify**) | 2 | Usage + any minimum | Agency |
| Lawyer: agreement, BAA, terms, privacy policy | 2 | ~$2,000-$10,000 | Agency / pilot fee, or a grant |
| Cyber-liability insurance | 2 | ~$1,000-$5,000/year (**uncertain**) | Agency / pilot fee |
| Penetration test / security work | 2 | ~$5,000-$20,000 (**uncertain**) | Agency, if required |
| Google email verification + CASA | 3 | ~$500-$5,000+/year | Contracts / funding |
| SOC 2 | 4 | ~$20,000-$60,000 first year (**uncertain**) | Contracts, if required |
| Apple / Google developer accounts | 4 | $99/year / $25 one-time | Contract revenue |

### Sources checked (Nov 2026; re-verify before relying on them)
- Tailscale: [free plans](https://tailscale.com/docs/account/manage-plans/free-plans-discounts), [HTTPS certificates](https://tailscale.com/kb/1153/enabling-https/), [device sharing](https://tailscale.com/blog/sharing-over-tailscale); [CostBench](https://www.costbench.com/software/business-vpn/tailscale/free-plan/), [SSD Nodes](https://www.ssdnodes.com/learn/is-tailscale-free-plan-limits)
- Anthropic: [spend limits](https://platform.claude.com/docs/en/api/admin/spend_limits/create.md), [API and data retention](https://platform.claude.com/docs/en/manage-claude/api-and-data-retention); [BenchLM](https://benchlm.ai/anthropic/api-pricing), [Finout](https://finout.io/blog/anthropic-api-pricing)
- FTC: [Health Breach Notification Rule](https://www.ftc.gov/system/files/ftc_gov/pdf/p205405healthbreachnotificationrule.pdf)
- Apple: [web push for Home Screen web apps](https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers)
- **Not re-checked this round** (verify on the owner's Mac): macOS Battery/Energy menu names, LaunchAgent behaviour with FileVault, `caffeinate` flags (`man caffeinate`), iCloud+ pricing, Tailscale Mac CLI and serve persistence.

---

## 10. Partnering with a nursing agency (funded by the agency)

Unchanged from revision 8:
- **Pitch** with the working Family edition: 2-3 months of real use, metrics (orders sent, time-to-send, provider emails handled, stock-outs avoided, AI cost), a 2-minute demo video and a one-page summary.
- **Why an agency would pay:** nurse time saved, fewer DME problems, family satisfaction, documentation.
- **The pilot agreement pays for** hosting with a BAA, BAAs (agency, AI, vendors), lawyer review, insurance and security work, either directly or through an upfront pilot fee.
- **Legally,** the agency is likely a covered entity, so MediTrack becomes its business associate.
- **Agency features A1-A3** (Appendix A); the family always stays patient admin.
- **What agencies typically ask:** security questionnaire, pen test or SOC 2, insurance, uptime, data ownership and export, sometimes SSO.
- **Uptime:** an always-on hosted service fixes the Family edition's "Mac must be on" limitation. That is part of what the pilot pays for.

---

## 11. Phone app path

- **Phase 1:** installable web app with free web push over the Tailscale HTTPS address. iPhone needs iOS/iPadOS 16.4+ and Home Screen install. The service worker shows the offline screen.
- **Phase 4:** native iOS/Android via Capacitor, with the bundled client and native push. Needs paid developer accounts.
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
7. Patient chip; "Name (Title)"; "Admin" badge.
8. Undo instead of confirms, except sending and permanent delete.
9. Soft highlight on others' changes.
10. Phone, fax and email on separate lines.
11. Trust note in orange "needs attention" style.
12. AI limit in calm gray until less than 20% is left.
13. Offline screen: calm, gray, friendly. "The home Mac is off or restarting." Not red; it isn't an error the user caused.

---

## 13. Decisions

**No open decisions.** In revision 10 the owner accepted the default for all seven remaining questions. Earlier answers are recorded in the sections above.

| # | Decision | Settled as (default) |
|---|---|---|
| 1 | AI permission split | Two switches per child, both **off** until the patient admin turns them on: **"medical info"** (diagnoses, equipment, notes, supply list) and **"personal & insurance info"** (name, birth date, address, insurance numbers, care team). |
| 2 | Siblings sharing a pharmacy or supply company | Entered **separately for each child**. |
| 3 | Starter supply list | **Offered:** the 35 trach / vent / G-tube items with counts at 0. Optional at setup, never added automatically. |
| 4 | Call scripts | Use the **child's name**, never "he/she". |
| 5 | Resupply schedule | **Later** (section 6). |
| 6 | Other families running their own copy | **Not until** the setup guide has been tested on the owner's Mac. Revisit later (section 6). |
| 7 | Agency offboarding (Phase 2 pilot) | **The agency can end agency-linked access** when a nurse leaves; the family is told. Links the family made itself stay under the family's control. |

---

## Appendix A. Hosted design for Phase 2+ (parked; funded by the pilot)

Unchanged from revision 8:
- **Hosting:** managed BAA platform or big cloud; encrypted disk; continuous encrypted off-site backups; isolation tests in CI.
- **Accounts:** email verification; password reset by email; 2-step sign-in; 18+; device PIN.
- **Email:** OAuth (Google verification + CASA; Microsoft), with app passwords as an encrypted fallback.
- **AI:** Anthropic BAA (HIPAA-ready organization; remove the beta header and `fallbacks`; web search only if eligible; per-family cap).
- **Operations:** operator console with no patient data; data export/delete; import of a Family edition encrypted backup.
- **Legal:** terms and privacy policy, risk assessment, breach plan, BAAs.
- **Agency features:** A1 one login across families; A2 agency accounts with family-consented roster and offboarding; A3 counts-only reports.
- **Native apps** (Phase 4).
