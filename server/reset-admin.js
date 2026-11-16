// Reset the home admin's password, on the Mac itself (run by "Reset Admin Password.command").
// For when the home admin forgot their password and nobody else can help.
//
// What it changes, and nothing else:
//   - that account's password (scrypt hash), and "must change password" off
//   - that account's lockout (cleared)
//   - signs that account out everywhere (its sessions are ended)
//   - one audit-log line (never the password)
//
// Safe while MediTrack runs in the background: SQLite (WAL mode) lets this tool write while the server
// is running; it waits up to 10 seconds if the server is busy writing, and does everything in one
// transaction. The server checks passwords and sessions in the database on every request, so the change
// takes effect immediately; no restart is needed.
// It never upgrades the database: if the database version doesn't match this copy of MediTrack, it stops.
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { LATEST_VERSION } = require('./migrations');
const { hashPassword, passwordProblem } = require('./passwords');

class Stop extends Error {}

function openDatabase(file) {
  if (!fs.existsSync(file)) throw new Stop(`No MediTrack data found at ${file}. Has MediTrack been set up on this Mac?`);
  const db = new Database(file, { fileMustExist: true });
  db.pragma('busy_timeout = 10000');
  db.pragma('foreign_keys = ON');
  const v = db.pragma('user_version', { simple: true });
  if (v !== LATEST_VERSION) {
    db.close();
    throw new Stop(v < LATEST_VERSION
      ? 'MediTrack needs to update its data first. Start (or restart) MediTrack once, then run this again.'
      : 'This data is from a newer MediTrack. Update this MediTrack folder, then run this again.');
  }
  return db;
}

function homeAdmins(db) {
  return db.prepare(`SELECT id, name, title, email, locked_until FROM users
    WHERE is_home_admin = 1 AND active = 1 AND password_hash IS NOT NULL ORDER BY id`).all();
}

// The change itself, in one transaction. Returns how many sessions were ended.
async function resetAdminPassword(db, userId, password) {
  const problem = passwordProblem(password);
  if (problem) throw new Stop(problem);
  const u = db.prepare('SELECT id FROM users WHERE id = ? AND is_home_admin = 1 AND active = 1 AND password_hash IS NOT NULL').get(userId);
  if (!u) throw new Stop('That is not an active home admin account.');
  const hash = await hashPassword(password);
  const now = new Date().toISOString();
  let ended = 0;
  db.transaction(() => {
    db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0, failed_logins = 0, locked_until = NULL WHERE id = ?').run(hash, userId);
    ended = db.prepare('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL').run(now, userId).changes;
    db.prepare("INSERT INTO audit_log (user_id, action, details) VALUES (?, 'admin_password_reset_on_mac', ?)")
      .run(userId, JSON.stringify({ sessions_ended: ended }));
  }).immediate();
  return ended;
}

// ---------- typing in the Terminal window ----------
// Hidden typing (nothing shown) for passwords when run in a real Terminal window.
// When input is piped (tests), lines are read in order.
function makePrompter(input = process.stdin, output = process.stdout) {
  let lines = null;
  const queue = [];
  if (!input.isTTY) {
    let buf = '';
    lines = new Promise(resolve => {
      input.setEncoding('utf8');
      input.on('data', d => { buf += d; });
      input.on('end', () => resolve(buf.split(/\r?\n/)));
    });
  }
  async function ask(question, { hidden = false } = {}) {
    output.write(question);
    if (lines) {
      const all = await lines;
      if (!queue.length && all.length) queue.push(...all.splice(0));
      const answer = queue.length ? queue.shift() : '';
      output.write('\n');
      return answer;
    }
    return new Promise(resolve => {
      let s = '';
      input.setRawMode(true);
      input.resume();
      input.setEncoding('utf8');
      const onData = chunk => {
        for (const c of chunk) {
          if (c === '\r' || c === '\n') {
            input.setRawMode(false); input.pause(); input.removeListener('data', onData);
            output.write('\n');
            return resolve(s);
          }
          if (c === '\u0003') { output.write('\nStopped. Nothing was changed.\n'); process.exit(130); }
          if (c === '\u007f' || c === '\b') { if (s.length) { s = s.slice(0, -1); if (!hidden) output.write('\b \b'); } continue; }
          s += c;
          if (!hidden) output.write(c);
        }
      };
      input.on('data', onData);
    });
  }
  return ask;
}

async function main({ dbFile, ask, log = console.log }) {
  log('');
  log('  MediTrack: reset the home admin password');
  log('  -----------------------------------------');
  const db = openDatabase(dbFile);
  try {
    const admins = homeAdmins(db);
    if (!admins.length) throw new Stop('There is no home admin account yet. Open MediTrack to create one with the setup code.');
    const label = a => `${a.name}${a.title ? ' (' + a.title + ')' : ''}, ${a.email}`;
    let chosen = admins[0];
    if (admins.length > 1) {
      log('  Home admin accounts:');
      admins.forEach((a, i) => log(`    ${i + 1}. ${label(a)}`));
      const n = Number(String(await ask('  Type the number of the account to reset, then press Return: ')).trim());
      chosen = admins[n - 1];
      if (!chosen) throw new Stop('That number is not on the list. Nothing was changed.');
    }
    const yes = String(await ask(`  Reset the password for ${label(chosen)}? Type y and press Return: `)).trim().toLowerCase();
    if (yes !== 'y' && yes !== 'yes') throw new Stop('Stopped. Nothing was changed.');
    log('  Type the new password. Nothing shows while you type; that is normal. At least 10 characters.');
    const pw1 = await ask('  New password: ', { hidden: true });
    const problem = passwordProblem(pw1);
    if (problem) throw new Stop(problem + ' Nothing was changed.');
    const pw2 = await ask('  Type it again: ', { hidden: true });
    if (pw1 !== pw2) throw new Stop('The two passwords are not the same. Nothing was changed.');
    const ended = await resetAdminPassword(db, chosen.id, pw1);
    log('');
    log(`  Done. The password for ${chosen.email} is changed and the account is unlocked.`);
    log(`  It was signed out on ${ended} device${ended === 1 ? '' : 's'}. Sign in again with the new password.`);
    log('');
    return 0;
  } finally {
    db.close();
  }
}

if (require.main === module) {
  const dbFile = process.env.MEDITRACK_DB_PATH || path.join(__dirname, 'meditrack.db');
  main({ dbFile, ask: makePrompter() })
    .then(code => process.exit(code))
    .catch(e => {
      console.log('');
      if (e instanceof Stop) console.log('  ' + e.message);
      else if (e && e.code === 'SQLITE_BUSY') console.log('  MediTrack is busy right now. Wait a minute and try again. Nothing was changed.');
      else console.log('  Something went wrong. Nothing was changed. (' + (e && e.message) + ')');
      console.log('');
      process.exit(1);
    });
}

module.exports = { resetAdminPassword, homeAdmins, openDatabase, main, Stop };
