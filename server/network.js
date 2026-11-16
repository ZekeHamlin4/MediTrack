// Phone access (M10): "Home Wi-Fi only" or "Tailscale" mode, the HTTPS address check, and where
// MediTrack listens.
// - Home Wi-Fi only (default until switched): listens on all network connections, so phones on the
//   same Wi-Fi can use http://<Mac's address>:3000. Plain HTTP: no camera on phones, no push later.
// - Tailscale: listens on this Mac only (127.0.0.1). Phones reach it through `tailscale serve`,
//   which gives a private HTTPS address like https://mt-home.tail1234.ts.net. Nothing is open on the Wi-Fi.
const crypto = require('crypto');
const { execFile } = require('child_process');
const { EventEmitter } = require('events');
const db = require('./db');

const MODES = ['lan', 'tailscale'];
const events = new EventEmitter(); // 'mode-changed' → index.js moves the listener

function getMode() { const m = db.getSetting('connection_mode', 'lan'); return MODES.includes(m) ? m : 'lan'; }
function listenHost(mode = getMode()) { return mode === 'tailscale' ? '127.0.0.1' : undefined; } // undefined = all

// A random id for this install, so the HTTPS check knows it reached *this* MediTrack.
function instanceId() {
  let id = db.getSetting('instance_id');
  if (!id) { id = crypto.randomBytes(12).toString('hex'); db.setSetting('instance_id', id); }
  return id;
}

// Only Tailscale's private addresses are accepted: https://<machine>.<tailnet>.ts.net
function normalizeHttpsUrl(u) {
  const s = String(u || '').trim().replace(/\/+$/, '').toLowerCase();
  return /^https:\/\/[a-z0-9-]+\.[a-z0-9-]+\.ts\.net$/.test(s) ? s : null;
}

// Asks the Tailscale app on this Mac for the Mac's address. Returns e.g. https://mt-home.tail1234.ts.net, or null.
const TAILSCALE_CLI = ['tailscale', '/Applications/Tailscale.app/Contents/MacOS/Tailscale', '/opt/homebrew/bin/tailscale', '/usr/local/bin/tailscale'];
function detectTailscaleUrl({ execFileFn = execFile, paths = TAILSCALE_CLI } = {}) {
  return new Promise(resolve => {
    const tryNext = i => {
      if (i >= paths.length) return resolve(null);
      execFileFn(paths[i], ['status', '--json'], { timeout: 5000 }, (err, stdout) => {
        if (err) return tryNext(i + 1);
        try {
          const name = String(JSON.parse(stdout).Self.DNSName || '').replace(/\.$/, '');
          resolve(normalizeHttpsUrl('https://' + name));
        } catch { tryNext(i + 1); }
      });
    };
    tryNext(0);
  });
}

// Checks that the HTTPS address answers and is this MediTrack.
async function checkHttps(url, { fetchFn = globalThis.fetch } = {}) {
  const u = normalizeHttpsUrl(url);
  if (!u) return { ok: false, reason: 'not_set' };
  try {
    const res = await fetchFn(u + '/api/health', { signal: AbortSignal.timeout(6000) });
    if (!res.ok) return { ok: false, reason: 'http_' + res.status };
    const data = await res.json();
    if (data.instance !== instanceId()) return { ok: false, reason: 'other_server' };
    return { ok: true };
  } catch { return { ok: false, reason: 'no_answer' }; }
}

// Words for a tired parent.
const REASONS = {
  not_set: 'No HTTPS address is set yet.',
  no_answer: "The HTTPS address isn't answering. Check that Tailscale is on and signed in on this Mac, and that `tailscale serve --bg 3000` was run (see the README).",
  other_server: 'The HTTPS address answers, but it is not this MediTrack. Check the address.',
};
const reasonText = r => REASONS[r] || 'The HTTPS address answered with an error (' + r + '). Run `tailscale serve --bg 3000` again (see the README).';

// ---------- routes ----------
const express = require('express');
const os = require('os');
const lanUrls = (port = process.env.PORT || 3000) => Object.values(os.networkInterfaces()).flat()
  .filter(a => a && a.family === 'IPv4' && !a.internal).map(a => `http://${a.address}:${port}`);

// The Mac's name shows in the address (and in public certificate logs): warn if it has the child's name.
function nameWarning(url) {
  if (!url) return null;
  const host = new URL(url).hostname.split('.')[0];
  const names = db.prepare('SELECT first_name, last_name FROM patients').all().flatMap(p => [p.first_name, p.last_name])
    .filter(n => n && n.length >= 3).map(n => n.toLowerCase());
  return names.some(n => host.includes(n))
    ? "This address contains your child's name. Rename the Mac in Tailscale to something like mt-home (see the README)." : null;
}

async function status() {
  const detected = await detectTailscaleUrl();
  let url = normalizeHttpsUrl(db.getSetting('https_url'));
  if (!url && detected) { url = detected; db.setSetting('https_url', url); }
  const check = url ? await checkHttps(url) : { ok: false, reason: 'not_set' };
  return { mode: getMode(), https_url: url, detected_url: detected, lan_urls: lanUrls(),
    https_ok: check.ok, https_message: check.ok ? null : reasonText(check.reason), name_warning: nameWarning(url) };
}

const adminRouter = express.Router();
adminRouter.get('/network', async (req, res) => {
  try { res.json(await status()); } catch { res.status(500).json({ error: 'Something went wrong' }); }
});
adminRouter.put('/network', (req, res) => {
  const url = normalizeHttpsUrl(req.body && req.body.https_url);
  if (!url) return res.status(400).json({ error: 'That is not a Tailscale address. It looks like https://mt-home.tail1234.ts.net' });
  db.setSetting('https_url', url);
  res.json({ https_url: url });
});
adminRouter.post('/network/mode', async (req, res) => {
  const mode = req.body && req.body.mode;
  if (!MODES.includes(mode)) return res.status(400).json({ error: 'Unknown mode' });
  if (mode === 'tailscale' && !(req.body && req.body.force)) {
    const check = await checkHttps(db.getSetting('https_url'));
    if (!check.ok) return res.status(409).json({ error: reasonText(check.reason) + ' Phones would not reach MediTrack.', needs_confirm: true });
  }
  const from = getMode();
  db.setSetting('connection_mode', mode);
  db.audit('connection_mode_changed', { userId: req.user.id, details: { from, to: mode } });
  // Answer first, then move the listener (index.js), so this page gets its reply.
  res.on('finish', () => setTimeout(() => events.emit('mode-changed', mode), 300));
  res.json({ mode });
});

// Public: lets the HTTPS check (and later the offline screen) see that MediTrack is up. No data.
const healthRouter = express.Router();
healthRouter.get('/health', (req, res) => res.json({ ok: true, app: 'MediTrack', instance: instanceId() }));

module.exports = { adminRouter, healthRouter, status, nameWarning, lanUrls, MODES, events, getMode, listenHost, instanceId, normalizeHttpsUrl, detectTailscaleUrl, checkHttps, reasonText };
