// Mac helpers used when MediTrack runs as a background service (M0).
// - keepAwake(): stops the Mac from idle-sleeping while MediTrack runs.
// - rotateLogs(): keeps the log files in ~/Library/Logs/MediTrack small.
// Nothing here logs health data.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

// Starts `caffeinate -i -s -w <pid>` when MEDITRACK_KEEP_AWAKE=1 on a Mac.
// -i: no idle sleep. -s: no system sleep while on power. -w: exit when MediTrack exits.
// The screen can still turn off. Returns the child process, or null if not started.
function keepAwake({ env = process.env, platform = process.platform, pid = process.pid, spawnFn = spawn } = {}) {
  if (env.MEDITRACK_KEEP_AWAKE !== '1') return null;
  if (platform !== 'darwin') return null;
  try {
    const child = spawnFn('/usr/bin/caffeinate', ['-i', '-s', '-w', String(pid)], { stdio: 'ignore', detached: false });
    child.on('error', () => console.log('Keep-awake could not start (caffeinate missing). The Mac may sleep.'));
    // If MediTrack exits, -w ends caffeinate too. Kill it explicitly as well, to be safe.
    process.on('exit', () => { try { child.kill(); } catch {} });
    console.log('Keep-awake is on: this Mac will not idle-sleep while MediTrack runs (the screen can still turn off).');
    return child;
  } catch {
    console.log('Keep-awake could not start. The Mac may sleep.');
    return null;
  }
}

const MAX_LOG_BYTES = 5 * 1024 * 1024; // 5 MB

// When launchd writes our output to files, they would grow forever.
// If a log file is bigger than 5 MB, keep one old copy (.old) and empty the current one.
// launchd opens the files in append mode, so emptying them in place is safe.
function rotateLogs({ env = process.env, maxBytes = MAX_LOG_BYTES } = {}) {
  const dir = env.MEDITRACK_LOG_DIR;
  if (!dir) return [];
  const rotated = [];
  for (const name of ['meditrack.log', 'meditrack-error.log']) {
    const file = path.join(dir, name);
    try {
      if (fs.statSync(file).size <= maxBytes) continue;
      fs.copyFileSync(file, file + '.old');
      fs.truncateSync(file, 0);
      rotated.push(name);
    } catch {} // file missing or not readable: nothing to do
  }
  return rotated;
}

function startLogRotation(opts) {
  rotateLogs(opts);
  const timer = setInterval(() => rotateLogs(opts), 6 * 60 * 60 * 1000); // every 6 hours
  timer.unref();
  return timer;
}

// Shows a macOS notification (used for the first-run setup code). Does nothing on other systems.
function notify(text, { platform = process.platform, execFileFn = require('child_process').execFile } = {}) {
  if (platform !== 'darwin') return false;
  const safe = String(text).replace(/["\\]/g, '');
  execFileFn('/usr/bin/osascript', ['-e', `display notification "${safe}" with title "MediTrack"`], () => {});
  return true;
}

module.exports = { keepAwake, rotateLogs, startLogRotation, notify, MAX_LOG_BYTES };
