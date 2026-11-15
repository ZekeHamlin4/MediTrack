// Tests for the database upgrade (M1). Run: cd server && npm test
// Uses temporary files only; never touches server/meditrack.db.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const { migrate, LATEST_VERSION, V0_SCHEMA, splitName, PATIENT_TABLES } = require('../migrations');

const quiet = () => {};
const tempDirs = [];
test.after(() => { for (const d of tempDirs) fs.rmSync(d, { recursive: true, force: true }); });
function tempDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'meditrack-test-'));
  tempDirs.push(dir);
  const file = path.join(dir, 'meditrack.db');
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  return { db, file, dir };
}

// A database as the pre-M1 code left it: old tables, demo users with plain PINs, real-looking records.
function makeV0(db) {
  db.exec(V0_SCHEMA);
  const u = db.prepare('INSERT INTO users (name,email,role,pin_hash) VALUES (?,?,?,?)');
  u.run('Admin User', 'admin@meditrack.local', 'admin', '0000');
  u.run('Day Nurse', 'daynurse@meditrack.local', 'nurse', '5678');
  db.prepare('INSERT INTO supplies (name,category,quantity,barcode,low_stock_threshold) VALUES (?,?,?,?,?)').run('Suction Catheter 8Fr', 'Trach & Airway', 60, 'SUC-CATH-8FR', 15);
  db.prepare('INSERT INTO supplies (name,category,quantity) VALUES (?,?,?)').run('Gauze', 'Wound Care', 3);
  db.prepare('INSERT INTO scan_log (supply_id,user_id,action,quantity,notes) VALUES (1,2,?,2,?)').run('remove', 'used');
  db.prepare("UPDATE patient_profile SET child_name='Sam Q Example', dob='2020-01-02', diagnoses='test', onboarded=1 WHERE id=1").run();
  db.prepare("INSERT INTO providers (name,type,phone,fax,email,departments,favorite) VALUES ('Test DME','dme','555-0100','555-0101','orders@dme.example','[{\"name\":\"Resupply\",\"ext\":\"2\"}]',1)").run();
  db.prepare("INSERT INTO tasks (title,provider_id,steps) VALUES ('Order backpack',1,'[{\"text\":\"Call\",\"done\":true}]')").run();
  db.prepare("INSERT INTO outbox (provider_id,task_id,to_email,subject,body,status) VALUES (1,1,'orders@dme.example','Order','Please send','sent')").run();
}

function snapshot(db) {
  const out = {};
  for (const t of ['users', 'supplies', 'scan_log', 'patient_profile', 'providers', 'tasks', 'outbox']) {
    out[t] = db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all();
  }
  return out;
}

test('fresh install: latest version, no demo data, one empty patient', () => {
  const { db, file, dir } = tempDb();
  const r = migrate(db, { dbFile: file, log: quiet });
  assert.equal(r.to, LATEST_VERSION);
  assert.equal(r.copy, null, 'no safety copy for an empty database');
  assert.equal(db.pragma('user_version', { simple: true }), LATEST_VERSION);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM users').get().c, 0);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM supplies').get().c, 0);
  const patients = db.prepare('SELECT * FROM patients').all();
  assert.equal(patients.length, 1);
  assert.equal(patients[0].onboarded, 0);
  assert.equal(db.prepare("SELECT value FROM settings WHERE key='signups_open'").get().value, '0');
  assert.deepEqual(fs.readdirSync(dir).filter(f => f.startsWith('meditrack-before')), []);
});

test('upgrade from the pre-M1 database keeps every record', () => {
  const { db, file, dir } = tempDb();
  makeV0(db);
  const before = snapshot(db);
  const r = migrate(db, { dbFile: file, log: quiet });
  assert.deepEqual([r.from, r.to], [0, LATEST_VERSION]);

  // Every old row and every old column is unchanged, except the cleared PINs.
  const after = snapshot(db);
  for (const t of Object.keys(before)) {
    assert.equal(after[t].length, before[t].length, t + ' row count');
    before[t].forEach((row, i) => {
      for (const [k, v] of Object.entries(row)) {
        if (t === 'users' && k === 'pin_hash') assert.equal(after[t][i][k], null);
        else assert.deepEqual(after[t][i][k], v, `${t}.${k} row ${row.id}`);
      }
    });
  }
  // Old accounts are deactivated (they never had passwords).
  assert.equal(db.prepare('SELECT COUNT(*) c FROM users WHERE active = 1').get().c, 0);
  // The patient comes from the old profile; the name splits without losing anything.
  const p = db.prepare('SELECT * FROM patients').get();
  assert.equal(p.first_name + ' ' + p.last_name, 'Sam Q Example');
  assert.equal(p.dob, '2020-01-02');
  assert.equal(p.onboarded, 1);
  // Every existing record belongs to that patient and has a version.
  for (const t of PATIENT_TABLES) {
    assert.equal(db.prepare(`SELECT COUNT(*) c FROM ${t} WHERE patient_id IS NOT ? OR version IS NOT 1`).get(p.id).c, 0, t);
  }
  assert.deepEqual(db.pragma('foreign_key_check'), []);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM audit_log WHERE action='database_upgraded'").get().c, 1);

  // A full copy of the old database was saved first, and it matches the old data.
  const copies = fs.readdirSync(dir).filter(f => f.startsWith('meditrack-before-v1'));
  assert.equal(copies.length, 1);
  const old = new Database(path.join(dir, copies[0]), { readonly: true });
  assert.equal(old.pragma('user_version', { simple: true }), 0);
  assert.deepEqual(snapshot(old), before);
});

test('running again does nothing (no new copy, no duplicate patient)', () => {
  const { db, file, dir } = tempDb();
  makeV0(db);
  migrate(db, { dbFile: file, log: quiet });
  const r = migrate(db, { dbFile: file, log: quiet });
  assert.deepEqual([r.from, r.to, r.copy], [LATEST_VERSION, LATEST_VERSION, null]);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM patients').get().c, 1);
  assert.equal(fs.readdirSync(dir).filter(f => f.startsWith('meditrack-before')).length, 1);
});

test('a failed upgrade changes nothing', () => {
  const { db, file } = tempDb();
  makeV0(db);
  db.exec('ALTER TABLE tasks ADD COLUMN patient_id INTEGER'); // makes step 4 fail half-way
  const before = snapshot(db);
  assert.throws(() => migrate(db, { dbFile: file, log: quiet }));
  assert.equal(db.pragma('user_version', { simple: true }), 0);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM sqlite_master WHERE name IN ('patients','organizations','sessions')").get().c, 0);
  assert.deepEqual(snapshot(db), before);
  assert.equal(db.pragma('foreign_keys', { simple: true }), 1, 'foreign key checks are back on');
});

test('refuses a database from a newer MediTrack', () => {
  const { db, file } = tempDb();
  db.pragma(`user_version = ${LATEST_VERSION + 1}`);
  assert.throws(() => migrate(db, { dbFile: file, log: quiet }), /newer MediTrack/);
});

test('name split keeps the whole name', () => {
  assert.deepEqual(splitName('Mary Ann Smith'), { first_name: 'Mary', last_name: 'Ann Smith' });
  assert.deepEqual(splitName('  Sam  '), { first_name: 'Sam', last_name: null });
  assert.deepEqual(splitName(''), { first_name: null, last_name: null });
  assert.deepEqual(splitName(null), { first_name: null, last_name: null });
});
