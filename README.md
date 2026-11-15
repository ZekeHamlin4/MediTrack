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

Requires Node.js 22 or newer.

```bash
cd server
npm install
cp .env.example .env   # then fill in the keys you want (see below)
npm start
```

Open http://localhost:3000. On a phone on the same Wi-Fi, use your computer's local IP address, e.g. `http://192.168.1.20:3000`.

## Settings (`server/.env`)

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
