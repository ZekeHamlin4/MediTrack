// MediTrack service worker (M13 app shell, Phase 1a).
// It does ONE thing: when a page can't be loaded because the home Mac is unreachable, it shows the
// cached offline screen. It never caches the app itself, API answers or anything with patient data:
// pages and data always come fresh from the Mac, so an old copy can never get stuck on a phone.
// The server fills in VERSION from the file contents, so any change makes phones pick up the new worker.
const VERSION = '__VERSION__';
const CACHE = 'meditrack-offline-' + VERSION;
const OFFLINE_URL = '/offline.html';
const WAIT_MS = 8000; // if the Mac doesn't answer in 8 seconds, show the offline screen

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(c => c.add(new Request(OFFLINE_URL, { cache: 'reload' }))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
  const req = event.request;
  // Only page loads. Everything else (API calls, scripts, images) goes straight to the network as normal.
  if (req.method !== 'GET' || req.mode !== 'navigate') return;
  event.respondWith(new Promise(resolve => {
    let done = false;
    const offline = () => { if (!done) { done = true; caches.match(OFFLINE_URL).then(r => resolve(r || Response.error())); } };
    const timer = setTimeout(offline, WAIT_MS);
    fetch(req).then(res => { clearTimeout(timer); if (!done) { done = true; resolve(res); } }).catch(() => { clearTimeout(timer); offline(); });
  }));
});
