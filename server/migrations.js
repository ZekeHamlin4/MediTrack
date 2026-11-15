// Database upgrades (M1). The database remembers its version in `PRAGMA user_version`.
// Each numbered migration runs once, inside a transaction: either all of it is saved, or none of it.
// Before upgrading a database that already has data, a plain copy is saved next to it
// (meditrack-before-v<N>-<date>.db), so nothing can be lost.
//
// Rules for adding a migration later:
// - append to MIGRATIONS with the next number; never edit or reorder an old one
// - never delete user data; add columns/tables, copy data, keep old tables
const fs = require('fs');
const path = require('path');

// v0: the tables as they were before M1 (no version number yet).
// Only run on a database at version 0, so old installs that lack a table get it.
// No demo data is added (spec: fresh installs have no demo data).
const V0_SCHEMA = `
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT UNIQUE,
    role TEXT NOT NULL DEFAULT 'nurse' CHECK(role IN ('family','nurse','doctor','admin')),
    pin_hash TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS supplies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    description TEXT,
    quantity INTEGER NOT NULL DEFAULT 0,
    unit TEXT NOT NULL DEFAULT 'each',
    barcode TEXT UNIQUE,
    qr_code TEXT,
    low_stock_threshold INTEGER NOT NULL DEFAULT 5,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS scan_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    supply_id INTEGER REFERENCES supplies(id),
    user_id INTEGER REFERENCES users(id),
    action TEXT NOT NULL CHECK(action IN ('add','remove','check')),
    quantity INTEGER NOT NULL DEFAULT 1,
    notes TEXT,
    scanned_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS patient_profile (
    id INTEGER PRIMARY KEY CHECK(id = 1),
    child_name TEXT, dob TEXT, parent_name TEXT, parent_phone TEXT, parent_email TEXT,
    address TEXT, city TEXT, state TEXT, zip TEXT,
    insurance_name TEXT, insurance_member_id TEXT, medicaid_id TEXT,
    diagnoses TEXT, equipment TEXT, notes TEXT,
    onboarded INTEGER NOT NULL DEFAULT 0,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  INSERT OR IGNORE INTO patient_profile (id) VALUES (1);
  CREATE TABLE IF NOT EXISTS providers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'other',
    specialty TEXT, contact_person TEXT,
    phone TEXT, fax TEXT, email TEXT, website TEXT, portal_url TEXT,
    address TEXT, city TEXT, state TEXT, zip TEXT,
    npi TEXT, account_number TEXT,
    departments TEXT NOT NULL DEFAULT '[]',
    tips TEXT, notes TEXT,
    favorite INTEGER NOT NULL DEFAULT 0,
    source TEXT NOT NULL DEFAULT 'manual',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL, description TEXT,
    provider_id INTEGER REFERENCES providers(id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','in_progress','waiting','done')),
    due_date TEXT,
    steps TEXT NOT NULL DEFAULT '[]',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS outbox (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    provider_id INTEGER REFERENCES providers(id) ON DELETE SET NULL,
    task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
    to_email TEXT, subject TEXT NOT NULL, body TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','sent','failed')),
    error TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    sent_at DATETIME
  );
`;

// Patient fields copied from the old single-row `patient_profile` table.
const PROFILE_COPY_FIELDS = ['dob', 'parent_name', 'parent_phone', 'parent_email', 'address', 'city', 'state', 'zip',
  'insurance_name', 'insurance_member_id', 'medicaid_id', 'diagnoses', 'equipment', 'notes', 'onboarded'];

// Splits "Mary Ann Smith" into first "Mary", last "Ann Smith".
// first + ' ' + last gives back the original name, so nothing is lost.
// The person confirms the split at first-run setup (M2).
function splitName(full) {
  const s = (full || '').trim();
  if (!s) return { first_name: null, last_name: null };
  const i = s.search(/\s/);
  if (i === -1) return { first_name: s, last_name: null };
  return { first_name: s.slice(0, i), last_name: s.slice(i + 1).trim() || null };
}

// Existing tables that belong to a patient: they get patient_id and version.
const PATIENT_TABLES = ['supplies', 'scan_log', 'providers', 'tasks', 'outbox'];

const MIGRATIONS = [
  {
    version: 1,
    name: 'household, patients, accounts, sessions, audit log, settings',
    up(db) {
      db.exec(`
        CREATE TABLE organizations (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE patients (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          org_id INTEGER NOT NULL REFERENCES organizations(id),
          first_name TEXT, last_name TEXT, dob TEXT,
          parent_name TEXT, parent_phone TEXT, parent_email TEXT,
          address TEXT, city TEXT, state TEXT, zip TEXT,
          insurance_name TEXT, insurance_member_id TEXT, medicaid_id TEXT,
          diagnoses TEXT, equipment TEXT, notes TEXT,
          onboarded INTEGER NOT NULL DEFAULT 0,
          archived_at DATETIME,
          version INTEGER NOT NULL DEFAULT 1,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE patient_members (
          patient_id INTEGER NOT NULL REFERENCES patients(id),
          user_id INTEGER NOT NULL REFERENCES users(id),
          is_patient_admin INTEGER NOT NULL DEFAULT 0,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (patient_id, user_id)
        );
        CREATE UNIQUE INDEX one_admin_per_patient ON patient_members(patient_id) WHERE is_patient_admin = 1;
        CREATE TABLE sessions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL REFERENCES users(id),
          token_hash TEXT NOT NULL UNIQUE,
          device_name TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          last_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          expires_at DATETIME NOT NULL,
          revoked_at DATETIME
        );
        CREATE INDEX sessions_user ON sessions(user_id);
        CREATE TABLE audit_log (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          at DATETIME DEFAULT CURRENT_TIMESTAMP,
          user_id INTEGER REFERENCES users(id),
          patient_id INTEGER REFERENCES patients(id),
          action TEXT NOT NULL,
          details TEXT
        );
        CREATE INDEX audit_log_at ON audit_log(at);
        CREATE TABLE settings (
          key TEXT PRIMARY KEY,
          value TEXT
        );
      `);

      // 1. One household row.
      const orgId = db.prepare("INSERT INTO organizations (name) VALUES ('Home')").run().lastInsertRowid;

      // 2. Accounts: new columns. Old users (no passwords, plain-text PINs) are deactivated and PINs cleared.
      db.exec(`
        ALTER TABLE users ADD COLUMN org_id INTEGER REFERENCES organizations(id);
        ALTER TABLE users ADD COLUMN title TEXT;
        ALTER TABLE users ADD COLUMN password_hash TEXT;
        ALTER TABLE users ADD COLUMN is_home_admin INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE users ADD COLUMN active INTEGER NOT NULL DEFAULT 1;
        ALTER TABLE users ADD COLUMN failed_logins INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE users ADD COLUMN locked_until DATETIME;
        ALTER TABLE users ADD COLUMN last_login_at DATETIME;
      `);
      const oldUsers = db.prepare('UPDATE users SET org_id = ?, active = 0, pin_hash = NULL').run(orgId).changes;

      // 3. The patient, copied from the old profile. The old table is kept as it was.
      const p = db.prepare('SELECT * FROM patient_profile WHERE id = 1').get() || {};
      const { first_name, last_name } = splitName(p.child_name);
      const cols = ['org_id', 'first_name', 'last_name', ...PROFILE_COPY_FIELDS];
      const vals = [orgId, first_name, last_name, ...PROFILE_COPY_FIELDS.map(f => f === 'onboarded' ? (p.onboarded ? 1 : 0) : (p[f] ?? null))];
      const patientId = db.prepare(`INSERT INTO patients (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`)
        .run(...vals).lastInsertRowid;

      // 4. Existing records belong to that patient; add a version number for later edit checks.
      for (const t of PATIENT_TABLES) {
        db.exec(`ALTER TABLE ${t} ADD COLUMN patient_id INTEGER REFERENCES patients(id)`);
        db.exec(`ALTER TABLE ${t} ADD COLUMN version INTEGER NOT NULL DEFAULT 1`);
        db.prepare(`UPDATE ${t} SET patient_id = ?`).run(patientId);
        db.exec(`CREATE INDEX ${t}_patient ON ${t}(patient_id)`);
      }

      // 5. Settings defaults (Phase 1a: open sign-up stays off; the home admin adds people).
      db.prepare("INSERT INTO settings (key, value) VALUES ('signups_open', '0')").run();

      // 6. Audit (counts only, no health data).
      db.prepare("INSERT INTO audit_log (action, details) VALUES ('database_upgraded', ?)")
        .run(JSON.stringify({ from: 0, to: 1, old_accounts_deactivated: oldUsers }));
    },
  },
  {
    version: 2,
    name: 'sign-in: temporary passwords',
    up(db) {
      // Set when the home admin gives someone a temporary password; they choose their own at next sign-in.
      db.exec('ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0');
    },
  },
];

const LATEST_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;

function hasData(db) {
  return db.prepare("SELECT COUNT(*) AS c FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").get().c > 0;
}

// Saves a full copy of the database before an upgrade. Returns the copy's path.
function saveCopyBeforeUpgrade(db, dbFile, toVersion) {
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const copy = path.join(path.dirname(dbFile), `meditrack-before-v${toVersion}-${stamp}.db`);
  db.exec(`VACUUM INTO '${copy.replace(/'/g, "''")}'`);
  return copy;
}

// Brings the database up to date. `dbFile` is used for the safety copy (omit for in-memory tests).
function migrate(db, { dbFile, log = console.log } = {}) {
  let current = db.pragma('user_version', { simple: true });
  if (current > LATEST_VERSION) {
    throw new Error(`This database is from a newer MediTrack (version ${current}). Update MediTrack before opening it.`);
  }
  if (current === LATEST_VERSION) return { from: current, to: current, copy: null };

  const from = current;
  let copy = null;
  if (dbFile && hasData(db)) {
    copy = saveCopyBeforeUpgrade(db, dbFile, LATEST_VERSION);
    log(`Upgrading the MediTrack database. A copy of the old one was saved first: ${path.basename(copy)}`);
  }

  // ALTER TABLE and foreign keys: switch checks off during the upgrade, check everything after.
  db.pragma('foreign_keys = OFF');
  try {
    for (const m of MIGRATIONS) {
      if (m.version <= current) continue;
      const startedAt = current;
      db.transaction(() => {
        if (startedAt === 0) db.exec(V0_SCHEMA);
        // Old data may already hold a few broken links; only fail if this upgrade adds new ones.
        const before = db.pragma('foreign_key_check').length;
        m.up(db);
        const after = db.pragma('foreign_key_check').length;
        if (after > before) throw new Error(`Upgrade to version ${m.version} would break ${after - before} links; nothing was changed.`);
        db.pragma(`user_version = ${m.version}`);
      })();
      current = m.version;
      log(`Database upgraded to version ${m.version} (${m.name}).`);
    }
  } finally {
    db.pragma('foreign_keys = ON');
  }
  return { from, to: current, copy };
}

module.exports = { migrate, MIGRATIONS, LATEST_VERSION, V0_SCHEMA, splitName, PATIENT_TABLES };
