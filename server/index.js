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
const network = require('./network');
let server;
let firstStart = true;
// Listens on all connections (Home Wi-Fi mode) or on this Mac only (Tailscale mode).
function listen() {
  const mode = network.getMode();
  server = app.listen(PORT, network.listenHost(mode), () => {
    const url = 'http://localhost:' + PORT;
    console.log('');
    console.log('  MediTrack is running!');
    console.log('  On this computer:  ' + url);
    if (mode === 'tailscale') {
      const https = network.normalizeHttpsUrl(db.getSetting('https_url'));
      console.log('  On your phones (Tailscale on):  ' + (https || 'the HTTPS address in Settings'));
      console.log('  Tailscale mode: MediTrack is not open on the Wi-Fi.');
    } else {
      for (const u of network.lanUrls(PORT)) console.log('  On your phone (same Wi-Fi):  ' + u);
    }
    console.log('');
    if (!firstStart) return;
    firstStart = false;
    if (process.env.MEDITRACK_LOG_DIR) console.log('  Running in the background. It starts by itself when you log in to this Mac.');
    else console.log('  Keep this window open while you use MediTrack. Close it to stop.');
    console.log('');
    macos.startLogRotation();
    macos.keepAwake();
    recordStart();
    auth.prepareSetupCode(); // first run only: shows the setup code here and as a Mac notification
    openBrowser(url);
  });
  server.on('error', onError);
}
// Settings → Phone access switched mode: stop listening and listen again on the new address.
network.events.on('mode-changed', () => {
  const old = server;
  old.close(() => listen());
  old.closeAllConnections();
});
listen();
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
function onError(e) {
  if (e.code === 'EADDRINUSE') {
    console.log('MediTrack is already running. Opening it in your browser...');
    openBrowser('http://localhost:' + PORT);
    setTimeout(() => process.exit(0), 1500);
  } else {
    throw e;
  }
}
