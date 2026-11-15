# MediTrack

A home app for families caring for a medically complex child. It covers:

- **Care Team directory**: every DME company, doctor, specialist, pharmacy, nursing agency, therapist and insurer, with phone, fax, email, account numbers and department numbers (e.g. "Resupply, press 2"). Tap to call or copy any number.
- **"What to say" guides**: for each type of provider, what to have ready, a call script, and tips.
- **Setup wizard**: on first launch, enter your family info, then either type in your providers or **search by city/state** in the free national NPI registry (it returns phone and fax numbers) and tick the ones you use.
- **Care Assistant (AI)**: chat with it like a helper, for example:
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

Your data stays in a local SQLite file (`server/meditrack.db`). When you use the assistant, your messages, the family profile, and whatever the assistant looks up (providers, emails, supplies) are sent to the Claude API to produce a reply. Only run the server on a computer you trust, and don't expose it to the internet without adding a login.

## Not yet built

- Sending faxes. The assistant can write the fax text; an online fax service API (e.g. Documo, iFax, SRFax) could be added to send it.
- Placing phone calls.
- User logins / PINs for the new screens.
