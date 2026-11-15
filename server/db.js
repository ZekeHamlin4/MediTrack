// Opens the MediTrack database and brings it up to date (see migrations.js).
// Fresh installs start empty: no demo users or supplies.
const Database = require('better-sqlite3');
const path = require('path');
const { migrate } = require('./migrations');

const dbFile = process.env.MEDITRACK_DB_PATH || path.join(__dirname, 'meditrack.db');
const db = new Database(dbFile);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

try {
  migrate(db, { dbFile });
} catch (e) {
  console.error('');
  console.error('  MediTrack could not upgrade its database, so it did not start.');
  console.error('  Your data was not changed. Please share this message with whoever helps you with MediTrack:');
  console.error('  ' + e.message);
  console.error('');
  throw e;
}

// Phase 1a has one patient per install (no patient switcher yet). Returns its id.
db.currentPatientId = function currentPatientId() {
  const row = db.prepare('SELECT id FROM patients WHERE archived_at IS NULL ORDER BY id LIMIT 1').get();
  if (row) return row.id;
  // Safety net: there should always be one; create an empty one if it was removed.
  const org = db.prepare('SELECT id FROM organizations ORDER BY id LIMIT 1').get();
  return db.prepare('INSERT INTO patients (org_id) VALUES (?)').run(org.id).lastInsertRowid;
};

// Writes one audit-log line. `details` must never contain health information.
db.audit = function audit(action, { userId = null, patientId = null, details = null } = {}) {
  db.prepare('INSERT INTO audit_log (user_id, patient_id, action, details) VALUES (?,?,?,?)')
    .run(userId, patientId, action, details == null ? null : JSON.stringify(details));
};

db.getSetting = function getSetting(key, fallback = null) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
};

db.setSetting = function setSetting(key, value) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, value == null ? null : String(value));
};

module.exports = db;
