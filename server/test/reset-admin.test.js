// Tests for the Mac "reset admin password" tool (server/reset-admin.js). Run: cd server && npm test
// Uses temporary database files only.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const Database = require('better-sqlite3');
const { migrate, LATEST_VERSION } = require('../migrations');
const { hashPassword, verifyPassword } = require('../passwords');

const SERVER_DIR = path.join(__dirname, '..');
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'meditrack-reset-test-'));
test.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));
let n = 0;

// A database with home admins (and a nurse), as MediTrack would have after setup.
async function makeDb(admins = [['Test Admin', 'admin@example.test']]) {
  const file = path.join(tmpDir, `t${++n}.db`);
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  migrate(db, { log: () => {} });
  const org = db.prepare('SELECT id FROM organizations').get().id;
  const add = db.prepare("INSERT INTO users (name, email, password_hash, is_home_admin, org_id, role, active) VALUES (?,?,?,?,?, 'family', 1)");
  const ids = [];
  for (const [name, email] of admins) ids.push(add.run(name, email, await hashPassword('old password 123'), 1, org).lastInsertRowid);
  const nurse = add.run('Nurse', 'nurse@example.test', await hashPassword('nurse password 1'), 0, org).lastInsertRowid;
  db.close();
  return { file, ids, nurse };
}

// Runs the tool like the .command file does, typing the given lines.
function runTool(file, lines) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, ['reset-admin.js'], { cwd: SERVER_DIR, env: { ...process.env, MEDITRACK_DB_PATH: file } });
    let out = '';
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { out += d; });
    child.on('close', code => resolve({ code, out }));
    child.stdin.end(lines.join('\n') + '\n');
  });
}
const userRow = (file, id) => { const db = new Database(file, { readonly: true }); const u = db.prepare('SELECT * FROM users WHERE id = ?').get(id); db.close(); return u; };

test('one home admin: confirm, type twice, done', async () => {
  const { file, ids, nurse } = await makeDb();
  const before = userRow(file, nurse);
  const r = await runTool(file, ['y', 'brand new pw 99', 'brand new pw 99']);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /Reset the password for Test Admin, admin@example.test\?/);
  assert.match(r.out, /Done\. The password for admin@example.test is changed/);
  assert.ok(!r.out.includes('brand new pw 99'), 'password never printed');
  const u = userRow(file, ids[0]);
  assert.ok(await verifyPassword('brand new pw 99', u.password_hash));
  assert.match(u.password_hash, /^scrypt\$/);
  assert.deepEqual(userRow(file, nurse), before, 'other accounts untouched');
});

test('several home admins: pick by number; only that one changes', async () => {
  const { file, ids } = await makeDb([['Admin One', 'one@example.test'], ['Admin Two', 'two@example.test']]);
  const first = userRow(file, ids[0]).password_hash;
  const r = await runTool(file, ['2', 'y', 'second admin pw', 'second admin pw']);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /1\. Admin One, one@example.test/);
  assert.match(r.out, /2\. Admin Two, two@example.test/);
  assert.ok(await verifyPassword('second admin pw', userRow(file, ids[1]).password_hash));
  assert.equal(userRow(file, ids[0]).password_hash, first);
  assert.equal((await runTool(file, ['7'])).code, 1, 'number not on the list');
});

test('nothing changes on: no, mismatch, too short, wrong version, no admin, no database', async () => {
  const { file, ids } = await makeDb();
  const hash = userRow(file, ids[0]).password_hash;
  let r = await runTool(file, ['n']);
  assert.equal(r.code, 1); assert.match(r.out, /Nothing was changed/);
  r = await runTool(file, ['y', 'first try 12345', 'other try 12345']);
  assert.equal(r.code, 1); assert.match(r.out, /not the same/);
  r = await runTool(file, ['y', 'short', 'short']);
  assert.equal(r.code, 1); assert.match(r.out, /at least 10 characters/);
  assert.equal(userRow(file, ids[0]).password_hash, hash);

  // Older database version: the tool never upgrades the database itself.
  let db = new Database(file); db.pragma(`user_version = ${LATEST_VERSION - 1}`); db.close();
  r = await runTool(file, ['y', 'brand new pw 99', 'brand new pw 99']);
  assert.equal(r.code, 1); assert.match(r.out, /needs to update its data first/);
  db = new Database(file, { readonly: true }); assert.equal(db.pragma('user_version', { simple: true }), LATEST_VERSION - 1); db.close();
  assert.equal(userRow(file, ids[0]).password_hash, hash);

  const empty = await makeDb([]);
  r = await runTool(empty.file, ['y']);
  assert.equal(r.code, 1); assert.match(r.out, /no home admin account yet/);

  r = await runTool(path.join(tmpDir, 'missing.db'), ['y']);
  assert.equal(r.code, 1); assert.match(r.out, /No MediTrack data found/);
  assert.ok(!fs.existsSync(path.join(tmpDir, 'missing.db')), 'does not create a database');
});

test('while MediTrack is running: unlocks, signs that account out, keeps everyone and everything else', async () => {
  // Start the real app on its own database, as the background service would be.
  const file = path.join(tmpDir, 'live.db');
  process.env.MEDITRACK_DB_PATH = file;
  const db = require('../db');
  const auth = require('../auth');
  const app = require('../app');
  const server = await new Promise(r => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, url, body, cookie) => {
    const res = await fetch(base + url, { method, headers: { origin: base, 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const m = /mt_session=([^;]+)/.exec(res.headers.get('set-cookie') || '');
    return { status: res.status, cookie: m ? 'mt_session=' + m[1] : null };
  };
  try {
    const code = auth.prepareSetupCode(() => {});
    const admin = (await call('POST', '/api/setup', { code, name: 'Test Admin', email: 'admin@example.test', password: 'old password 123', over18: true })).cookie;
    assert.ok(admin);
    assert.equal((await call('POST', '/api/admin/users', { name: 'Nurse', email: 'nurse@example.test', password: 'nurse temp 1234' }, admin)).status, 201);
    const nurse = (await call('POST', '/api/auth/login', { email: 'nurse@example.test', password: 'nurse temp 1234' })).cookie;
    await call('POST', '/api/patients/1/providers', { name: 'Test DME', phone: '555-0100' }, admin);
    await call('PUT', '/api/patients/1/profile', { child_name: 'Kid Example', dob: '2020-01-01' }, admin);
    for (let i = 0; i < 5; i++) await call('POST', '/api/auth/login', { email: 'admin@example.test', password: 'forgotten ' + i });
    assert.equal((await call('POST', '/api/auth/login', { email: 'admin@example.test', password: 'old password 123' })).status, 429, 'admin is locked out');

    // Everything except the admin's own row, sessions and the audit log, before the reset.
    const snapshot = () => {
      const out = {};
      for (const { name } of db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all()) {
        if (['sessions', 'audit_log'].includes(name)) continue;
        out[name] = db.prepare(`SELECT * FROM ${name} ORDER BY rowid`).all();
      }
      out.users = out.users.filter(u => u.email !== 'admin@example.test');
      out.otherSessions = db.prepare("SELECT * FROM sessions WHERE user_id != (SELECT id FROM users WHERE email='admin@example.test') ORDER BY id").all();
      return out;
    };
    const before = snapshot();

    const r = await runTool(file, ['y', 'remembered pw 42', 'remembered pw 42']);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /signed out on 1 device\b/);

    assert.equal((await call('GET', '/api/auth/me', null, admin)).status, 401, 'old admin session ended');
    assert.equal((await call('GET', '/api/auth/me', null, nurse)).status, 200, 'nurse still signed in');
    assert.equal((await call('POST', '/api/auth/login', { email: 'admin@example.test', password: 'old password 123' })).status, 401);
    const fresh = await call('POST', '/api/auth/login', { email: 'admin@example.test', password: 'remembered pw 42' });
    assert.equal(fresh.status, 200, 'new password works and the lockout is cleared');
    assert.equal((await call('GET', '/api/patients/1/providers', null, fresh.cookie)).status, 200);

    const after = snapshot();
    after.otherSessions = after.otherSessions.filter(s => before.otherSessions.some(b => b.id === s.id));
    assert.deepEqual(after, before, 'no other data changed');
    const line = db.prepare("SELECT * FROM audit_log WHERE action = 'admin_password_reset_on_mac'").get();
    assert.ok(line);
    assert.ok(!JSON.stringify(db.prepare('SELECT * FROM audit_log').all()).includes('remembered pw 42'));
  } finally {
    server.close();
    db.close();
  }
});
