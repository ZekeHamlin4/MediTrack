// Sign-in, sessions and permission checks (M2 + M3).
// - Passwords: scrypt with a random salt per password. Never stored or logged in plain text.
// - Sessions: a random token in an HttpOnly, SameSite=Lax cookie (Secure over HTTPS).
//   Only a SHA-256 hash of the token is stored, so a copy of the database can't be used to sign in.
// - Lockout: 5 wrong passwords lock the account for 15 minutes (the home admin can unlock sooner).
// - Same-origin check: requests that change data must come from MediTrack's own pages.
// - Errors: 401 = not signed in, 403 = not allowed, 404 = not found (also used for other patients' data).
const crypto = require('crypto');
const express = require('express');
const db = require('./db');

const COOKIE = 'mt_session';
const SESSION_DAYS = 30;            // a session ends after 30 days without use
const TOUCH_EVERY_MS = 5 * 60 * 1000;
const MAX_FAILS = 5;
const LOCK_MINUTES = 15;
const SETUP_MAX_FAILS = 5;

// ---------- passwords (see passwords.js; shared with the Mac reset tool) ----------
const { hashPassword, verifyPassword, passwordProblem, MIN_PASSWORD } = require('./passwords');
// Used when the email is unknown, so a wrong email takes as long as a wrong password.
let dummyHash = null;
async function burnTime(password) {
  if (!dummyHash) dummyHash = await hashPassword('not-a-real-password');
  await verifyPassword(password, dummyHash);
}

const normEmail = e => String(e || '').trim().toLowerCase();
const validEmail = e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

// ---------- helpers ----------
function fail(status, message, extra) { const e = new Error(message); e.status = status; e.extra = extra; return e; }
const wrap = fn => async (req, res, next) => {
  try { await fn(req, res, next); }
  catch (e) { res.status(e.status || 500).json({ error: e.status ? e.message : 'Something went wrong', ...(e.extra || {}) }); }
};
const nowIso = () => new Date().toISOString();
const sha256 = s => crypto.createHash('sha256').update(s).digest('hex');

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

const isLoopback = ip => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(ip);
// HTTPS reaches MediTrack through `tailscale serve` (M10), which forwards to localhost.
function isHttps(req) {
  if (req.secure) return true;
  if (isLoopback(req.socket.remoteAddress) && req.get('x-forwarded-proto') === 'https') return true;
  return /\.ts\.net$/i.test((req.get('host') || '').split(':')[0]);
}

function cookieHeader(req, value, maxAgeSeconds) {
  const parts = [`${COOKIE}=${value}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAgeSeconds}`];
  if (isHttps(req)) parts.push('Secure');
  return parts.join('; ');
}

function deviceName(ua) {
  ua = String(ua || '');
  const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android phone'
    : /Macintosh|Mac OS X/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows computer' : 'Device';
  const br = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : '';
  return br ? `${os} (${br})` : os;
}

function createSession(req, res, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + SESSION_DAYS * 864e5).toISOString();
  db.prepare('INSERT INTO sessions (user_id, token_hash, device_name, created_at, last_seen_at, expires_at) VALUES (?,?,?,?,?,?)')
    .run(userId, sha256(token), deviceName(req.get('user-agent')), nowIso(), nowIso(), expires);
  res.setHeader('Set-Cookie', cookieHeader(req, token, SESSION_DAYS * 86400));
}
function clearCookie(req, res) { res.setHeader('Set-Cookie', cookieHeader(req, '', 0)); }

function revokeSessions(userId, exceptSessionId = null) {
  db.prepare('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL AND id IS NOT ?').run(nowIso(), userId, exceptSessionId);
}

function publicUser(u) {
  return { id: u.id, name: u.name, title: u.title, email: u.email, is_home_admin: !!u.is_home_admin, must_change_password: !!u.must_change_password };
}

// The patients this account belongs to (Phase 1a: every active account is a member of every patient).
function myPatients(userId) {
  return db.prepare(`SELECT p.id, p.first_name, p.last_name, p.dob, p.onboarded, m.is_patient_admin
    FROM patient_members m JOIN patients p ON p.id = m.patient_id
    WHERE m.user_id = ? AND p.archived_at IS NULL ORDER BY p.id`).all(userId)
    .map(p => ({ ...p, is_patient_admin: !!p.is_patient_admin }));
}

function addToAllPatients(userId, { asAdmin = false } = {}) {
  for (const p of db.prepare('SELECT id FROM patients WHERE archived_at IS NULL').all()) {
    const hasAdmin = db.prepare('SELECT 1 FROM patient_members WHERE patient_id = ? AND is_patient_admin = 1').get(p.id);
    db.prepare('INSERT OR IGNORE INTO patient_members (patient_id, user_id, is_patient_admin) VALUES (?,?,?)')
      .run(p.id, userId, asAdmin && !hasAdmin ? 1 : 0);
  }
}

// So nothing is typed twice: the child's profile asks "Your name" and "Your email", which the
// account form already asked. Copy them into the profile, but never overwrite something already there.
function prefillParentFromAccount(userId) {
  const u = db.prepare('SELECT name, email FROM users WHERE id = ?').get(userId);
  db.prepare(`UPDATE patients SET
      parent_name = CASE WHEN TRIM(COALESCE(parent_name, '')) = '' THEN ? ELSE parent_name END,
      parent_email = CASE WHEN TRIM(COALESCE(parent_email, '')) = '' THEN ? ELSE parent_email END
    WHERE id IN (SELECT patient_id FROM patient_members WHERE user_id = ? AND is_patient_admin = 1)`)
    .run(u.name, u.email, userId);
}

// ---------- middleware ----------
// Same-origin check for anything that can change data (also blocks sign-in from other websites).
function sameOrigin(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  let src = req.get('origin');
  if (!src) { try { src = new URL(req.get('referer')).origin; } catch {} }
  let host = null;
  try { host = new URL(src).host; } catch {}
  // `tailscale serve` passes the phone's address in X-Forwarded-Host; only trusted from this Mac itself.
  const allowed = [req.get('host'), isLoopback(req.socket.remoteAddress) ? req.get('x-forwarded-host') : null].filter(Boolean);
  if (!host || !allowed.includes(host)) return res.status(403).json({ error: 'This request did not come from MediTrack.' });
  next();
}

// Reads the session cookie, if any. Never blocks by itself.
function loadSession(req, res, next) {
  const token = parseCookies(req.get('cookie'))[COOKIE];
  if (!token) return next();
  const s = db.prepare('SELECT * FROM sessions WHERE token_hash = ?').get(sha256(token));
  if (!s || s.revoked_at || s.expires_at <= nowIso()) return next();
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(s.user_id);
  if (!u || !u.active || !u.password_hash) return next();
  req.user = u;
  req.session = s;
  if (Date.now() - Date.parse(s.last_seen_at) > TOUCH_EVERY_MS) {
    db.prepare('UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE id = ?')
      .run(nowIso(), new Date(Date.now() + SESSION_DAYS * 864e5).toISOString(), s.id);
  }
  next();
}

function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Please sign in.' });
  next();
}
// After a temporary password, nothing else works until the person picks their own.
function requireReady(req, res, next) {
  if (req.user.must_change_password) return res.status(403).json({ error: 'Please choose a new password first.', must_change_password: true });
  next();
}
function requireHomeAdmin(req, res, next) {
  if (!req.user || !req.user.is_home_admin) return res.status(403).json({ error: 'Only the home admin can do this.' });
  next();
}
// Mounted on /api/patients/:pid. Other patients' data looks the same as data that doesn't exist (404).
function requirePatientMember(req, res, next) {
  const pid = Number(req.params.pid);
  const row = Number.isInteger(pid) && db.prepare(`SELECT m.is_patient_admin FROM patient_members m JOIN patients p ON p.id = m.patient_id
    WHERE m.patient_id = ? AND m.user_id = ? AND p.archived_at IS NULL`).get(pid, req.user.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  req.patientId = pid;
  req.isPatientAdmin = !!row.is_patient_admin;
  next();
}
// For patient-admin-only actions (used from later steps, e.g. connecting the care email).
function requirePatientAdmin(req, res, next) {
  if (!req.isPatientAdmin) return res.status(403).json({ error: 'Only the patient admin can do this.' });
  next();
}

// ---------- first-run setup code ----------
let setupCode = null;
let setupFails = 0;
function needsSetup() {
  return !db.prepare('SELECT 1 FROM users WHERE is_home_admin = 1 AND active = 1 AND password_hash IS NOT NULL').get();
}
function newSetupCode() {
  const n = crypto.randomInt(0, 1e8).toString().padStart(8, '0');
  setupCode = n.slice(0, 4) + '-' + n.slice(4);
  setupFails = 0;
  return setupCode;
}
// Called at start-up. Returns the code to show on the Mac, or null if setup is done.
function prepareSetupCode(log = console.log) {
  if (!needsSetup()) { setupCode = null; return null; }
  newSetupCode();
  log('');
  log('  First-time setup: open MediTrack on this Mac and enter this setup code: ' + setupCode);
  log('');
  require('./macos').notify('MediTrack setup code: ' + setupCode);
  return setupCode;
}

// ---------- routes: setup ----------
const setupRouter = express.Router();
setupRouter.get('/setup/status', (req, res) => res.json({ needs_setup: needsSetup() }));
setupRouter.post('/setup', wrap(async (req, res) => {
  if (!needsSetup()) throw fail(409, 'MediTrack is already set up. Please sign in.');
  const { code, name, title, email, password, over18 } = req.body || {};
  if (!setupCode) prepareSetupCode();
  const given = String(code || '').replace(/\D/g, '');
  const want = setupCode.replace(/\D/g, '');
  if (given.length !== want.length || !crypto.timingSafeEqual(Buffer.from(given), Buffer.from(want))) {
    setupFails++;
    db.audit('setup_code_wrong');
    if (setupFails >= SETUP_MAX_FAILS) {
      prepareSetupCode();
      throw fail(403, 'Too many wrong codes. A new setup code is now shown on the Mac.');
    }
    throw fail(403, 'That setup code is not right. Check the code shown on the Mac.');
  }
  const em = normEmail(email);
  if (!String(name || '').trim()) throw fail(400, 'Please enter your name.');
  if (!validEmail(em)) throw fail(400, 'Please enter a valid email address.');
  const pwErr = passwordProblem(password); if (pwErr) throw fail(400, pwErr);
  if (!over18) throw fail(400, 'You must be 18 or older to use MediTrack.');
  const hash = await hashPassword(password);
  if (!needsSetup()) throw fail(409, 'MediTrack is already set up. Please sign in.');
  const userId = saveAccount({ name, title, email: em, hash, isHomeAdmin: true, mustChange: false });
  addToAllPatients(userId, { asAdmin: true });
  prefillParentFromAccount(userId);
  setupCode = null;
  db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(nowIso(), userId);
  db.audit('home_admin_created', { userId });
  createSession(req, res, userId);
  db.audit('sign_in', { userId });
  res.status(201).json({ user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(userId)), patients: myPatients(userId) });
}));

// Creates an account, or re-uses an old pre-M1 row with the same email (it has no password).
function saveAccount({ name, title, email, hash, isHomeAdmin, mustChange }) {
  const org = db.prepare('SELECT id FROM organizations ORDER BY id LIMIT 1').get();
  const existing = db.prepare('SELECT * FROM users WHERE lower(email) = ?').get(email);
  if (existing && existing.password_hash) throw fail(409, 'Someone with that email already has an account.');
  const vals = [String(name).trim(), String(title || '').trim() || null, email, hash, isHomeAdmin ? 1 : 0, mustChange ? 1 : 0, org.id];
  if (existing) {
    db.prepare(`UPDATE users SET name=?, title=?, email=?, password_hash=?, is_home_admin=?, must_change_password=?, org_id=?,
      active=1, failed_logins=0, locked_until=NULL, pin_hash=NULL WHERE id=?`).run(...vals, existing.id);
    return existing.id;
  }
  return db.prepare(`INSERT INTO users (name, title, email, password_hash, is_home_admin, must_change_password, org_id, role, active)
    VALUES (?,?,?,?,?,?,?, 'family', 1)`).run(...vals).lastInsertRowid;
}

// ---------- routes: sign-in and my account ----------
const authRouter = express.Router();
authRouter.post('/auth/login', wrap(async (req, res) => {
  const email = normEmail(req.body?.email);
  const password = String(req.body?.password || '');
  const u = email && db.prepare('SELECT * FROM users WHERE lower(email) = ? AND password_hash IS NOT NULL').get(email);
  const wrong = () => fail(401, 'Email or password is not right.');
  if (!u) { await burnTime(password); db.audit('sign_in_failed', { details: { reason: 'unknown_email' } }); throw wrong(); }
  if (u.locked_until && u.locked_until > nowIso()) {
    db.audit('sign_in_blocked_locked', { userId: u.id });
    throw fail(429, `Too many wrong passwords. Try again in ${LOCK_MINUTES} minutes, or ask the home admin to unlock your account.`);
  }
  const ok = await verifyPassword(password, u.password_hash);
  if (!ok || !u.active) {
    if (u.active) {
      const fails = (u.locked_until && u.locked_until <= nowIso() ? 0 : u.failed_logins) + 1;
      if (fails >= MAX_FAILS) {
        db.prepare('UPDATE users SET failed_logins = 0, locked_until = ? WHERE id = ?').run(new Date(Date.now() + LOCK_MINUTES * 60000).toISOString(), u.id);
        db.audit('account_locked', { userId: u.id });
      } else {
        db.prepare('UPDATE users SET failed_logins = ?, locked_until = NULL WHERE id = ?').run(fails, u.id);
      }
    }
    db.audit('sign_in_failed', { userId: u.id, details: { reason: u.active ? 'wrong_password' : 'account_off' } });
    throw wrong();
  }
  db.prepare('UPDATE users SET failed_logins = 0, locked_until = NULL, last_login_at = ? WHERE id = ?').run(nowIso(), u.id);
  createSession(req, res, u.id);
  db.audit('sign_in', { userId: u.id });
  const fresh = db.prepare('SELECT * FROM users WHERE id = ?').get(u.id);
  res.json({ user: publicUser(fresh), patients: myPatients(u.id) });
}));

authRouter.post('/auth/logout', (req, res) => {
  if (req.session) {
    db.prepare('UPDATE sessions SET revoked_at = ? WHERE id = ?').run(nowIso(), req.session.id);
    db.audit('sign_out', { userId: req.user.id });
  }
  clearCookie(req, res);
  res.json({ success: true });
});

authRouter.get('/auth/me', requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user), patients: myPatients(req.user.id) });
});

authRouter.post('/auth/password', requireAuth, wrap(async (req, res) => {
  const { current, password } = req.body || {};
  if (!(await verifyPassword(String(current || ''), req.user.password_hash))) throw fail(400, 'Your current password is not right.');
  const pwErr = passwordProblem(password); if (pwErr) throw fail(400, pwErr);
  if (password === current) throw fail(400, 'Please choose a different password.');
  db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?').run(await hashPassword(password), req.user.id);
  revokeSessions(req.user.id, req.session.id); // sign out other devices
  db.audit('password_changed', { userId: req.user.id });
  res.json({ success: true });
}));

authRouter.get('/auth/sessions', requireAuth, (req, res) => {
  const rows = db.prepare(`SELECT id, device_name, created_at, last_seen_at FROM sessions
    WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ? ORDER BY last_seen_at DESC`).all(req.user.id, nowIso());
  res.json(rows.map(r => ({ ...r, current: r.id === req.session.id })));
});
authRouter.delete('/auth/sessions/:id', requireAuth, (req, res) => {
  const r = db.prepare('UPDATE sessions SET revoked_at = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL').run(nowIso(), req.params.id, req.user.id);
  if (!r.changes) return res.status(404).json({ error: 'Not found' });
  db.audit('device_signed_out', { userId: req.user.id });
  res.json({ success: true });
});

// ---------- routes: home admin (Settings → People) ----------
const adminRouter = express.Router();
function listPeople() {
  const now = nowIso();
  return db.prepare(`SELECT id, name, title, email, active, is_home_admin, must_change_password, locked_until, last_login_at, created_at
    FROM users WHERE password_hash IS NOT NULL ORDER BY active DESC, name`).all()
    .map(u => ({ ...u, active: !!u.active, is_home_admin: !!u.is_home_admin, must_change_password: !!u.must_change_password,
      locked: !!(u.locked_until && u.locked_until > now) }));
}
function getPerson(id) {
  const u = db.prepare('SELECT * FROM users WHERE id = ? AND password_hash IS NOT NULL').get(id);
  if (!u) throw fail(404, 'Not found');
  return u;
}
adminRouter.get('/users', (req, res) => res.json(listPeople()));
adminRouter.post('/users', wrap(async (req, res) => {
  const { name, title, email, password } = req.body || {};
  const em = normEmail(email);
  if (!String(name || '').trim()) throw fail(400, 'Please enter a name.');
  if (!validEmail(em)) throw fail(400, 'Please enter a valid email address.');
  const pwErr = passwordProblem(password); if (pwErr) throw fail(400, 'Temporary password: ' + pwErr);
  const id = saveAccount({ name, title, email: em, hash: await hashPassword(password), isHomeAdmin: false, mustChange: true });
  addToAllPatients(id);
  db.audit('account_added', { userId: req.user.id, details: { account_id: id } });
  res.status(201).json(listPeople().find(u => u.id === id));
}));
adminRouter.post('/users/:id/unlock', (req, res) => {
  const u = db.prepare('SELECT id FROM users WHERE id = ? AND password_hash IS NOT NULL').get(req.params.id);
  if (!u) return res.status(404).json({ error: 'Not found' });
  db.prepare('UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = ?').run(u.id);
  db.audit('account_unlocked', { userId: req.user.id, details: { account_id: u.id } });
  res.json(listPeople().find(x => x.id === u.id));
});
adminRouter.post('/users/:id/temp-password', wrap(async (req, res) => {
  const u = getPerson(req.params.id);
  const pwErr = passwordProblem(req.body?.password); if (pwErr) throw fail(400, 'Temporary password: ' + pwErr);
  db.prepare('UPDATE users SET password_hash = ?, must_change_password = 1, failed_logins = 0, locked_until = NULL WHERE id = ?')
    .run(await hashPassword(req.body.password), u.id);
  revokeSessions(u.id, u.id === req.user.id ? req.session.id : null);
  db.audit('temporary_password_set', { userId: req.user.id, details: { account_id: u.id } });
  res.json(listPeople().find(x => x.id === u.id));
}));
adminRouter.post('/users/:id/deactivate', wrap(async (req, res) => {
  const u = getPerson(req.params.id);
  if (u.id === req.user.id) throw fail(400, "You can't turn off your own account.");
  db.prepare('UPDATE users SET active = 0 WHERE id = ?').run(u.id);
  revokeSessions(u.id);
  db.audit('account_deactivated', { userId: req.user.id, details: { account_id: u.id } });
  res.json(listPeople().find(x => x.id === u.id));
}));
adminRouter.post('/users/:id/reactivate', wrap(async (req, res) => {
  const u = getPerson(req.params.id);
  db.prepare('UPDATE users SET active = 1, failed_logins = 0, locked_until = NULL WHERE id = ?').run(u.id);
  addToAllPatients(u.id);
  db.audit('account_reactivated', { userId: req.user.id, details: { account_id: u.id } });
  res.json(listPeople().find(x => x.id === u.id));
}));

module.exports = {
  // middleware
  sameOrigin, loadSession, requireAuth, requireReady, requireHomeAdmin, requirePatientMember, requirePatientAdmin,
  // routers
  setupRouter, authRouter, adminRouter,
  // helpers
  prepareSetupCode, needsSetup, prefillParentFromAccount, hashPassword, verifyPassword, getSetupCode: () => setupCode,
  SESSION_DAYS, MAX_FAILS, LOCK_MINUTES, COOKIE, isHttps,
};
