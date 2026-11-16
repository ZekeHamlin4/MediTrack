# MediTrack

A home app for families caring for a medically complex child. It covers:

- **Care Team directory**: every DME company, doctor, specialist, pharmacy, nursing agency, therapist and insurer, with phone, fax, email, account numbers and department numbers (e.g. "Resupply, press 2"). Tap to call or copy any number.
- **"What to say" guides**: for each type of provider, what to have ready, a call script, and tips.
- **Setup wizard**: on first launch, enter your family info, then either type in your providers or search the free national NPI registry **near your ZIP code** (nearest offices first, with distances) or **by city/state**. It returns phone and fax numbers; tick the ones you use.
- **Care Assistant (AI)** (*switched off for now; it comes back with its privacy switches and a $10/month limit*): chat with it like a helper, for example:
  - "Email our DME company and request a new feeding pump backpack"
  - "Check my email for anything from our providers that needs a reply"
  - "Help me get a new wheelchair approved. What are the steps and who do I call?"

  It looks up the right provider, writes the email or call script, and can build a step-by-step task. **It never sends anything by itself**: emails land in the Outbox, and you review, edit and press Send.
- **Tasks**: checklists for things in progress (who you're waiting on, what's next).
- **Supplies**: the existing inventory, barcode scanning and low-stock alerts. The assistant can use them when it writes resupply requests.

## Running it

1. **One time:** install Node.js (the **LTS** version) from https://nodejs.org.
2. Download MediTrack from GitHub (green **Code** button, then **Download ZIP**) and unzip it.
3. Double-click the launcher:
   - **Windows:** `Start MediTrack.bat`
   - **Mac:** `Start MediTrack.command`. The first time, Mac may say it's from an unidentified developer: right-click the file, choose **Open**, then **Open** again.

The first launch takes a minute to set itself up. After that, MediTrack opens in your browser automatically. Keep the black window open while you use it; close it to stop MediTrack.

### First time: create your account

The first time MediTrack opens, it asks for a **setup code**. You'll find it:
- at the end of the `Install MediTrack.command` window, and as a Mac notification, or
- in the black `Start MediTrack` window, or in `~/Library/Logs/MediTrack/meditrack.log`.

Enter it, then create your account (you become the **home admin**). After that:
- Everyone signs in with **email + password** (at least 10 characters).
- To add someone (a nurse, your partner): **Settings → People → + Add person**, with a temporary password. They choose their own password the first time they sign in.
- Forgot a password, or locked out after 5 wrong tries? The home admin can **Unlock** or **Set temporary password** in Settings → People. (A lockout also ends by itself after 15 minutes.)
- **My account** shows the devices you're signed in on, so you can sign out a lost phone.

### Mac: run MediTrack in the background (recommended)

So that phones and email alerts work all day, MediTrack should run by itself on the Mac.

1. Double-click **`Install MediTrack.command`** once (same right-click → **Open** trick the first time).
2. It sets up everything, starts MediTrack in the background and opens it in your browser. You can close its window.
3. From now on MediTrack:
   - starts by itself when you log in to the Mac
   - restarts by itself if it ever crashes
   - keeps the Mac from going to sleep on its own while it runs (the screen can still turn off)
4. To stop it for good, double-click **`Uninstall MediTrack.command`**. It **never deletes your data**.

`Start MediTrack.command` still works for a manual run. If the background copy is already running, it just opens MediTrack in your browser.

Logs (no health details) are in `~/Library/Logs/MediTrack/`.

### Mac: keep the Mac awake

MediTrack can only answer phones and send alerts while the Mac is **on, awake and logged in**.

- **MacBook:** System Settings → **Battery** → **Options…** → turn on **"Prevent automatic sleeping on power adapter when the display is off"**. Optionally also turn on **"Wake for network access"**.
- **iMac / Mac mini / Mac Studio:** System Settings → **Energy** → turn on **"Prevent automatic sleeping when the display is off"** and **"Start up automatically after a power failure"**.
- **MacBook lid:** keep the **lid open and the charger plugged in**. A closed lid makes the Mac sleep, and MediTrack can't stop that.
- **After the Mac restarts, log in once so MediTrack comes back.** With FileVault on, the Mac waits at the login screen after every restart.
- **macOS updates:** System Settings → General → Software Update → **Automatic updates**: keep security responses on, but turn off **"Install macOS updates"**, so the Mac doesn't restart overnight. Install updates by hand, then log in right away.
- **Turn on FileVault** (System Settings → Privacy & Security → FileVault) and use a Mac login password.

Menu names differ a little between macOS versions. If you can't find one, search for it in System Settings.

**On your phone:** the black window shows a "On your phone" address like `http://192.168.1.20:3000`. Open it on a phone on the same Wi-Fi, then use **Add to Home Screen** to get an app icon. It works while the computer is on and MediTrack is running.

<details><summary>Advanced: start from a terminal instead</summary>

```bash
cd server
npm install
npm start
```
</details>

## Settings (`server/.env`)

The launcher creates `server/.env` for you. Open it in Notepad (Windows) or TextEdit (Mac), fill in what you want, save, then close and restart MediTrack.

| Feature | What to set |
|---|---|
| AI assistant | `ANTHROPIC_API_KEY`: create one at https://platform.claude.com |
| Send email from the app | `SMTP_*`. For Gmail, turn on 2-Step Verification and create an **App Password**, then use `smtp.gmail.com`, port `465`. |
| Read your inbox | `IMAP_*`. For Gmail: `imap.gmail.com`, port `993`, same App Password. |

Without SMTP you can still use drafts: "Open in my email app" opens a pre-filled email.

## Privacy

Your data stays in a local SQLite file (`server/meditrack.db`). When you use the assistant, your messages, the family profile, and whatever the assistant looks up (providers, emails, supplies) are sent to the Claude API to produce a reply. Everyone must sign in. Only run the server on a computer you trust, and never expose it to the public internet.

## Not yet built

- Sending faxes. The assistant can write the fax text; an online fax service API (e.g. Documo, iFax, SRFax) could be added to send it.
- Placing phone calls.
- A quick phone PIN (instead of the password) on each device.
- Password reset by email (for now the home admin sets a temporary password).
