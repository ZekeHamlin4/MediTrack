const fs = require('fs');
const envPath = require('path').join(__dirname, '.env');
if (fs.existsSync(envPath)) process.loadEnvFile(envPath);
const db = require('./db');
const macos = require('./macos');
const auth = require('./auth');
const app = require('./app');
const PORT = process.env.PORT || 3000;
function openBrowser(url) {
  if (!process.env.MEDITRACK_OPEN_BROWSER) return;
  const { exec } = require('child_process');
  const cmd = process.platform === 'win32' ? `start "" "${url}"` : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
  exec(cmd, () => {});
}
function lanAddresses() {
  const out = [];
  for (const list of Object.values(require('os').networkInterfaces())) {
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal) out.push(a.address);
  }
  return out;
}
const server = app.listen(PORT, () => {
  const url = 'http://localhost:' + PORT;
  console.log('');
  console.log('  MediTrack is running!');
  console.log('  On this computer:  ' + url);
  for (const ip of lanAddresses()) console.log('  On your phone (same Wi-Fi):  http://' + ip + ':' + PORT);
  console.log('');
  if (process.env.MEDITRACK_LOG_DIR) console.log('  Running in the background. It starts by itself when you log in to this Mac.');
  else console.log('  Keep this window open while you use MediTrack. Close it to stop.');
  console.log('');
  macos.startLogRotation();
  macos.keepAwake();
  recordStart();
  auth.prepareSetupCode(); // first run only: shows the setup code here and as a Mac notification
  openBrowser(url);
});
// Uptime and the audit log: record when MediTrack starts and stops (no health data).
function recordStart() {
  db.setSetting('server_started_at', new Date().toISOString());
  db.audit('server_start', { details: { pid: process.pid } });
}
let stopping = false;
function recordStopAndExit(signal) {
  if (stopping) return;
  stopping = true;
  try {
    db.setSetting('server_stopped_at', new Date().toISOString());
    db.audit('server_stop', { details: { signal } });
    db.close();
  } catch {}
  process.exit(0);
}
for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(sig, () => recordStopAndExit(sig));
server.on('error', e => {
  if (e.code === 'EADDRINUSE') {
    console.log('MediTrack is already running. Opening it in your browser...');
    openBrowser('http://localhost:' + PORT);
    setTimeout(() => process.exit(0), 1500);
  } else {
    throw e;
  }
});
