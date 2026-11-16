// Care team directory, tasks, email drafts, provider lookup, and call tips.
const express = require('express');
const db = require('./db');

const PROVIDER_TYPES = ['doctor', 'specialist', 'dme', 'pharmacy', 'home_nursing', 'therapy', 'insurance', 'hospital', 'school', 'other'];

const PROVIDER_FIELDS = ['name', 'type', 'specialty', 'contact_person', 'phone', 'fax', 'email', 'website', 'portal_url',
  'address', 'city', 'state', 'zip', 'npi', 'account_number', 'tips', 'notes', 'favorite', 'source'];

const PROFILE_FIELDS = ['child_name', 'dob', 'parent_name', 'parent_phone', 'parent_email', 'address', 'city', 'state', 'zip',
  'insurance_name', 'insurance_member_id', 'medicaid_id', 'diagnoses', 'equipment', 'notes', 'onboarded'];

// Built-in "what to say" guidance per provider type. Shown in the app even without the AI assistant.
const CALL_TIPS = {
  dme: {
    have_ready: ['Child\'s full name and date of birth', 'Insurance / Medicaid ID', 'Your account or patient number with the DME company', 'Exact item names, sizes and quantities (e.g. "MIC-KEY 14Fr 1.5cm")', 'Ordering doctor\'s name'],
    script: 'Hi, my name is [your name]. I\'m calling for my son [child\'s name], date of birth [DOB]. His account number is [account #]. I need to order his monthly resupply of [items and quantities]. Can you confirm you have a current prescription on file and give me the expected ship date?',
    tips: ['Ask for the name of the person you spoke with and a reference number.', 'If they say the prescription expired, ask them to fax the renewal request to the doctor and get the fax date.', 'Ask whether insurance needs a new prior authorization.', 'Request tracking info once it ships.'],
  },
  doctor: {
    have_ready: ['Child\'s name and DOB', 'What you need (refill, letter of medical necessity, prescription renewal, appointment)', 'DME company name and fax number if a form needs to go to them'],
    script: 'Hi, I\'m [your name], parent of [child\'s name], DOB [DOB]. I\'m calling because [DME company] needs a [prescription renewal / signed order / letter of medical necessity] for [item]. Their fax number is [fax]. Can you tell me who handles that and when it will be sent?',
    tips: ['Ask for the nurse line or medical records/forms department directly.', 'Write down when they say it will be faxed, then call the DME company to confirm it arrived.', 'For urgent clinical issues call the nurse line, or 911 for emergencies.'],
  },
  specialist: {
    have_ready: ['Child\'s name and DOB', 'Referring doctor', 'Reason for the call', 'Recent symptoms or readings (SpO2, vent settings, weights)'],
    script: 'Hi, I\'m [your name], parent of [child\'s name], DOB [DOB]. He\'s followed by Dr. [name] for [condition]. I\'m calling about [reason]. Who is the best person to speak with?',
    tips: ['Ask for the clinic nurse or care coordinator; they usually solve problems fastest.', 'Ask if there is a patient portal message option for non-urgent questions.'],
  },
  pharmacy: {
    have_ready: ['Child\'s name and DOB', 'Prescription number(s)', 'Insurance card'],
    script: 'Hi, I\'m calling to refill a prescription for [child\'s name], DOB [DOB]. The prescription number is [Rx #]. When will it be ready, and is it covered?',
    tips: ['If it\'s a compounded or specialty med, ask how much lead time they need.', 'Ask if they can sync refills to one pickup date.'],
  },
  insurance: {
    have_ready: ['Member ID', 'Child\'s name and DOB', 'Claim number or authorization number if you have one', 'Provider names and dates of service'],
    script: 'Hi, I\'m the parent and guardian of member [child\'s name], member ID [ID], DOB [DOB]. I\'m calling about [prior authorization / denied claim / coverage for item]. Can you tell me the current status and what is needed to resolve it?',
    tips: ['Always ask for a call reference number and the rep\'s name.', 'Ask whether your child has a case manager; they can be a big help for complex care.', 'If denied, ask for the denial reason in writing and the appeal deadline.'],
  },
  home_nursing: {
    have_ready: ['Child\'s name', 'Dates/shifts in question', 'Nurse names'],
    script: 'Hi, I\'m [your name], parent of [child\'s name]. I\'m calling about nursing coverage for [dates/shifts]. Can you confirm who is scheduled?',
    tips: ['Ask for the scheduler or clinical supervisor.', 'Keep a written log of missed or uncovered shifts.'],
  },
  therapy: {
    have_ready: ['Child\'s name and DOB', 'Therapy type (PT/OT/Speech)', 'Authorization dates'],
    script: 'Hi, I\'m calling for [child\'s name], DOB [DOB], about his [PT/OT/speech] therapy. I need to [schedule / check authorization / request equipment eval].',
    tips: ['Therapists can often help justify equipment such as wheelchairs, standers or bath chairs.'],
  },
  hospital: {
    have_ready: ['Child\'s name and DOB', 'MRN if you have it', 'Department you need'],
    script: 'Hi, I\'m the parent of [child\'s name], DOB [DOB]. Could you connect me with [department]?',
    tips: ['The main operator can transfer you to almost any department.', 'For records requests, ask for Health Information Management (HIM).'],
  },
  other: {
    have_ready: ['Child\'s name and DOB', 'Reason for your call'],
    script: 'Hi, my name is [your name]. I\'m calling on behalf of my son [child\'s name] about [reason].',
    tips: ['Write down who you spoke with, the date, and what was promised.'],
  },
};
CALL_TIPS.school = CALL_TIPS.other;

// Maps app provider types to NPPES taxonomy search terms.
const NPI_TAXONOMY = {
  dme: 'Durable Medical Equipment',
  pharmacy: 'Pharmacy',
  home_nursing: 'Home Health',
  doctor: 'Pediatrics',
  therapy: 'Physical Therapist',
  hospital: 'Hospital',
  specialist: 'Pediatric',
};

function parseProvider(p) {
  if (!p) return p;
  let departments = [];
  try { departments = JSON.parse(p.departments || '[]'); } catch { departments = []; }
  return { ...p, departments };
}

// The profile screens still use one flat object with child_name. Since M1 it lives in the
// `patients` table (first_name + last_name); the old patient_profile table is kept untouched.
const { splitName } = require('./migrations');
const PATIENT_FIELDS = PROFILE_FIELDS.filter(f => f !== 'child_name');

// Every function below takes the patient id (pid) first and only touches that patient's rows.
function getProfile(pid) {
  const p = db.prepare('SELECT * FROM patients WHERE id = ?').get(pid);
  if (!p) return p;
  const child_name = [p.first_name, p.last_name].filter(Boolean).join(' ') || null;
  return { ...p, child_name };
}

function updateProfile(pid, fields) {
  const cur = getProfile(pid);
  if (!cur) return null;
  const next = {};
  for (const f of PATIENT_FIELDS) next[f] = fields[f] !== undefined ? fields[f] : cur[f];
  let names = { first_name: cur.first_name, last_name: cur.last_name };
  if (fields.first_name !== undefined || fields.last_name !== undefined) {
    names = {
      first_name: fields.first_name !== undefined ? (String(fields.first_name || '').trim() || null) : cur.first_name,
      last_name: fields.last_name !== undefined ? (String(fields.last_name || '').trim() || null) : cur.last_name,
    };
  } else if (fields.child_name !== undefined) names = splitName(fields.child_name);
  db.prepare(`UPDATE patients SET first_name=?, last_name=?, ${PATIENT_FIELDS.map(f => f + '=?').join(',')}, version=version+1, updated_at=CURRENT_TIMESTAMP WHERE id=?`)
    .run(names.first_name, names.last_name, ...PATIENT_FIELDS.map(f => next[f]), pid);
  return getProfile(pid);
}

function listProviders(pid, { search, type } = {}) {
  let sql = 'SELECT * FROM providers';
  const cond = ['patient_id = ?'], params = [pid];
  if (type) { cond.push('type = ?'); params.push(type); }
  if (search) {
    cond.push('(name LIKE ? OR specialty LIKE ? OR contact_person LIKE ? OR notes LIKE ? OR departments LIKE ?)');
    const t = '%' + search + '%'; params.push(t, t, t, t, t);
  }
  sql += ' WHERE ' + cond.join(' AND ');
  sql += ' ORDER BY favorite DESC, type, name';
  return db.prepare(sql).all(...params).map(parseProvider);
}

function getProvider(pid, id) {
  return parseProvider(db.prepare('SELECT * FROM providers WHERE id = ? AND patient_id = ?').get(id, pid));
}

// A link to another record (provider, task) must point to this patient's record; otherwise 400.
function checkLink(pid, table, id) {
  if (!id) return null;
  const row = db.prepare(`SELECT id FROM ${table} WHERE id = ? AND patient_id = ?`).get(id, pid);
  if (!row) { const e = new Error('Linked ' + (table === 'providers' ? 'provider' : 'task') + ' not found'); e.status = 400; throw e; }
  return row.id;
}

function normalizeDepartments(d) {
  if (!Array.isArray(d)) return '[]';
  return JSON.stringify(d.filter(x => x && x.name).map(x => ({
    name: String(x.name), phone: x.phone || '', ext: x.ext || '', fax: x.fax || '', email: x.email || '', tip: x.tip || '',
  })));
}

function createProvider(pid, data) {
  if (!data.name) { const e = new Error('name is required'); e.status = 400; throw e; }
  const type = PROVIDER_TYPES.includes(data.type) ? data.type : 'other';
  const vals = PROVIDER_FIELDS.map(f => f === 'type' ? type : f === 'favorite' ? (data.favorite ? 1 : 0) : f === 'source' ? (data.source || 'manual') : (data[f] ?? null));
  const r = db.prepare(`INSERT INTO providers (${PROVIDER_FIELDS.join(',')},departments,patient_id) VALUES (${PROVIDER_FIELDS.map(() => '?').join(',')},?,?)`)
    .run(...vals, normalizeDepartments(data.departments), pid);
  return getProvider(pid, r.lastInsertRowid);
}

function updateProvider(pid, id, data) {
  const cur = db.prepare('SELECT * FROM providers WHERE id = ? AND patient_id = ?').get(id, pid);
  if (!cur) return null;
  const next = { ...cur };
  for (const f of PROVIDER_FIELDS) if (data[f] !== undefined) next[f] = data[f];
  if (!PROVIDER_TYPES.includes(next.type)) next.type = 'other';
  next.favorite = next.favorite ? 1 : 0;
  const departments = data.departments !== undefined ? normalizeDepartments(data.departments) : cur.departments;
  db.prepare(`UPDATE providers SET ${PROVIDER_FIELDS.map(f => f + '=?').join(',')}, departments=?, version=version+1, updated_at=CURRENT_TIMESTAMP WHERE id=? AND patient_id=?`)
    .run(...PROVIDER_FIELDS.map(f => next[f]), departments, id, pid);
  return getProvider(pid, id);
}

function parseTask(t) {
  if (!t) return t;
  let steps = [];
  try { steps = JSON.parse(t.steps || '[]'); } catch { steps = []; }
  return { ...t, steps };
}

function normalizeSteps(steps) {
  if (!Array.isArray(steps)) return '[]';
  return JSON.stringify(steps.map(s => typeof s === 'string' ? { text: s, done: false } : { text: String(s.text || ''), done: !!s.done }).filter(s => s.text));
}

function listTasks(pid, { status, provider_id } = {}) {
  let sql = 'SELECT t.*, p.name AS provider_name FROM tasks t LEFT JOIN providers p ON t.provider_id = p.id AND p.patient_id = t.patient_id';
  const cond = ['t.patient_id = ?'], params = [pid];
  if (status === 'active') cond.push("t.status != 'done'");
  else if (status) { cond.push('t.status = ?'); params.push(status); }
  if (provider_id) { cond.push('t.provider_id = ?'); params.push(provider_id); }
  sql += ' WHERE ' + cond.join(' AND ');
  sql += " ORDER BY CASE t.status WHEN 'done' THEN 1 ELSE 0 END, COALESCE(t.due_date, '9999'), t.created_at DESC";
  return db.prepare(sql).all(...params).map(parseTask);
}

function getTask(pid, id) {
  return parseTask(db.prepare('SELECT t.*, p.name AS provider_name FROM tasks t LEFT JOIN providers p ON t.provider_id = p.id AND p.patient_id = t.patient_id WHERE t.id = ? AND t.patient_id = ?').get(id, pid));
}

function createTask(pid, { title, description, provider_id, due_date, steps, status }) {
  if (!title) { const e = new Error('title is required'); e.status = 400; throw e; }
  const r = db.prepare('INSERT INTO tasks (title, description, provider_id, due_date, steps, status, patient_id) VALUES (?,?,?,?,?,?,?)')
    .run(title, description || null, checkLink(pid, 'providers', provider_id), due_date || null, normalizeSteps(steps), ['open', 'in_progress', 'waiting', 'done'].includes(status) ? status : 'open', pid);
  return getTask(pid, r.lastInsertRowid);
}

function updateTask(pid, id, data) {
  const cur = db.prepare('SELECT * FROM tasks WHERE id = ? AND patient_id = ?').get(id, pid);
  if (!cur) return null;
  const status = ['open', 'in_progress', 'waiting', 'done'].includes(data.status) ? data.status : cur.status;
  db.prepare('UPDATE tasks SET title=?, description=?, provider_id=?, due_date=?, status=?, steps=?, version=version+1, updated_at=CURRENT_TIMESTAMP WHERE id=? AND patient_id=?').run(
    data.title ?? cur.title, data.description ?? cur.description,
    data.provider_id !== undefined ? checkLink(pid, 'providers', data.provider_id) : cur.provider_id,
    data.due_date ?? cur.due_date, status,
    data.steps !== undefined ? normalizeSteps(data.steps) : cur.steps, id, pid);
  return getTask(pid, id);
}

function getDraft(pid, id) {
  return db.prepare('SELECT o.*, p.name AS provider_name FROM outbox o LEFT JOIN providers p ON o.provider_id = p.id AND p.patient_id = o.patient_id WHERE o.id = ? AND o.patient_id = ?').get(id, pid);
}

function createDraft(pid, { provider_id, task_id, to_email, subject, body }) {
  if (!subject || !body) { const e = new Error('subject and body are required'); e.status = 400; throw e; }
  const prov = checkLink(pid, 'providers', provider_id);
  const task = checkLink(pid, 'tasks', task_id);
  let to = to_email;
  if (!to && prov) to = getProvider(pid, prov)?.email || null;
  const r = db.prepare('INSERT INTO outbox (provider_id, task_id, to_email, subject, body, patient_id) VALUES (?,?,?,?,?,?)')
    .run(prov, task, to || null, subject, body, pid);
  return getDraft(pid, r.lastInsertRowid);
}

// Searches the free public CMS NPPES NPI Registry. Returns phone and fax (no email: the registry doesn't publish it).
async function lookupNpi({ city, state, postal_code, type, name, limit = 20 }) {
  if (!state && !postal_code) throw new Error('state or zip code is required');
  const params = new URLSearchParams({ version: '2.1', limit: String(Math.min(Number(limit) || 20, 50)) });
  if (city) params.set('city', city);
  if (state) params.set('state', state.toUpperCase());
  if (postal_code) params.set('postal_code', String(postal_code).slice(0, 5));
  if (name) params.set('organization_name', name.trim().endsWith('*') ? name.trim() : name.trim() + '*');
  else if (type && NPI_TAXONOMY[type]) params.set('taxonomy_description', NPI_TAXONOMY[type]);
  const res = await fetch('https://npiregistry.cms.hhs.gov/api/?' + params, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error('NPI registry returned HTTP ' + res.status);
  const data = await res.json();
  if (data.Errors) throw new Error(data.Errors.map(e => e.description).join('; '));
  const fmtPhone = s => { const d = String(s || '').replace(/\D/g, ''); return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : (s || ''); };
  return (data.results || []).map(r => {
    const b = r.basic || {};
    const loc = (r.addresses || []).find(a => a.address_purpose === 'LOCATION') || (r.addresses || [])[0] || {};
    const primary = (r.taxonomies || []).find(t => t.primary) || (r.taxonomies || [])[0] || {};
    const personName = [b.first_name, b.last_name].filter(Boolean).join(' ');
    return {
      npi: String(r.number),
      name: b.organization_name || (personName ? personName + (b.credential ? ', ' + b.credential : '') : 'Unknown'),
      specialty: primary.desc || '',
      phone: fmtPhone(loc.telephone_number),
      fax: fmtPhone(loc.fax_number),
      address: [loc.address_1, loc.address_2].filter(Boolean).join(', '),
      city: loc.city || '', state: loc.state || '', zip: (loc.postal_code || '').slice(0, 5),
      type: type || 'other',
    };
  });
}

const wrap = fn => async (req, res) => {
  try { await fn(req, res); } catch (e) { res.status(e.status || 500).json({ error: e.status ? e.message : 'Something went wrong' }); }
};

// Routes that don't touch patient data (signed-in users only; see index.js).
const router = express.Router();
router.get('/call-tips', wrap((req, res) => res.json(CALL_TIPS)));
router.get('/lookup', wrap(async (req, res) => {
  try { res.json(await lookupNpi(req.query)); }
  catch (e) { res.status(502).json({ error: 'Provider lookup failed: ' + e.message }); }
}));

// Patient data: mounted at /api/patients/:pid after the membership check, which sets req.patientId.
const patientRouter = express.Router();
patientRouter.get('/profile', wrap((req, res) => res.json(getProfile(req.patientId))));
patientRouter.put('/profile', wrap((req, res) => res.json(updateProfile(req.patientId, req.body || {}))));

patientRouter.get('/providers', wrap((req, res) => res.json(listProviders(req.patientId, req.query))));
patientRouter.get('/providers/types', wrap((req, res) => res.json(PROVIDER_TYPES)));
patientRouter.get('/providers/:id', wrap((req, res) => {
  const p = getProvider(req.patientId, req.params.id);
  if (!p) return res.status(404).json({ error: 'Provider not found' });
  res.json(p);
}));
patientRouter.post('/providers', wrap((req, res) => res.status(201).json(createProvider(req.patientId, req.body || {}))));
patientRouter.post('/providers/bulk', wrap((req, res) => {
  const items = Array.isArray(req.body) ? req.body : [];
  const saved = db.transaction(list => list.map(x => createProvider(req.patientId, x)))(items);
  res.status(201).json(saved);
}));
patientRouter.put('/providers/:id', wrap((req, res) => {
  const p = updateProvider(req.patientId, req.params.id, req.body || {});
  if (!p) return res.status(404).json({ error: 'Provider not found' });
  res.json(p);
}));
patientRouter.delete('/providers/:id', wrap((req, res) => {
  const r = db.prepare('DELETE FROM providers WHERE id = ? AND patient_id = ?').run(req.params.id, req.patientId);
  if (!r.changes) return res.status(404).json({ error: 'Provider not found' });
  res.json({ success: true });
}));

patientRouter.get('/tasks', wrap((req, res) => res.json(listTasks(req.patientId, req.query))));
patientRouter.post('/tasks', wrap((req, res) => res.status(201).json(createTask(req.patientId, req.body || {}))));
patientRouter.put('/tasks/:id', wrap((req, res) => {
  const t = updateTask(req.patientId, req.params.id, req.body || {});
  if (!t) return res.status(404).json({ error: 'Task not found' });
  res.json(t);
}));
patientRouter.delete('/tasks/:id', wrap((req, res) => {
  const r = db.prepare('DELETE FROM tasks WHERE id = ? AND patient_id = ?').run(req.params.id, req.patientId);
  if (!r.changes) return res.status(404).json({ error: 'Task not found' });
  res.json({ success: true });
}));

patientRouter.get('/outbox', wrap((req, res) => {
  res.json(db.prepare('SELECT o.*, p.name AS provider_name FROM outbox o LEFT JOIN providers p ON o.provider_id = p.id AND p.patient_id = o.patient_id WHERE o.patient_id = ? ORDER BY o.created_at DESC LIMIT 100').all(req.patientId));
}));
patientRouter.post('/outbox', wrap((req, res) => res.status(201).json(createDraft(req.patientId, req.body || {}))));
patientRouter.put('/outbox/:id', wrap((req, res) => {
  const d = getDraft(req.patientId, req.params.id);
  if (!d) return res.status(404).json({ error: 'Draft not found' });
  if (d.status === 'sent') return res.status(400).json({ error: 'Already sent' });
  const { to_email, subject, body } = req.body || {};
  db.prepare("UPDATE outbox SET to_email=?, subject=?, body=?, status='draft', error=NULL, version=version+1 WHERE id=? AND patient_id=?")
    .run(to_email ?? d.to_email, subject ?? d.subject, body ?? d.body, d.id, req.patientId);
  res.json(getDraft(req.patientId, d.id));
}));
patientRouter.delete('/outbox/:id', wrap((req, res) => {
  const r = db.prepare("DELETE FROM outbox WHERE id = ? AND patient_id = ? AND status != 'sent'").run(req.params.id, req.patientId);
  if (!r.changes) return res.status(404).json({ error: 'Draft not found' });
  res.json({ success: true });
}));

module.exports = {
  router, patientRouter, CALL_TIPS, PROVIDER_TYPES,
  getProfile, updateProfile, listProviders, getProvider, createProvider, updateProvider,
  listTasks, getTask, createTask, updateTask, createDraft, getDraft, lookupNpi,
};
