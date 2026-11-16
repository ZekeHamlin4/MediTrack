// Tests for "search near a ZIP" (Fix 2), with a pretend NPI registry (the real one isn't reachable from tests).
// Run: cd server && npm test
const test = require('node:test');
const assert = require('node:assert');
const nearby = require('../nearby');

// A pretend registry: records listed per 3-digit ZIP area. Records each the shape the real registry uses.
function rec(number, name, locZip, { extra = [], mailingZip, phone = '6145550100', desc = 'Durable Medical Equipment & Medical Supplies' } = {}) {
  const addr = (zip, purpose) => ({ address_purpose: purpose, address_1: '1 Main St', city: 'Town', state: 'OH', postal_code: zip + '1234', telephone_number: phone, fax_number: '6145550199' });
  return {
    number,
    basic: { organization_name: name },
    taxonomies: [{ primary: true, desc }],
    addresses: [addr(locZip, 'LOCATION'), addr(mailingZip || locZip, 'MAILING')],
    practiceLocations: extra.map(z => ({ ...addr(z, undefined), address_1: '9 Branch Rd ' + z })),
  };
}
function fakeRegistry(byPrefix, { fail } = {}) {
  const calls = [];
  const fetchFn = async url => {
    const u = new URL(url);
    calls.push(Object.fromEntries(u.searchParams));
    if (fail === 'throw') throw new Error('getaddrinfo ENOTFOUND');
    if (fail === 'http') return { ok: false, status: 503, json: async () => ({}) };
    const prefix = u.searchParams.get('postal_code').replace('*', '');
    const all = byPrefix[prefix] || [];
    const skip = +u.searchParams.get('skip'), limit = +u.searchParams.get('limit');
    return { ok: true, status: 200, json: async () => ({ result_count: Math.min(limit, all.length - skip), results: all.slice(skip, skip + limit) }) };
  };
  return { fetchFn, calls };
}

test('nearest offices first, with straight-line miles; farther ones dropped', async () => {
  const { fetchFn, calls } = fakeRegistry({
    432: [rec(1, 'Downtown DME', '43215')],
    430: [rec(2, 'Mount Vernon DME', '43050'), rec(3, 'Dublin DME', '43016')],
  });
  const r = await nearby.searchNearby({ zip: '43215', type: 'dme', taxonomy: 'Durable Medical Equipment' }, fetchFn);
  assert.equal(r.radius, 25);
  assert.deepEqual(r.results.map(x => [x.name, x.distance_miles]), [['Downtown DME', 0], ['Dublin DME', 11.6]]);
  assert.equal(r.results[0].phone, '(614) 555-0100');
  assert.equal(r.results[0].zip, '43215');
  // Areas asked: every 3-digit ZIP area with a ZIP within 25 miles.
  assert.deepEqual([...new Set(calls.map(c => c.postal_code))].sort(), ['430*', '431*', '432*']);
  // Only ZIP digits, provider type and paging go to the registry (no patient info).
  for (const c of calls) assert.deepEqual(Object.keys(c).sort(), ['limit', 'postal_code', 'skip', 'taxonomy_description', 'version']);

  const wide = await nearby.searchNearby({ zip: '43215', type: 'dme', radius: 50, taxonomy: 'Durable Medical Equipment' }, fetchFn);
  assert.equal(wide.radius, 50);
  assert.deepEqual(wide.results.map(x => x.name), ['Downtown DME', 'Dublin DME', 'Mount Vernon DME']);
  // Any other radius falls back to 25.
  assert.equal((await nearby.searchNearby({ zip: '43215', radius: 500 }, fetchFn)).radius, 25);
});

test('each office of a company is its own row, nearest first (not grouped)', async () => {
  const { fetchFn } = fakeRegistry({
    432: [rec(10, 'Big DME Co', '43215', { extra: ['43085', '45202'] })], // Columbus + Worthington + Cincinnati branch
    430: [rec(11, 'Big DME Co', '43017')],                                 // another branch with its own NPI
  });
  const r = await nearby.searchNearby({ zip: '43215', type: 'dme' }, fetchFn);
  assert.deepEqual(r.results.map(x => [x.name, x.zip, x.distance_miles]), [
    ['Big DME Co', '43215', 0], ['Big DME Co', '43085', 9.3], ['Big DME Co', '43017', 12.3],
  ], 'Cincinnati branch (99 miles) left out');
  assert.equal(new Set(r.results.map(x => x.key)).size, 3, 'each row can be ticked separately');
  assert.match(r.results[1].address, /Branch Rd 43085/);
});

test('a mailing address nearby does not count; only practice locations', async () => {
  const { fetchFn } = fakeRegistry({ 432: [rec(20, 'Far Office', '45202', { mailingZip: '43215' })] });
  const r = await nearby.searchNearby({ zip: '43215' }, fetchFn);
  assert.deepEqual(r.results, []);
});

test('more than 200 results: pages through, and says when the list was cut short', async () => {
  const many = n => Array.from({ length: n }, (_, i) => rec(1000 + i, 'DME ' + String(i).padStart(3, '0'), '43215'));
  let reg = fakeRegistry({ 432: many(450) });
  let r = await nearby.searchNearby({ zip: '43215' }, reg.fetchFn);
  assert.equal(r.results.length, 450);
  assert.equal(r.truncated, false);
  assert.deepEqual(reg.calls.filter(c => c.postal_code === '432*').map(c => c.skip), ['0', '200', '400']);

  reg = fakeRegistry({ 432: many(700) });
  r = await nearby.searchNearby({ zip: '43215' }, reg.fetchFn);
  assert.equal(r.results.length, 600, 'stops after 3 pages');
  assert.equal(r.truncated, true);
});

test('the same office returned twice is shown once', async () => {
  const same = rec(30, 'Twice DME', '43215');
  const { fetchFn } = fakeRegistry({ 432: [same], 431: [same] });
  assert.equal((await nearby.searchNearby({ zip: '43215' }, fetchFn)).results.length, 1);
});

test('company name search uses the name, not the type', async () => {
  const { fetchFn, calls } = fakeRegistry({ 432: [rec(40, 'Apria Healthcare', '43215')] });
  await nearby.searchNearby({ zip: '43215', name: 'Apria', taxonomy: null }, fetchFn);
  assert.equal(calls[0].organization_name, 'Apria*');
  assert.equal(calls[0].taxonomy_description, undefined);
});

test('crosses state lines (Cincinnati includes northern Kentucky)', () => {
  assert.ok(nearby.prefixesWithin(nearby.zipCenter('45202'), 25).includes('410'));
});

test('unknown or invalid ZIP: a clear message, nothing sent', async () => {
  const { fetchFn, calls } = fakeRegistry({});
  await assert.rejects(nearby.searchNearby({ zip: '00000' }, fetchFn), e => e.status === 400 && /can't place ZIP 00000/.test(e.message));
  await assert.rejects(nearby.searchNearby({ zip: '12' }, fetchFn), e => e.status === 400 && /5-digit/.test(e.message));
  assert.equal(calls.length, 0);
});

test('registry down or no internet: a plain message', async () => {
  for (const fail of ['throw', 'http']) {
    const { fetchFn } = fakeRegistry({}, { fail });
    await assert.rejects(nearby.searchNearby({ zip: '43215' }, fetchFn), e => e.status === 502 && /needs the internet/.test(e.message) && /type the provider in yourself/.test(e.message));
  }
});

test('ZIP list is loaded and distances are sensible', () => {
  assert.ok(nearby.loadZips().size > 33000);
  const d = nearby.milesBetween(nearby.zipCenter('43215'), nearby.zipCenter('45202'));
  assert.ok(d > 95 && d < 105, 'Columbus to Cincinnati is about 100 miles');
});

let careModule = null;
function loadCare() {
  if (!careModule) {
    process.env.MEDITRACK_DB_PATH = require('path').join(require('os').tmpdir(), `meditrack-nearby-test-${process.pid}.db`);
    careModule = require('../care');
  }
  return careModule;
}
test.after(() => {
  if (!careModule) return;
  require('../db').close();
  for (const f of require('fs').readdirSync(require('os').tmpdir())) if (f.startsWith(`meditrack-nearby-test-${process.pid}`)) require('fs').rmSync(require('path').join(require('os').tmpdir(), f));
});

test('city and state search is unchanged', async () => {
  const care = loadCare();
  const original = globalThis.fetch;
  let asked;
  globalThis.fetch = async url => { asked = new URL(url); return { ok: true, json: async () => ({ results: [rec(50, 'City DME', '43215')] }) }; };
  try {
    const r = await care.lookupNpi({ city: 'Columbus', state: 'oh', postal_code: '', type: 'dme', name: '' });
    assert.deepEqual(Object.fromEntries(asked.searchParams), { version: '2.1', limit: '20', city: 'Columbus', state: 'OH', taxonomy_description: 'Durable Medical Equipment' });
    assert.equal(r.length, 1);
    assert.deepEqual(Object.keys(r[0]).sort(), ['address', 'city', 'fax', 'name', 'npi', 'phone', 'specialty', 'state', 'type', 'zip']);
  } finally {
    globalThis.fetch = original;
  }
});

// ---------- company name searches cover every type ----------
const { typeFromTaxonomy } = require('../provider-types');

test('specialty text gives each office its own type', () => {
  const cases = {
    'Durable Medical Equipment & Medical Supplies': 'dme', 'Pharmacy, Community/Retail Pharmacy': 'pharmacy',
    'Home Health': 'home_nursing', 'General Acute Care Hospital': 'hospital', 'Physical Therapist': 'therapy',
    'Pediatrics': 'doctor', 'Pediatrics, Pediatric Pulmonology': 'specialist', 'Something New': 'other', '': 'other',
  };
  for (const [desc, type] of Object.entries(cases)) assert.equal(typeFromTaxonomy(desc), type, desc);
});

const sameCompany = () => ({
  432: [rec(60, 'Acme Health', '43215', { desc: 'Pharmacy, Community/Retail Pharmacy' }),
        rec(61, 'Acme Health', '43215', { desc: 'Durable Medical Equipment & Medical Supplies' }),
        rec(62, 'Acme Health', '43215', { desc: 'Home Health' })],
});

test('near a ZIP with a company name: no type filter sent, every type kept, each labelled', async () => {
  const care = loadCare();
  const reg = fakeRegistry(sameCompany());
  const original = globalThis.fetch; globalThis.fetch = reg.fetchFn;
  try {
    const r = await care.lookupNearby({ zip: '43215', type: 'dme', name: '  Acme ' });
    for (const c of reg.calls) {
      assert.equal(c.taxonomy_description, undefined, 'no type filter');
      assert.equal(c.organization_name, 'Acme*');
    }
    assert.deepEqual(r.results.map(x => x.type).sort(), ['dme', 'home_nursing', 'pharmacy']);
    // Without a name: the chosen type is the filter and the label, as before.
    reg.calls.length = 0;
    const plain = await care.lookupNearby({ zip: '43215', type: 'dme', name: '' });
    assert.ok(reg.calls.every(c => c.taxonomy_description === 'Durable Medical Equipment' && c.organization_name === undefined));
    assert.ok(plain.results.every(x => x.type === 'dme'));
  } finally { globalThis.fetch = original; }
});

test('city and state with a company name: no type filter sent, every type kept, each labelled', async () => {
  const care = loadCare();
  let asked;
  const original = globalThis.fetch;
  globalThis.fetch = async url => { asked = new URL(url); return { ok: true, json: async () => ({ results: sameCompany()[432] }) }; };
  try {
    const r = await care.lookupNpi({ city: 'Columbus', state: 'OH', postal_code: '', type: 'dme', name: 'Acme' });
    const params = Object.fromEntries(asked.searchParams);
    assert.equal(params.organization_name, 'Acme*');
    assert.equal(params.taxonomy_description, undefined);
    assert.deepEqual(r.map(x => x.type).sort(), ['dme', 'home_nursing', 'pharmacy']);
    // A name made only of spaces counts as no name: back to the chosen type.
    await care.lookupNpi({ city: 'Columbus', state: 'OH', type: 'pharmacy', name: '   ' });
    assert.equal(asked.searchParams.get('taxonomy_description'), 'Pharmacy');
    assert.equal(asked.searchParams.get('organization_name'), null);
  } finally { globalThis.fetch = original; }
});
