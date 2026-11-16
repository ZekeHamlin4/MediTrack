// Tests for phone access (M10) and the app shell (M13): modes, HTTPS check, tailscale serve headers,
// moving the listener, and the service worker. Run: cd server && npm test
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { spawn } = require('child_process');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'meditrack-network-test-'));
process.env.MEDITRACK_DB_PATH = path.join(tmpDir, 'meditrack.db');
const db = require('../db');
const auth = require('../auth');
const network = require('../network');
const app = require('../app');

let server, base;
test.before(async () => { await new Promise(r => { server = app.listen(0, '127.0.0.1', r); }); base = `http://127.0.0.1:${server.address().port}`; });
test.after(() => { server.close(); db.close(); fs.rmSync(tmpDir, { recursive: true, force: true }); });

async function call(method, url, { body, cookie, headers = {} } = {}) {
  const res = await fetch(base + url, { method, headers: { origin: base, 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  const m = /mt_session=([^;]+)/.exec(res.headers.get('set-cookie') || '');
  let json = null; const text = await res.text(); try { json = JSON.parse(text); } catch {}
  return { status: res.status, body: json, text, headers: res.headers, cookie: m ? 'mt_session=' + m[1] : null };
}

test('addresses: only Tailscale https addresses are accepted', () => {
  assert.equal(network.normalizeHttpsUrl(' https://MT-Home.tail1234.ts.net/ '), 'https://mt-home.tail1234.ts.net');
  for (const bad of ['http://mt-home.tail1234.ts.net', 'https://example.com', 'https://mt-home.ts.net', '', null]) assert.equal(network.normalizeHttpsUrl(bad), null, String(bad));
});

test('finds the address from the Tailscale app, trying each place it may be installed', async () => {
  const tried = [];
  const execFileFn = (cmd, args, opts, cb) => {
    tried.push(cmd);
    if (cmd === 'tailscale') return cb(new Error('not found'));
    cb(null, JSON.stringify({ Self: { DNSName: 'mt-home.tail1234.ts.net.' } }));
  };
  assert.equal(await network.detectTailscaleUrl({ execFileFn }), 'https://mt-home.tail1234.ts.net');
  assert.deepEqual(tried, ['tailscale', '/Applications/Tailscale.app/Contents/MacOS/Tailscale']);
  assert.equal(await network.detectTailscaleUrl({ execFileFn: (c, a, o, cb) => cb(new Error('no')) }), null);
});

test('HTTPS check: must answer and be this MediTrack', async () => {
  const id = network.instanceId();
  const answer = body => async () => ({ ok: true, json: async () => body });
  assert.deepEqual(await network.checkHttps('https://mt-home.tail1234.ts.net', { fetchFn: answer({ ok: true, instance: id }) }), { ok: true });
  assert.equal((await network.checkHttps('https://mt-home.tail1234.ts.net', { fetchFn: answer({ ok: true, instance: 'other' }) })).reason, 'other_server');
  assert.equal((await network.checkHttps('https://mt-home.tail1234.ts.net', { fetchFn: async () => { throw new Error('ENOTFOUND'); } })).reason, 'no_answer');
  assert.equal((await network.checkHttps('https://mt-home.tail1234.ts.net', { fetchFn: async () => ({ ok: false, status: 502 }) })).reason, 'http_502');
  assert.equal((await network.checkHttps('')).reason, 'not_set');
  // The health answer is public and holds no data.
  const h = await call('GET', '/api/health');
  assert.deepEqual(Object.keys(h.body).sort(), ['app', 'instance', 'ok']);
  assert.equal(h.body.instance, id);
});

test('listens on this Mac only in Tailscale mode; on all connections in Home Wi-Fi mode', () => {
  assert.equal(network.listenHost('tailscale'), '127.0.0.1');
  assert.equal(network.listenHost('lan'), undefined);
  assert.equal(network.getMode(), 'lan', 'default stays Home Wi-Fi until switched');
});

// Fake requests as Express would see them.
const fakeReq = ({ method = 'POST', ip = '127.0.0.1', headers = {} }) => ({ method, socket: { remoteAddress: ip }, secure: false, get: h => headers[h.toLowerCase()] });
function sameOrigin(req) { let status = 200; const res = { status: s => { status = s; return { json: () => {} }; } }; auth.sameOrigin(req, res, () => {}); return status; }

test('behind tailscale serve: same-origin check and Secure cookies', () => {
  const ts = 'https://mt-home.tail1234.ts.net';
  // tailscale serve keeps the Host, or passes it as X-Forwarded-Host; both work from this Mac.
  assert.equal(sameOrigin(fakeReq({ headers: { origin: ts, host: 'mt-home.tail1234.ts.net' } })), 200);
  assert.equal(sameOrigin(fakeReq({ headers: { origin: ts, host: '127.0.0.1:3000', 'x-forwarded-host': 'mt-home.tail1234.ts.net', 'x-forwarded-proto': 'https' } })), 200);
  // From another device on the Wi-Fi, X-Forwarded-Host is not trusted.
  assert.equal(sameOrigin(fakeReq({ ip: '192.168.1.40', headers: { origin: ts, host: '192.168.1.10:3000', 'x-forwarded-host': 'mt-home.tail1234.ts.net' } })), 403);
  assert.equal(sameOrigin(fakeReq({ headers: { origin: 'https://evil.example', host: 'mt-home.tail1234.ts.net' } })), 403);
  // Secure cookie: HTTPS via tailscale serve (from this Mac), or the ts.net address.
  assert.equal(auth.isHttps(fakeReq({ headers: { 'x-forwarded-proto': 'https', host: '127.0.0.1:3000' } })), true);
  assert.equal(auth.isHttps(fakeReq({ headers: { host: 'mt-home.tail1234.ts.net' } })), true);
  assert.equal(auth.isHttps(fakeReq({ ip: '192.168.1.40', headers: { 'x-forwarded-proto': 'https', host: '192.168.1.10:3000' } })), false);
  assert.equal(auth.isHttps(fakeReq({ headers: { host: 'localhost:3000' } })), false);
});

test('a full sign-in through the tailscale serve headers gets a Secure cookie', async () => {
  const code = auth.prepareSetupCode(() => {});
  const ts = 'https://mt-home.tail1234.ts.net';
  const r = await call('POST', '/api/setup', {
    body: { code, name: 'Test Admin', email: 'admin@example.test', password: 'admin password 123', over18: true },
    headers: { origin: ts, 'x-forwarded-host': 'mt-home.tail1234.ts.net', 'x-forwarded-proto': 'https' },
  });
  assert.equal(r.status, 201);
  assert.match(r.headers.get('set-cookie'), /Secure/);
});

test('Settings → Phone access: home admin only; switching to Tailscale asks first if HTTPS is not working', async () => {
  const admin = (await call('POST', '/api/auth/login', { body: { email: 'admin@example.test', password: 'admin password 123' } })).cookie;
  assert.equal((await call('GET', '/api/admin/network')).status, 401);
  assert.equal((await call('PUT', '/api/admin/network', { cookie: admin, body: { https_url: 'https://example.com' } })).status, 400);
  assert.equal((await call('PUT', '/api/admin/network', { cookie: admin, body: { https_url: 'https://mt-home.tail1234.ts.net' } })).status, 200);

  const events = [];
  network.events.on('mode-changed', m => events.push(m));
  let r = await call('POST', '/api/admin/network/mode', { cookie: admin, body: { mode: 'tailscale' } });
  assert.equal(r.status, 409, 'the address does not answer in the test');
  assert.equal(r.body.needs_confirm, true);
  assert.equal(network.getMode(), 'lan');
  r = await call('POST', '/api/admin/network/mode', { cookie: admin, body: { mode: 'tailscale', force: true } });
  assert.equal(r.status, 200);
  assert.equal(network.getMode(), 'tailscale');
  await new Promise(res => setTimeout(res, 500));
  assert.deepEqual(events, ['tailscale'], 'listener asked to move after the answer');
  assert.equal((await call('POST', '/api/admin/network/mode', { cookie: admin, body: { mode: 'lan' } })).status, 200);
  assert.equal(network.getMode(), 'lan');
  assert.equal((await call('POST', '/api/admin/network/mode', { cookie: admin, body: { mode: 'open-to-all' } })).status, 400);
  assert.ok(db.prepare("SELECT COUNT(*) c FROM audit_log WHERE action = 'connection_mode_changed'").get().c >= 2);

  // Warn if the Mac's name contains the child's name.
  db.prepare("UPDATE patients SET first_name = 'Sammy' WHERE id = 1").run();
  assert.match(network.nameWarning('https://sammys-macbook.tail1234.ts.net'), /child's name/);
  assert.equal(network.nameWarning('https://mt-home.tail1234.ts.net'), null);
});

test('service worker: served fresh with a content version', async () => {
  const r = await call('GET', '/sw.js');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /javascript/);
  assert.match(r.headers.get('cache-control'), /no-store/);
  assert.doesNotMatch(r.text, /__VERSION__/);
  assert.match(r.text, /const VERSION = '[0-9a-f]{12}'/);
  for (const f of ['/manifest.webmanifest', '/offline.html', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/apple-touch-icon.png']) {
    assert.equal((await call('GET', f)).status, 200, f);
  }
  const page = (await call('GET', '/')).text;
  assert.match(page, /rel="manifest"/);
  assert.match(page, /serviceWorker\.register\('\/sw\.js'\)/);
});

// Runs sw.js in a pretend browser to see exactly what it caches and answers.
function loadWorker() {
  const handlers = {};
  const stores = { 'meditrack-offline-old': new Map([['/index.html', 'stale page']]) };
  const caches = {
    open: async name => { stores[name] = stores[name] || new Map(); return { add: async req => { stores[name].set(new URL(req.url, 'https://x').pathname, 'offline page'); } }; },
    keys: async () => Object.keys(stores),
    delete: async name => { delete stores[name]; return true; },
    match: async url => { for (const s of Object.values(stores)) if (s.has(url)) return s.get(url); return undefined; },
  };
  const ctx = {
    self: { addEventListener: (t, fn) => { handlers[t] = fn; }, skipWaiting: async () => {}, clients: { claim: async () => {} } },
    caches, Request: class { constructor(url, o) { this.url = url; this.opts = o; } },
    Response: { error: () => 'error' }, setTimeout, clearTimeout, Promise, fetch: null,
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../../client/sw.js'), 'utf8').replace('__VERSION__', 'test'), ctx);
  const fire = async (type, event) => { const waits = []; event.waitUntil = p => waits.push(p); handlers[type](event); await Promise.all(waits); };
  const fetchEvent = req => { let answer = null; const ev = { request: req, respondWith: p => { answer = p; } }; handlers.fetch(ev); return answer; };
  return { ctx, stores, fire, fetchEvent };
}

test('service worker caches only the offline screen and removes old caches', async () => {
  const w = loadWorker();
  await w.fire('install', {});
  await w.fire('activate', {});
  assert.deepEqual(Object.keys(w.stores), ['meditrack-offline-test'], 'old cache (with a stale page) removed');
  assert.deepEqual([...w.stores['meditrack-offline-test'].keys()], ['/offline.html'], 'nothing else cached');
});

test('service worker: API calls and files are not touched; pages come from the Mac, offline screen if unreachable', async () => {
  const w = loadWorker();
  await w.fire('install', {});
  let fetched = 0;
  w.ctx.fetch = async () => { fetched++; return 'fresh page from the Mac'; };
  // API calls, scripts, and anything that isn't a page load: the worker stays out of the way.
  assert.equal(w.fetchEvent({ method: 'GET', mode: 'cors', url: '/api/patients/1/supplies' }), null);
  assert.equal(w.fetchEvent({ method: 'POST', mode: 'navigate', url: '/' }), null);
  assert.equal(w.fetchEvent({ method: 'GET', mode: 'no-cors', url: '/care.jsx' }), null);
  // Page load with the Mac reachable: the fresh page, and nothing is stored.
  assert.equal(await w.fetchEvent({ method: 'GET', mode: 'navigate', url: '/' }), 'fresh page from the Mac');
  assert.equal(fetched, 1);
  assert.deepEqual([...w.stores['meditrack-offline-test'].keys()], ['/offline.html']);
  // Mac unreachable: the offline screen.
  w.ctx.fetch = async () => { throw new TypeError('Failed to fetch'); };
  assert.equal(await w.fetchEvent({ method: 'GET', mode: 'navigate', url: '/' }), 'offline page');
});

test('switching mode really moves the listener (Home Wi-Fi ↔ this Mac only)', { timeout: 60000 }, async () => {
  const lanIp = Object.values(os.networkInterfaces()).flat().find(a => a && a.family === 'IPv4' && !a.internal);
  if (!lanIp) return test.skip?.('no network address on this machine');
  const dbFile = path.join(tmpDir, 'live.db');
  const port = 30000 + Math.floor(Math.random() * 20000);
  const child = spawn(process.execPath, ['index.js'], { cwd: path.join(__dirname, '..'), env: { ...process.env, MEDITRACK_DB_PATH: dbFile, PORT: String(port) } });
  let out = '';
  child.stdout.on('data', d => { out += d; });
  const until = async (fn, ms = 10000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await new Promise(r => setTimeout(r, 200)); } return false; };
  const reach = async host => { try { await fetch(`http://${host}:${port}/api/health`, { signal: AbortSignal.timeout(1500) }); return true; } catch { return false; } };
  try {
    assert.ok(await until(() => /setup code: \d{4}-\d{4}/.test(out)), out);
    assert.equal(await reach(lanIp.address), true, 'Home Wi-Fi mode: reachable from the network');
    const code = /setup code: (\d{4}-\d{4})/.exec(out)[1];
    const local = `http://127.0.0.1:${port}`;
    const setup = await fetch(local + '/api/setup', { method: 'POST', headers: { origin: local, 'content-type': 'application/json' }, body: JSON.stringify({ code, name: 'A', email: 'a@example.test', password: 'admin password 123', over18: true }) });
    const cookie = /mt_session=[^;]+/.exec(setup.headers.get('set-cookie'))[0];
    const sw = await fetch(local + '/api/admin/network/mode', { method: 'POST', headers: { origin: local, cookie, 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'tailscale', force: true }) });
    assert.equal(sw.status, 200);
    assert.ok(await until(async () => !(await reach(lanIp.address))), 'Tailscale mode: not reachable from the network');
    assert.equal(await reach('127.0.0.1'), true, 'still reachable on this Mac (for tailscale serve)');
    assert.match(out, /Tailscale mode: MediTrack is not open on the Wi-Fi/);
    const back = await fetch(local + '/api/admin/network/mode', { method: 'POST', headers: { origin: local, cookie, 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'lan' }) });
    assert.equal(back.status, 200);
    assert.ok(await until(() => reach(lanIp.address)), 'Home Wi-Fi mode again');
  } finally {
    child.kill('SIGTERM');
    await new Promise(r => child.on('close', r));
  }
});
