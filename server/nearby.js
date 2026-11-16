// "Search near a ZIP" for providers (Fix 2).
// How it works, in plain words:
// 1. A bundled list (data/zip-centroids.csv, US Census 2022) gives the map point at the center of every ZIP.
// 2. We find every ZIP within the chosen distance (25 miles, or 50 with "Search wider") of the family's ZIP,
//    and ask the free national NPI registry for providers in those areas (by the first 3 ZIP digits).
// 3. Each office is its own result. Distance = straight line between the center of the family's ZIP and the
//    center of the office's ZIP. Results are sorted nearest first; offices farther than the limit are dropped.
// Only the ZIP digits, the provider type and an optional company name are sent to the registry. Never any
// patient information.
const fs = require('fs');
const path = require('path');

const REGISTRY = 'https://npiregistry.cms.hhs.gov/api/';
const PAGE = 200;            // the registry's maximum per request
const MAX_PAGES = 3;         // up to 600 results per 3-digit ZIP area
const PARALLEL = 4;
const RADII = [25, 50];

// ---------- ZIP centers ----------
let ZIPS = null;      // '43215' -> { lat, lng }
let BY_PREFIX = null; // '432' -> ['43201', ...]
function loadZips(file = path.join(__dirname, 'data', 'zip-centroids.csv')) {
  if (ZIPS) return ZIPS;
  ZIPS = new Map(); BY_PREFIX = new Map();
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  for (let i = 1; i < lines.length; i++) {
    const [zip, lat, lng] = lines[i].split(',');
    if (!zip || zip.length !== 5) continue;
    ZIPS.set(zip, { lat: +lat, lng: +lng });
    const p = zip.slice(0, 3);
    if (!BY_PREFIX.has(p)) BY_PREFIX.set(p, []);
    BY_PREFIX.get(p).push(zip);
  }
  return ZIPS;
}
function zipCenter(zip) { return loadZips().get(String(zip || '').slice(0, 5)) || null; }

// Straight-line ("as the crow flies") distance in miles.
function milesBetween(a, b) {
  const R = 3958.8, rad = d => d * Math.PI / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// The 3-digit ZIP areas that have at least one ZIP within `miles` of the origin (crosses state lines).
function prefixesWithin(origin, miles) {
  loadZips();
  const out = [];
  for (const [prefix, zips] of BY_PREFIX) {
    if (zips.some(z => milesBetween(origin, ZIPS.get(z)) <= miles)) out.push(prefix);
  }
  return out.sort();
}

// ---------- registry ----------
const fmtPhone = s => { const d = String(s || '').replace(/\D/g, ''); return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : (s || ''); };

function offline() {
  const e = new Error("Provider search needs the internet right now, and the national provider registry didn't answer. Try again later, or type the provider in yourself.");
  e.status = 502;
  return e;
}

async function fetchArea(prefix, { taxonomy, name }, fetchFn) {
  const results = [];
  let truncated = false;
  for (let page = 0; page < MAX_PAGES; page++) {
    const params = new URLSearchParams({ version: '2.1', limit: String(PAGE), skip: String(page * PAGE), postal_code: prefix + '*' });
    if (name) params.set('organization_name', name.trim().endsWith('*') ? name.trim() : name.trim() + '*');
    else if (taxonomy) params.set('taxonomy_description', taxonomy);
    let data;
    try {
      const res = await fetchFn(REGISTRY + '?' + params, { signal: AbortSignal.timeout(15000) });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      data = await res.json();
    } catch { throw offline(); }
    if (data.Errors) { const e = new Error('Provider registry: ' + data.Errors.map(x => x.description).join('; ')); e.status = 502; throw e; }
    const list = data.results || [];
    results.push(...list);
    if (list.length < PAGE) break;
    if (page === MAX_PAGES - 1) truncated = true; // there may be more than we fetched
  }
  return { results, truncated };
}

// One row per office: the main practice address plus any extra practice locations.
function officesOf(r, type) {
  const b = r.basic || {};
  const primary = (r.taxonomies || []).find(t => t.primary) || (r.taxonomies || [])[0] || {};
  const personName = [b.first_name, b.last_name].filter(Boolean).join(' ');
  const name = b.organization_name || (personName ? personName + (b.credential ? ', ' + b.credential : '') : 'Unknown');
  const main = (r.addresses || []).find(a => a.address_purpose === 'LOCATION');
  const extra = r.practiceLocations || r.practice_locations || [];
  return [main, ...extra].filter(Boolean).map((loc, i) => ({
    key: `${r.number}-${i}`,
    npi: String(r.number),
    name,
    specialty: primary.desc || '',
    phone: fmtPhone(loc.telephone_number),
    fax: fmtPhone(loc.fax_number),
    address: [loc.address_1, loc.address_2].filter(Boolean).join(', '),
    city: loc.city || '', state: loc.state || '', zip: String(loc.postal_code || '').slice(0, 5),
    type: type || 'other',
  }));
}

async function runLimited(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i]); }
  }));
  return out;
}

// Returns { zip, radius, results: [...offices nearest first, each with distance_miles], truncated }.
async function searchNearby({ zip, type, name, radius, taxonomy }, fetchFn = globalThis.fetch) {
  const z = String(zip || '').trim().slice(0, 5);
  if (!/^\d{5}$/.test(z)) { const e = new Error('Please enter a 5-digit ZIP code.'); e.status = 400; throw e; }
  const origin = zipCenter(z);
  if (!origin) {
    const e = new Error(`We can't place ZIP ${z} on the map (it may be a PO-box-only ZIP). Try a nearby ZIP, or search by city and state.`);
    e.status = 400; throw e;
  }
  const miles = RADII.includes(Number(radius)) ? Number(radius) : RADII[0];
  const areas = prefixesWithin(origin, miles);
  const pages = await runLimited(areas, PARALLEL, p => fetchArea(p, { taxonomy, name }, fetchFn));

  const seen = new Set();
  const results = [];
  for (const { results: list } of pages) {
    for (const r of list) {
      for (const o of officesOf(r, type)) {
        const id = `${o.npi}|${o.address}|${o.zip}`.toLowerCase();
        if (seen.has(id)) continue; // the same office can come back from two areas
        seen.add(id);
        const c = zipCenter(o.zip);
        if (!c) continue; // can't tell how far it is
        const d = milesBetween(origin, c);
        if (d > miles) continue;
        results.push({ ...o, distance_miles: Math.round(d * 10) / 10 });
      }
    }
  }
  results.sort((a, b) => a.distance_miles - b.distance_miles || a.name.localeCompare(b.name));
  return { zip: z, radius: miles, results, truncated: pages.some(p => p.truncated) };
}

module.exports = { searchNearby, milesBetween, zipCenter, prefixesWithin, loadZips, RADII, PAGE, MAX_PAGES };
