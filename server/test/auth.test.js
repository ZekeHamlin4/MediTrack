// Tests for sign-in and permission checks (M2 + M3). Run: cd server && npm test
// Uses a temporary database file; never touches server/meditrack.db.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'meditrack-auth-test-'));
process.env.MEDITRACK_DB_PATH = path.join(tmpDir, 'meditrack.db');
const db = require('../db');
const auth = require('../auth');
const app = require('../app');
const care = require('../care');
const email = require('../email');
const supplies = require('../supplies');

let server, base, origin;
test.before(async () => {
  await new Promise(r => { server = app.listen(0, '127.0.0.1', r); });
  base = origin = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => { server.close(); db.close(); fs.rmSync(tmpDir, { recursive: true, force: true }); });

// Small request helper. Sends a same-origin Origin header unless told otherwise.
async function req(method, url, { body, cookie, headers = {}, noOrigin = false } = {}) {
  const h = { ...headers };
  if (!noOrigin && !('origin' in h) && !('referer' in h)) h.origin = origin;
  if (body !== undefined) h['content-type'] = 'application/json';
  if (cookie) h.cookie = cookie;
  const r = await fetch(base + url, { method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  const set = r.headers.get('set-cookie') || '';
  const m = /mt_session=([^;]*)/.exec(set);
  return { status: r.status, body: json, setCookie: set, cookie: m && m[1] ? `mt_session=${m[1]}` : null };
}
const login = (email, password) => req('POST', '/api/auth/login', { body: { email, password } });

const ADMIN = { name: 'Test Admin', title: 'Dad', email: 'admin@example.test', password: 'admin password 123', over18: true };
const NURSE = { name: 'Test Nurse', title: 'Nurse', email: 'nurse@example.test', password: 'temporary pw 123' };
let adminCookie;

// Every route in every router, with the prefix it is mounted on.
function allRoutes() {
  const groups = [
    ['/api', auth.setupRouter], ['/api', auth.authRouter], ['/api/admin', auth.adminRouter], ['/api/admin', require('../network').adminRouter],
    ['/api', require('../network').healthRouter],
    ['/api', care.router], ['/api', email.router],
    ['/api/patients/1', care.patientRouter], ['/api/patients/1', email.patientRouter], ['/api/patients/1', supplies.patientRouter],
  ];
  const out = [];
  for (const [prefix, router] of groups) {
    for (const layer of router.stack) {
      if (!layer.route) continue;
      for (const method of Object.keys(layer.route.methods)) {
        out.push({ method: method.toUpperCase(), url: prefix + layer.route.path.replace(/:\w+/g, '1') });
      }
    }
  }
  return out;
}
const PUBLIC = ['GET /api/health', 'GET /api/setup/status', 'POST /api/setup', 'POST /api/auth/login', 'POST /api/auth/logout'];

test('first-run setup: needs the setup code, then creates the home admin', async () => {
  assert.equal((await req('GET', '/api/setup/status')).body.needs_setup, true);
  const first = auth.prepareSetupCode(() => {});
  assert.match(first, /^\d{4}-\d{4}$/);
  const wrongCode = c => (c === '0000-0000' ? '1111-1111' : '0000-0000');
  let r;
  for (let i = 0; i < 4; i++) {
    r = await req('POST', '/api/setup', { body: { ...ADMIN, code: wrongCode(first) } });
    assert.equal(r.status, 403);
    assert.equal(auth.getSetupCode(), first);
  }
  r = await req('POST', '/api/setup', { body: { ...ADMIN, code: wrongCode(first) } });
  assert.equal(r.status, 403);
  assert.match(r.body.error, /new setup code/);
  const code = auth.getSetupCode();
  assert.notEqual(code, first, 'five wrong codes make a new code');
  r = await req('POST', '/api/setup', { body: { ...ADMIN, code: first } });
  assert.equal(r.status, 403, 'the old code no longer works');
  r = await req('POST', '/api/setup', { body: { ...ADMIN, code, password: 'short' } });
  assert.equal(r.status, 400, 'password under 10 characters');
  r = await req('POST', '/api/setup', { body: { ...ADMIN, code, over18: false } });
  assert.equal(r.status, 400, '18+ required');

  r = await req('POST', '/api/setup', { body: { ...ADMIN, code: code.replace('-', '') } });
  assert.equal(r.status, 201);
  assert.ok(r.cookie, 'signed in right away');
  assert.equal(r.body.user.is_home_admin, true);
  assert.equal(r.body.patients.length, 1);
  assert.equal(r.body.patients[0].is_patient_admin, true, 'home admin becomes the patient admin');
  adminCookie = r.cookie;

  // Nothing typed twice: the child's profile already has "Your name" and "Your email" from the account.
  const prof = (await req('GET', '/api/patients/1/profile', { cookie: adminCookie })).body;
  assert.equal(prof.parent_name, ADMIN.name);
  assert.equal(prof.parent_email, ADMIN.email);

  r = await req('POST', '/api/setup', { body: { ...ADMIN, code, email: 'other@example.test' } });
  assert.equal(r.status, 409, 'setup only works once');
  assert.equal((await req('GET', '/api/setup/status')).body.needs_setup, false);
  const stored = db.prepare('SELECT password_hash FROM users WHERE email = ?').get(ADMIN.email).password_hash;
  assert.match(stored, /^scrypt\$/);
  assert.ok(!stored.includes(ADMIN.password));
});

test('prefill never overwrites details already in the profile (upgraded installs)', () => {
  const adminId = db.prepare('SELECT id FROM users WHERE email = ?').get(ADMIN.email).id;
  db.prepare("UPDATE patients SET parent_name = 'Old Name', parent_email = '' WHERE id = 1").run();
  auth.prefillParentFromAccount(adminId);
  const p = db.prepare('SELECT parent_name, parent_email FROM patients WHERE id = 1').get();
  assert.deepEqual(p, { parent_name: 'Old Name', parent_email: ADMIN.email });
  db.prepare('UPDATE patients SET parent_name = ? WHERE id = 1').run(ADMIN.name);
});

test('every API route needs sign-in, except setup and sign-in', async () => {
  const routes = allRoutes();
  assert.ok(routes.length > 30, 'found the routes');
  for (const { method, url } of routes) {
    const key = `${method} ${url}`;
    if (PUBLIC.includes(key)) continue;
    const r = await req(method, url, { body: method === 'GET' ? undefined : {} });
    assert.equal(r.status, 401, key + ' should need sign-in');
  }
  // Old routes from before M2 are gone.
  assert.equal((await req('GET', '/api/users', { cookie: adminCookie })).status, 404);
  assert.equal((await req('GET', '/api/assistant/status', { cookie: adminCookie })).status, 404, 'assistant hidden in Phase 1a');
});

test('same-origin check blocks changes from other websites', async () => {
  let r = await req('POST', '/api/auth/login', { body: { email: ADMIN.email, password: ADMIN.password }, noOrigin: true });
  assert.equal(r.status, 403, 'no Origin or Referer');
  r = await req('POST', '/api/auth/login', { body: { email: ADMIN.email, password: ADMIN.password }, headers: { origin: 'https://evil.example' } });
  assert.equal(r.status, 403, 'other website');
  r = await req('POST', '/api/patients/1/supplies', { cookie: adminCookie, body: { name: 'x', category: 'y' }, headers: { origin: 'https://evil.example' } });
  assert.equal(r.status, 403, 'signed-in cookie does not help a cross-site request');
  r = await req('POST', '/api/auth/login', { body: { email: ADMIN.email, password: ADMIN.password }, headers: { referer: origin + '/somewhere' } });
  assert.equal(r.status, 200, 'same-site Referer is fine');
  r = await req('GET', '/api/auth/me', { cookie: adminCookie, noOrigin: true });
  assert.equal(r.status, 200, 'reading needs no Origin');
  r = await req('POST', '/api/auth/login', { body: { email: ADMIN.email, password: ADMIN.password }, headers: { origin: 'https://mt-home.example.ts.net', 'x-forwarded-host': 'mt-home.example.ts.net' } });
  assert.equal(r.status, 200, 'the Tailscale address forwarded by tailscale serve is allowed');
});

test('session cookie is HttpOnly and SameSite=Lax; Secure over HTTPS', async () => {
  let r = await login(ADMIN.email, ADMIN.password);
  assert.match(r.setCookie, /HttpOnly/);
  assert.match(r.setCookie, /SameSite=Lax/);
  assert.doesNotMatch(r.setCookie, /Secure/, 'plain http://localhost cannot keep Secure cookies everywhere');
  r = await req('POST', '/api/auth/login', { body: { email: ADMIN.email, password: ADMIN.password }, headers: { 'x-forwarded-proto': 'https' } });
  assert.match(r.setCookie, /Secure/);
  // Only a hash of the token is stored.
  const token = decodeURIComponent(r.cookie.split('=')[1]);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM sessions WHERE token_hash = ?').get(token).c, 0);
});

let nurseId;
test('home admin adds a person with a temporary password; they must choose their own', async () => {
  let r = await req('POST', '/api/admin/users', { cookie: adminCookie, body: NURSE });
  assert.equal(r.status, 201);
  nurseId = r.body.id;
  assert.equal(r.body.must_change_password, true);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM patient_members WHERE user_id = ?').get(nurseId).c, 1, 'member of the patient');
  r = await req('POST', '/api/admin/users', { cookie: adminCookie, body: { ...NURSE, email: 'NURSE@example.test' } });
  assert.equal(r.status, 409, 'same email (any case)');

  r = await login(NURSE.email, NURSE.password);
  assert.equal(r.status, 200);
  assert.equal(r.body.user.must_change_password, true);
  const tempCookie = r.cookie;
  r = await req('GET', '/api/patients/1/supplies', { cookie: tempCookie });
  assert.equal(r.status, 403);
  assert.equal(r.body.must_change_password, true);
  r = await req('POST', '/api/auth/password', { cookie: tempCookie, body: { current: 'wrong one 12345', password: 'nurse own password' } });
  assert.equal(r.status, 400);
  r = await req('POST', '/api/auth/password', { cookie: tempCookie, body: { current: NURSE.password, password: 'nurse own password' } });
  assert.equal(r.status, 200);
  r = await req('GET', '/api/patients/1/supplies', { cookie: tempCookie });
  assert.equal(r.status, 200);
});

test('members can use patient data; only the home admin can manage people', async () => {
  const nurse = (await login(NURSE.email, 'nurse own password')).cookie;
  assert.equal((await req('GET', '/api/admin/users', { cookie: nurse })).status, 403);
  assert.equal((await req('POST', '/api/admin/users', { cookie: nurse, body: { ...NURSE, email: 'x@example.test' } })).status, 403);
  assert.equal((await req('GET', '/api/admin/users', { cookie: adminCookie })).status, 200);

  // "Logged by" is always the signed-in person, whatever the page sends.
  const s = await req('POST', '/api/patients/1/supplies', { cookie: nurse, body: { name: 'Gauze', category: 'Wound Care', quantity: 5 } });
  assert.equal(s.status, 201);
  const scan = await req('POST', '/api/patients/1/supplies/scan', { cookie: nurse, body: { supply_id: s.body.id, action: 'remove', quantity: 1, user_id: 1 } });
  assert.equal(scan.status, 200);
  assert.equal(db.prepare('SELECT user_id FROM scan_log ORDER BY id DESC LIMIT 1').get().user_id, nurseId);
});

test("another patient's data answers 404, even by id", async () => {
  const nurse = (await login(NURSE.email, 'nurse own password')).cookie;
  const org = db.prepare('SELECT id FROM organizations LIMIT 1').get().id;
  const p2 = db.prepare("INSERT INTO patients (org_id, first_name, onboarded) VALUES (?, 'Other', 1)").run(org).lastInsertRowid;
  const sup = db.prepare("INSERT INTO supplies (name, category, patient_id) VALUES ('Secret', 'X', ?)").run(p2).lastInsertRowid;
  const prov = db.prepare("INSERT INTO providers (name, patient_id) VALUES ('Other DME', ?)").run(p2).lastInsertRowid;

  assert.equal((await req('GET', `/api/patients/${p2}/supplies`, { cookie: nurse })).status, 404);
  assert.equal((await req('GET', `/api/patients/${p2}/profile`, { cookie: nurse })).status, 404);
  assert.equal((await req('GET', `/api/patients/1/supplies/${sup}`, { cookie: nurse })).status, 404);
  assert.equal((await req('PUT', `/api/patients/1/supplies/${sup}`, { cookie: nurse, body: { quantity: 0 } })).status, 404);
  assert.equal((await req('DELETE', `/api/patients/1/providers/${prov}`, { cookie: nurse })).status, 404);
  assert.equal((await req('POST', '/api/patients/1/tasks', { cookie: nurse, body: { title: 't', provider_id: prov } })).status, 400, 'cannot link to the other patient');
  const list = (await req('GET', '/api/patients/1/supplies', { cookie: nurse })).body;
  assert.ok(!list.some(x => x.name === 'Secret'));
  assert.equal((await req('GET', '/api/patients/abc/supplies', { cookie: nurse })).status, 404);
  db.prepare('DELETE FROM supplies WHERE id = ?').run(sup);
  db.prepare('DELETE FROM providers WHERE id = ?').run(prov);
  db.prepare('DELETE FROM patients WHERE id = ?').run(p2);
});

test('lockout: 5 wrong passwords lock the account for 15 minutes; home admin can unlock', async () => {
  for (let i = 0; i < 4; i++) assert.equal((await login(NURSE.email, 'wrong password ' + i)).status, 401);
  assert.equal(db.prepare('SELECT failed_logins FROM users WHERE id = ?').get(nurseId).failed_logins, 4);
  assert.equal((await login(NURSE.email, 'wrong password 5')).status, 401);
  const lockedUntil = db.prepare('SELECT locked_until FROM users WHERE id = ?').get(nurseId).locked_until;
  const minutes = (Date.parse(lockedUntil) - Date.now()) / 60000;
  assert.ok(minutes > 14 && minutes <= 15, 'locked for 15 minutes');

  let r = await login(NURSE.email, 'nurse own password');
  assert.equal(r.status, 429, 'even the right password is refused while locked');
  assert.equal((await req('GET', '/api/admin/users', { cookie: adminCookie })).body.find(u => u.id === nurseId).locked, true);

  // After 15 minutes it works again (simulate the time passing).
  db.prepare('UPDATE users SET locked_until = ? WHERE id = ?').run(new Date(Date.now() - 1000).toISOString(), nurseId);
  assert.equal((await login(NURSE.email, 'nurse own password')).status, 200);

  // Lock again, then the home admin unlocks.
  for (let i = 0; i < 5; i++) await login(NURSE.email, 'wrong again ' + i);
  assert.equal((await login(NURSE.email, 'nurse own password')).status, 429);
  assert.equal((await req('POST', `/api/admin/users/${nurseId}/unlock`, { cookie: adminCookie, body: {} })).status, 200);
  assert.equal((await login(NURSE.email, 'nurse own password')).status, 200);

  // Unknown email and wrong password give the same answer.
  const a = await login('nobody@example.test', 'whatever 12345');
  const b = await login(NURSE.email, 'whatever 12345');
  assert.deepEqual([a.status, a.body], [b.status, b.body]);
  await login(NURSE.email, 'nurse own password'); // reset the counter
});

test('sessions end: expiry, sign-out, sign-out of another device, and turning an account off', async () => {
  let c = (await login(NURSE.email, 'nurse own password')).cookie;
  assert.equal((await req('GET', '/api/auth/me', { cookie: c })).status, 200);
  // Expired
  db.prepare("UPDATE sessions SET expires_at = '2000-01-01T00:00:00.000Z' WHERE id = (SELECT MAX(id) FROM sessions)").run();
  assert.equal((await req('GET', '/api/auth/me', { cookie: c })).status, 401);
  // A session left unused for 30 days expires; using it moves the end date forward
  c = (await login(NURSE.email, 'nurse own password')).cookie;
  const sid = db.prepare('SELECT MAX(id) id FROM sessions').get().id;
  const days = (Date.parse(db.prepare('SELECT expires_at FROM sessions WHERE id = ?').get(sid).expires_at) - Date.now()) / 864e5;
  assert.ok(days > 29.9 && days <= 30, '30 days');
  db.prepare("UPDATE sessions SET last_seen_at = '2000-01-01T00:00:00.000Z', expires_at = ? WHERE id = ?").run(new Date(Date.now() + 864e5).toISOString(), sid);
  await req('GET', '/api/auth/me', { cookie: c });
  const after = (Date.parse(db.prepare('SELECT expires_at FROM sessions WHERE id = ?').get(sid).expires_at) - Date.now()) / 864e5;
  assert.ok(after > 29.9, 'refreshed on use');
  // Sign out
  assert.equal((await req('POST', '/api/auth/logout', { cookie: c, body: {} })).status, 200);
  assert.equal((await req('GET', '/api/auth/me', { cookie: c })).status, 401);
  // Device list: sign out another device
  const phone = (await login(NURSE.email, 'nurse own password')).cookie;
  const laptop = (await login(NURSE.email, 'nurse own password')).cookie;
  const list = (await req('GET', '/api/auth/sessions', { cookie: laptop })).body;
  const other = list.find(d => !d.current);
  assert.ok(other && list.some(d => d.current));
  assert.equal((await req('DELETE', `/api/auth/sessions/${other.id}`, { cookie: laptop })).status, 200);
  assert.equal((await req('GET', '/api/auth/me', { cookie: phone })).status, 401);
  assert.equal((await req('DELETE', '/api/auth/sessions/999999', { cookie: laptop })).status, 404);
  // Turned off by the home admin: signed out everywhere and can't sign in
  assert.equal((await req('POST', `/api/admin/users/${nurseId}/deactivate`, { cookie: adminCookie, body: {} })).status, 200);
  assert.equal((await req('GET', '/api/auth/me', { cookie: laptop })).status, 401);
  assert.equal((await login(NURSE.email, 'nurse own password')).status, 401);
  // The home admin can't turn themselves off
  const adminId = db.prepare('SELECT id FROM users WHERE email = ?').get(ADMIN.email).id;
  assert.equal((await req('POST', `/api/admin/users/${adminId}/deactivate`, { cookie: adminCookie, body: {} })).status, 400);
  // Turn back on + temporary password
  assert.equal((await req('POST', `/api/admin/users/${nurseId}/reactivate`, { cookie: adminCookie, body: {} })).status, 200);
  assert.equal((await req('POST', `/api/admin/users/${nurseId}/temp-password`, { cookie: adminCookie, body: { password: 'another temp 123' } })).status, 200);
  const r = await login(NURSE.email, 'another temp 123');
  assert.equal(r.status, 200);
  assert.equal(r.body.user.must_change_password, true);
});

test('audit log records sign-in events without passwords', async () => {
  const actions = db.prepare('SELECT DISTINCT action FROM audit_log').all().map(a => a.action);
  for (const a of ['home_admin_created', 'sign_in', 'sign_in_failed', 'account_locked', 'account_unlocked', 'sign_out', 'account_added', 'password_changed', 'account_deactivated', 'temporary_password_set']) {
    assert.ok(actions.includes(a), 'audit has ' + a);
  }
  const all = JSON.stringify(db.prepare('SELECT * FROM audit_log').all());
  for (const secret of [ADMIN.password, NURSE.password, 'nurse own password', 'another temp 123']) assert.ok(!all.includes(secret));
});
