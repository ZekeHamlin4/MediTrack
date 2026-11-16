// Care team, setup wizard, tasks and AI assistant screens.
(function () {
const { useState, useEffect, useRef } = React;

const http = async (method, path, body) => {
  const r = await fetch(window.mtPath(path), { method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
  const data = await r.json().catch(() => ({}));
  if (!window.mtCheckAuth(r, data)) return new Promise(() => {});
  if (!r.ok) throw new Error(data.error || ('Request failed (' + r.status + ')'));
  return data;
};
const capi = {
  get: p => http('GET', p), post: (p, b) => http('POST', p, b),
  put: (p, b) => http('PUT', p, b), del: p => http('DELETE', p),
};

const TYPE_LABELS = {
  dme: 'DME / Medical Supply', doctor: 'Primary Doctor', specialist: 'Specialist', pharmacy: 'Pharmacy',
  home_nursing: 'Home Nursing', therapy: 'Therapy', insurance: 'Insurance', hospital: 'Hospital', school: 'School', other: 'Other',
};
const TYPE_COLORS = {
  dme: '#00695c', doctor: '#1565c0', specialist: '#6a1b9a', pharmacy: '#c62828', home_nursing: '#0277bd',
  therapy: '#e65100', insurance: '#2e7d32', hospital: '#37474f', school: '#8d6e63', other: '#616161',
};
const LOOKUP_TYPES = ['dme', 'doctor', 'specialist', 'pharmacy', 'home_nursing', 'therapy', 'hospital'];
const US_STATES = 'AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY'.split(' ');

const telHref = n => 'tel:' + String(n || '').replace(/[^\d+]/g, '');
const typeBadge = t => <span className="badge" style={{ background: (TYPE_COLORS[t] || '#616161') + '22', color: TYPE_COLORS[t] || '#616161' }}>{TYPE_LABELS[t] || t}</span>;

function CopyBtn({ text }) {
  const [ok, setOk] = useState(false);
  if (!text) return null;
  return <button className="btn btn-secondary btn-sm" onClick={() => { navigator.clipboard?.writeText(text); setOk(true); setTimeout(() => setOk(false), 1200); }}>{ok ? 'Copied' : 'Copy'}</button>;
}

function ContactRow({ label, value, href }) {
  if (!value) return null;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', fontSize: '.88rem', padding: '.2rem 0' }}>
      <span style={{ width: 64, color: 'var(--gray-700)', fontWeight: 600, fontSize: '.78rem' }}>{label}</span>
      {href ? <a href={href} style={{ color: 'var(--blue)', fontWeight: 600, wordBreak: 'break-all' }}>{value}</a> : <span style={{ wordBreak: 'break-all' }}>{value}</span>}
      <span style={{ marginLeft: 'auto' }}><CopyBtn text={value} /></span>
    </div>
  );
}

/* ---------------- Provider lookup (NPI registry) ---------------- */
// Search the free national NPI registry. Two ways: near a ZIP (nearest offices first) or by city and state.
const milesText = d => d < 1 ? 'less than 1 mile' : 'about ' + Math.round(d) + (Math.round(d) === 1 ? ' mile' : ' miles');
function ProviderLookup({ profile, onSave, showAlert }) {
  const [mode, setMode] = useState(profile?.zip ? 'zip' : 'city');
  const [q, setQ] = useState({ city: profile?.city || '', state: profile?.state || '', zip: profile?.zip || '', type: 'dme', name: '' });
  const [results, setResults] = useState([]);
  const [picked, setPicked] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [near, setNear] = useState(null); // { radius, truncated } after a ZIP search
  const [searched, setSearched] = useState(false);
  const set = (k, v) => setQ(p => ({ ...p, [k]: v }));
  const keyOf = r => r.key || r.npi;
  const search = async (e, radius = 25) => {
    e && e.preventDefault && e.preventDefault();
    setLoading(true); setError(''); setPicked({}); setNear(null);
    try {
      if (mode === 'zip') {
        const p = new URLSearchParams({ zip: q.zip, type: q.type, name: q.name, radius: String(radius) });
        const r = await capi.get('/api/lookup/nearby?' + p);
        setResults(r.results); setNear({ radius: r.radius, truncated: r.truncated });
      } else {
        const p = new URLSearchParams({ city: q.city, state: q.state, postal_code: '', type: q.type, name: q.name });
        setResults(await capi.get('/api/lookup?' + p));
      }
    } catch (err) { setError(err.message); setResults([]); }
    finally { setLoading(false); setSearched(true); }
  };
  const save = async () => {
    const list = results.filter(r => picked[keyOf(r)]).map(({ key, distance_miles, ...r }) => ({ ...r, source: 'npi' }));
    if (!list.length) return;
    await onSave(list);
    setPicked({});
    showAlert && showAlert('success', list.length + ' provider(s) added to your care team');
  };
  const count = Object.values(picked).filter(Boolean).length;
  const canSearch = mode === 'zip' ? /^\d{5}$/.test(q.zip.trim()) : !!q.state;
  const tab = (m, label) => <button type="button" className={'btn btn-sm ' + (mode === m ? 'btn-primary' : 'btn-secondary')} onClick={() => { setMode(m); setResults([]); setNear(null); setError(''); setSearched(false); }}>{label}</button>;
  const wider = near && near.radius === 25 && <button type="button" className="btn btn-secondary btn-sm" style={{ marginTop: '.5rem' }} disabled={loading} onClick={() => search(null, 50)}>Search wider (50 miles)</button>;
  return (
    <div>
      <div style={{ display: 'flex', gap: '.5rem', marginBottom: '.6rem' }}>{tab('zip', 'Near a ZIP code')}{tab('city', 'By city and state')}</div>
      <form onSubmit={search} className="form-grid" style={{ marginBottom: '.75rem' }}>
        <div className="form-group"><label>Looking for</label>
          <select value={q.type} onChange={e => set('type', e.target.value)}>{LOOKUP_TYPES.map(t => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}</select></div>
        {mode === 'zip' ? (
          <div className="form-group"><label>ZIP code</label><input inputMode="numeric" maxLength={5} value={q.zip} placeholder="e.g. 43215" onChange={e => set('zip', e.target.value.replace(/\D/g, ''))} /></div>
        ) : (<>
          <div className="form-group"><label>City</label><input value={q.city} onChange={e => set('city', e.target.value)} /></div>
          <div className="form-group"><label>State</label>
            <select value={q.state} onChange={e => set('state', e.target.value)}><option value="">--</option>{US_STATES.map(s => <option key={s}>{s}</option>)}</select></div>
        </>)}
        <div className="form-group"><label>Company name (optional)</label><input value={q.name} placeholder="e.g. Apria, Aeroflow" onChange={e => set('name', e.target.value)} /></div>
        <div className="form-group" style={{ justifyContent: 'flex-end' }}><button className="btn btn-primary" disabled={loading || !canSearch}>{loading ? 'Searching...' : 'Search'}</button></div>
      </form>
      <p style={{ fontSize: '.78rem', color: 'var(--gray-700)', marginBottom: '.5rem' }}>
        Results come from the free national NPI registry (phone and fax, no emails). Double-check numbers on your first call.
        {mode === 'zip' && ' Distances are straight-line miles between ZIP code centers, not driving distance.'}
      </p>
      {error && <div className="alert alert-error">{error}</div>}
      {near && <p style={{ fontSize: '.85rem', marginBottom: '.4rem' }}>{results.length ? `${results.length} found within ${near.radius} miles of ${q.zip}, nearest first.` : `Nothing found within ${near.radius} miles of ${q.zip}.`}{near.radius === 50 && !results.length && ' Try a company name, or search by city and state.'}</p>}
      {near && near.truncated && <div className="alert alert-warning">There were more matches than MediTrack can show at once. Add a company name to narrow the search.</div>}
      {results.length > 0 && (
        <div>
          <div style={{ maxHeight: 360, overflowY: 'auto', border: '1px solid var(--gray-200)', borderRadius: 8 }}>
            {results.map(r => (
              <label key={keyOf(r)} style={{ display: 'flex', gap: '.75rem', padding: '.6rem .75rem', borderBottom: '1px solid var(--gray-200)', cursor: 'pointer', fontWeight: 400 }}>
                <input type="checkbox" style={{ width: 'auto' }} checked={!!picked[keyOf(r)]} onChange={e => setPicked(p => ({ ...p, [keyOf(r)]: e.target.checked }))} />
                <div style={{ fontSize: '.85rem' }}>
                  <div style={{ fontWeight: 700, color: 'var(--gray-900)' }}>{r.name}{r.distance_miles != null && <span className="badge badge-blue" style={{ marginLeft: '.4rem' }}>{milesText(r.distance_miles)}</span>}</div>
                  <div>{r.specialty}</div>
                  <div style={{ color: 'var(--gray-700)' }}>{r.address}, {r.city}, {r.state} {r.zip}</div>
                  <div>{r.phone && <>Phone: {r.phone} </>}{r.fax && <> &middot; Fax: {r.fax}</>}</div>
                </div>
              </label>
            ))}
          </div>
          <button className="btn btn-success" style={{ marginTop: '.75rem' }} disabled={!count} onClick={save}>Add {count || ''} selected to care team</button>
        </div>
      )}
      {wider}
      {!loading && !error && !searched && <p style={{ fontSize: '.85rem', color: 'var(--gray-500)' }}>No results yet.</p>}
      {!loading && !error && searched && !near && results.length === 0 && <p style={{ fontSize: '.85rem', color: 'var(--gray-500)' }}>No results.</p>}
    </div>
  );
}

/* ---------------- Provider add/edit modal ---------------- */
const EMPTY_PROVIDER = { name: '', type: 'dme', specialty: '', contact_person: '', phone: '', fax: '', email: '', website: '', portal_url: '', address: '', city: '', state: '', zip: '', account_number: '', tips: '', notes: '', departments: [] };

function ProviderModal({ provider, onClose, onSaved, showAlert }) {
  const [f, setF] = useState(provider ? { ...EMPTY_PROVIDER, ...provider } : { ...EMPTY_PROVIDER });
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setF(p => ({ ...p, [k]: v }));
  const setDept = (i, k, v) => setF(p => ({ ...p, departments: p.departments.map((d, j) => j === i ? { ...d, [k]: v } : d) }));
  const submit = async e => {
    e.preventDefault(); setSaving(true);
    try {
      const saved = provider?.id ? await capi.put('/api/providers/' + provider.id, f) : await capi.post('/api/providers', f);
      showAlert('success', saved.name + ' saved'); onSaved(saved);
    } catch (err) { showAlert('error', err.message); } finally { setSaving(false); }
  };
  const field = (k, label, props = {}) => <div className="form-group" style={props.full ? { gridColumn: '1/-1' } : undefined}><label>{label}</label><input value={f[k] || ''} onChange={e => set(k, e.target.value)} {...props.input} /></div>;
  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 680 }}>
        <div className="modal-header"><h2>{provider?.id ? 'Edit Provider' : 'Add Provider'}</h2><button className="btn btn-secondary btn-sm" onClick={onClose}>x</button></div>
        <form onSubmit={submit}>
          <div className="form-grid">
            <div className="form-group" style={{ gridColumn: '1/-1' }}><label>Name *</label><input required value={f.name} onChange={e => set('name', e.target.value)} /></div>
            <div className="form-group"><label>Type</label><select value={f.type} onChange={e => set('type', e.target.value)}>{Object.keys(TYPE_LABELS).map(t => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}</select></div>
            {field('specialty', 'Specialty / What they provide')}
            {field('contact_person', 'Contact person')}
            {field('account_number', 'Account / Patient #')}
            {field('phone', 'Main phone', { input: { type: 'tel' } })}
            {field('fax', 'Fax', { input: { type: 'tel' } })}
            {field('email', 'Email', { input: { type: 'email' } })}
            {field('website', 'Website')}
            {field('portal_url', 'Patient portal link')}
            {field('address', 'Address', { full: true })}
            {field('city', 'City')}{field('state', 'State')}{field('zip', 'ZIP')}
          </div>
          <div style={{ marginTop: '1rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <label style={{ fontSize: '.9rem' }}>Department directory</label>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => set('departments', [...f.departments, { name: '', phone: '', ext: '', fax: '', email: '', tip: '' }])}>+ Department</button>
            </div>
            {f.departments.map((d, i) => (
              <div key={i} className="form-grid" style={{ border: '1px solid var(--gray-200)', borderRadius: 8, padding: '.6rem', marginTop: '.5rem' }}>
                <div className="form-group"><label>Department</label><input value={d.name} placeholder="e.g. Resupply, Billing, Nurse line" onChange={e => setDept(i, 'name', e.target.value)} /></div>
                <div className="form-group"><label>Phone</label><input value={d.phone} onChange={e => setDept(i, 'phone', e.target.value)} /></div>
                <div className="form-group"><label>Ext / menu option</label><input value={d.ext} placeholder="e.g. press 2" onChange={e => setDept(i, 'ext', e.target.value)} /></div>
                <div className="form-group"><label>Fax</label><input value={d.fax} onChange={e => setDept(i, 'fax', e.target.value)} /></div>
                <div className="form-group"><label>Email</label><input value={d.email} onChange={e => setDept(i, 'email', e.target.value)} /></div>
                <div className="form-group" style={{ gridColumn: '1/-1' }}><label>Tip / what to say</label><input value={d.tip} onChange={e => setDept(i, 'tip', e.target.value)} /></div>
                <button type="button" className="btn btn-danger btn-sm" style={{ width: 'fit-content' }} onClick={() => set('departments', f.departments.filter((_, j) => j !== i))}>Remove</button>
              </div>
            ))}
          </div>
          <div className="form-grid" style={{ marginTop: '1rem' }}>
            <div className="form-group" style={{ gridColumn: '1/-1' }}><label>Tips for contacting them</label><textarea rows={2} value={f.tips || ''} placeholder='e.g. "Ask for Maria in resupply; orders must be in by the 20th"' onChange={e => set('tips', e.target.value)} /></div>
            <div className="form-group" style={{ gridColumn: '1/-1' }}><label>Notes</label><textarea rows={2} value={f.notes || ''} onChange={e => set('notes', e.target.value)} /></div>
          </div>
          <div className="modal-footer"><button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={saving}>{saving ? 'Saving...' : 'Save'}</button></div>
        </form>
      </div>
    </div>
  );
}

/* ---------------- Care team directory ---------------- */
function ProviderCard({ p, tips, onEdit, onDelete, onAsk, onToggleFav }) {
  const [open, setOpen] = useState(false);
  const t = tips[p.type] || tips.other;
  return (
    <div className="card" style={{ borderTop: '3px solid ' + (TYPE_COLORS[p.type] || '#616161'), marginBottom: 0 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '.5rem', marginBottom: '.4rem' }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 800, fontSize: '1rem' }}>{p.name}</div>
          <div style={{ display: 'flex', gap: '.4rem', flexWrap: 'wrap', marginTop: '.25rem' }}>{typeBadge(p.type)}{p.specialty && <span className="badge badge-gray">{p.specialty}</span>}</div>
        </div>
        <button title="Favorite" onClick={() => onToggleFav(p)} style={{ background: 'none', border: 'none', fontSize: '1.3rem', cursor: 'pointer', color: p.favorite ? '#f9a825' : 'var(--gray-300)' }}>&#9733;</button>
      </div>
      <ContactRow label="Phone" value={p.phone} href={telHref(p.phone)} />
      <ContactRow label="Fax" value={p.fax} />
      <ContactRow label="Email" value={p.email} href={'mailto:' + p.email} />
      <ContactRow label="Account" value={p.account_number} />
      <ContactRow label="Contact" value={p.contact_person} />
      {p.portal_url && <ContactRow label="Portal" value={p.portal_url} href={p.portal_url} />}
      {p.departments.length > 0 && (
        <div style={{ marginTop: '.5rem' }}>
          <div style={{ fontSize: '.78rem', fontWeight: 700, color: 'var(--gray-700)', marginBottom: '.25rem' }}>DEPARTMENTS</div>
          {p.departments.map((d, i) => (
            <div key={i} style={{ background: 'var(--gray-100)', borderRadius: 6, padding: '.4rem .6rem', marginBottom: '.3rem', fontSize: '.84rem' }}>
              <strong>{d.name}</strong>{d.phone && <> &middot; <a href={telHref(d.phone)}>{d.phone}</a></>}{d.ext && <> ({d.ext})</>}
              {d.fax && <> &middot; Fax {d.fax}</>}{d.email && <> &middot; <a href={'mailto:' + d.email}>{d.email}</a></>}
              {d.tip && <div style={{ color: 'var(--teal)', marginTop: '.15rem' }}>Tip: {d.tip}</div>}
            </div>
          ))}
        </div>
      )}
      {p.tips && <div className="alert alert-success" style={{ margin: '.5rem 0 0', fontSize: '.82rem' }}>Tip: {p.tips}</div>}
      {p.notes && <div style={{ fontSize: '.82rem', color: 'var(--gray-700)', marginTop: '.4rem' }}>{p.notes}</div>}
      <button className="btn btn-secondary btn-sm" style={{ marginTop: '.6rem' }} onClick={() => setOpen(o => !o)}>{open ? 'Hide' : 'Show'} what to say</button>
      {open && t && (
        <div style={{ marginTop: '.5rem', fontSize: '.84rem', background: 'var(--blue-pale)', borderRadius: 8, padding: '.75rem' }}>
          <strong>Have ready:</strong>
          <ul style={{ margin: '.25rem 0 .5rem 1.2rem' }}>{t.have_ready.map((x, i) => <li key={i}>{x}</li>)}</ul>
          <strong>What to say:</strong>
          <p style={{ fontStyle: 'italic', margin: '.25rem 0 .5rem' }}>"{t.script}"</p>
          <strong>Tips:</strong>
          <ul style={{ margin: '.25rem 0 0 1.2rem' }}>{t.tips.map((x, i) => <li key={i}>{x}</li>)}</ul>
        </div>
      )}
      <div style={{ display: 'flex', gap: '.4rem', flexWrap: 'wrap', marginTop: '.75rem' }}>
        {p.phone && <a className="btn btn-success btn-sm" href={telHref(p.phone)}>Call</a>}
        {onAsk && <button className="btn btn-primary btn-sm" onClick={() => onAsk(p)}>Ask assistant</button>}
        <button className="btn btn-secondary btn-sm" onClick={() => onEdit(p)}>Edit</button>
        <button className="btn btn-danger btn-sm" onClick={() => onDelete(p)}>Delete</button>
      </div>
    </div>
  );
}

function CareTeamTab({ showAlert, onAskAssistant }) {
  const [list, setList] = useState(null);
  const [tips, setTips] = useState({});
  const [profile, setProfile] = useState(null);
  const [search, setSearch] = useState('');
  const [type, setType] = useState('');
  const [edit, setEdit] = useState(null);
  const [showLookup, setShowLookup] = useState(false);
  const load = () => capi.get('/api/providers?' + new URLSearchParams({ search, type })).then(setList).catch(e => showAlert('error', e.message));
  useEffect(() => { capi.get('/api/call-tips').then(setTips); capi.get('/api/profile').then(setProfile); }, []);
  useEffect(() => { load(); }, [search, type]);
  const del = async p => { if (!confirm('Delete ' + p.name + '?')) return; await capi.del('/api/providers/' + p.id); showAlert('success', p.name + ' deleted'); load(); };
  const fav = async p => { await capi.put('/api/providers/' + p.id, { favorite: p.favorite ? 0 : 1 }); load(); };
  const ask = p => onAskAssistant(`I need help with ${p.name}. What should I say when I call them, and is there anything I should request?`);
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '.5rem' }}>
        <div className="section-title" style={{ marginBottom: 0 }}>Care Team</div>
        <div style={{ display: 'flex', gap: '.5rem' }}>
          <button className="btn btn-secondary" onClick={() => setShowLookup(s => !s)}>{showLookup ? 'Close search' : 'Find providers near me'}</button>
          <button className="btn btn-primary" onClick={() => setEdit({})}>+ Add Provider</button>
        </div>
      </div>
      {showLookup && <div className="card"><div className="card-title">Find providers near you</div><ProviderLookup profile={profile} showAlert={showAlert} onSave={async l => { await capi.post('/api/providers/bulk', l); load(); }} /></div>}
      <div className="filter-bar">
        <input type="search" placeholder="Search name, department, notes..." value={search} onChange={e => setSearch(e.target.value)} style={{ flex: 1, minWidth: 180 }} />
        <select value={type} onChange={e => setType(e.target.value)} style={{ width: 'auto' }}><option value="">All types</option>{Object.keys(TYPE_LABELS).map(t => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}</select>
      </div>
      {!list ? <div className="loading"><div className="spinner" />Loading...</div> : list.length === 0 ? (
        <div className="empty-state"><div className="empty-icon">&#128222;</div><p>No providers yet. Add your DME companies and doctors, or search for providers near you.</p></div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(300px,1fr))', gap: '1rem' }}>
          {list.map(p => <ProviderCard key={p.id} p={p} tips={tips} onEdit={setEdit} onDelete={del} onAsk={onAskAssistant ? ask : null} onToggleFav={fav} />)}
        </div>
      )}
      {edit && <ProviderModal provider={edit.id ? edit : null} showAlert={showAlert} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load(); }} />}
    </div>
  );
}

/* ---------------- First-run setup wizard ---------------- */
function SetupWizard({ onDone, showAlert }) {
  const [step, setStep] = useState(1);
  const [p, setP] = useState(null);
  const [added, setAdded] = useState([]);
  const [manual, setManual] = useState(false);
  useEffect(() => { capi.get('/api/profile').then(setP); }, []);
  if (!p) return <div className="loading"><div className="spinner" />Loading...</div>;
  const set = (k, v) => setP(x => ({ ...x, [k]: v }));
  const field = (k, label, type = 'text', full) => <div className="form-group" style={full ? { gridColumn: '1/-1' } : undefined}><label>{label}</label><input type={type} value={p[k] || ''} onChange={e => set(k, e.target.value)} /></div>;
  const saveProfile = async () => { await capi.put('/api/profile', p); setStep(2); };
  const finish = async () => { await capi.put('/api/profile', { onboarded: 1 }); onDone(); };
  return (
    <div className="card" style={{ maxWidth: 820, margin: '0 auto' }}>
      <div className="portal-header" style={{ marginBottom: '1rem' }}>
        <h2>Welcome to MediTrack</h2>
        <p>Step {step} of 3: {step === 1 ? 'About your family' : step === 2 ? 'Your care team' : 'All set'}</p>
      </div>
      {step === 1 && (
        <div>
          <p style={{ marginBottom: '.75rem', fontSize: '.9rem' }}>This information is used to fill in calls, emails and fax requests. It stays on your MediTrack server.</p>
          <div className="form-grid">
            {field('child_name', "Child's name")}{field('dob', 'Date of birth', 'date')}
            {field('parent_name', 'Your name')}{field('parent_phone', 'Your phone', 'tel')}{field('parent_email', 'Your email', 'email')}
            {field('address', 'Street address', 'text', true)}
            {field('city', 'City')}
            <div className="form-group"><label>State</label><select value={p.state || ''} onChange={e => set('state', e.target.value)}><option value="">--</option>{US_STATES.map(s => <option key={s}>{s}</option>)}</select></div>
            {field('zip', 'ZIP')}
            {field('insurance_name', 'Insurance')}{field('insurance_member_id', 'Member ID')}{field('medicaid_id', 'Medicaid / waiver ID')}
            <div className="form-group" style={{ gridColumn: '1/-1' }}><label>Diagnoses (optional)</label><textarea rows={2} value={p.diagnoses || ''} onChange={e => set('diagnoses', e.target.value)} /></div>
            <div className="form-group" style={{ gridColumn: '1/-1' }}><label>Equipment (optional)</label><textarea rows={2} placeholder="e.g. Trilogy vent, Kangaroo Joey pump, MIC-KEY 14Fr 1.5cm, suction machine" value={p.equipment || ''} onChange={e => set('equipment', e.target.value)} /></div>
          </div>
          <div className="modal-footer"><button className="btn btn-secondary" onClick={finish}>Skip setup</button><button className="btn btn-primary" onClick={saveProfile}>Next</button></div>
        </div>
      )}
      {step === 2 && (
        <div>
          <p style={{ fontSize: '.9rem', marginBottom: '.75rem' }}>Add your DME companies, doctors, pharmacy and nursing agency. Enter them yourself, or search near {p.city || 'you'}{p.state ? ', ' + p.state : ''} and pick the ones you use.</p>
          <div style={{ display: 'flex', gap: '.5rem', marginBottom: '1rem' }}>
            <button className={'btn ' + (!manual ? 'btn-primary' : 'btn-secondary')} onClick={() => setManual(false)}>Search near me</button>
            <button className={'btn ' + (manual ? 'btn-primary' : 'btn-secondary')} onClick={() => setManual(true)}>Enter my own</button>
          </div>
          {!manual
            ? <ProviderLookup profile={p} showAlert={showAlert} onSave={async l => { const s = await capi.post('/api/providers/bulk', l); setAdded(a => [...a, ...s]); }} />
            : <ProviderModal provider={null} showAlert={showAlert} onClose={() => setManual(false)} onSaved={s => { setAdded(a => [...a, s]); setManual(false); }} />}
          {added.length > 0 && (
            <div className="alert alert-success" style={{ marginTop: '1rem', display: 'block' }}>
              Added: {added.map(a => a.name).join(', ')}
            </div>
          )}
          <div className="modal-footer"><button className="btn btn-secondary" onClick={() => setStep(1)}>Back</button><button className="btn btn-primary" onClick={() => setStep(3)}>Next</button></div>
        </div>
      )}
      {step === 3 && (
        <div style={{ fontSize: '.92rem' }}>
          <p style={{ marginBottom: '.5rem' }}>You're ready. Here's what you can do:</p>
          <ul style={{ marginLeft: '1.2rem', lineHeight: 1.7 }}>
            <li><strong>Care Team</strong>: phone, fax, email and department numbers, plus "what to say" scripts.</li>
            <li><strong>Tasks</strong>: step-by-step checklists for things in progress.</li>
          </ul>
          <p style={{ marginTop: '.75rem', color: 'var(--gray-700)' }}>You can add more providers or edit your info any time.</p>
          <div className="modal-footer"><button className="btn btn-success" onClick={finish}>Go to my Care Team</button></div>
        </div>
      )}
    </div>
  );
}

/* ---------------- Tasks ---------------- */
function TasksTab({ showAlert }) {
  const [tasks, setTasks] = useState(null);
  const [providers, setProviders] = useState([]);
  const [filter, setFilter] = useState('active');
  const [form, setForm] = useState(null);
  const load = () => capi.get('/api/tasks?status=' + filter).then(setTasks);
  useEffect(() => { load(); }, [filter]);
  useEffect(() => { capi.get('/api/providers').then(setProviders); }, []);
  const update = async (t, patch) => { await capi.put('/api/tasks/' + t.id, patch); load(); };
  const toggleStep = (t, i) => update(t, { steps: t.steps.map((s, j) => j === i ? { ...s, done: !s.done } : s) });
  const save = async e => {
    e.preventDefault();
    try {
      await capi.post('/api/tasks', { ...form, steps: (form.stepsText || '').split('\n').map(s => s.trim()).filter(Boolean) });
      setForm(null); showAlert('success', 'Task added'); load();
    } catch (err) { showAlert('error', err.message); }
  };
  const statusBadge = s => <span className={'badge ' + ({ open: 'badge-blue', in_progress: 'badge-orange', waiting: 'badge-gray', done: 'badge-green' })[s]}>{s.replace('_', ' ')}</span>;
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '.5rem' }}>
        <div className="section-title" style={{ marginBottom: 0 }}>Tasks</div>
        <div style={{ display: 'flex', gap: '.5rem' }}>
          <select value={filter} onChange={e => setFilter(e.target.value)} style={{ width: 'auto' }}><option value="active">Active</option><option value="done">Done</option><option value="">All</option></select>
          <button className="btn btn-primary" onClick={() => setForm({ title: '', description: '', provider_id: '', due_date: '', stepsText: '' })}>+ Add Task</button>
        </div>
      </div>
      {form && (
        <form className="card" onSubmit={save}>
          <div className="form-grid">
            <div className="form-group" style={{ gridColumn: '1/-1' }}><label>Task *</label><input required value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} /></div>
            <div className="form-group"><label>Provider</label><select value={form.provider_id} onChange={e => setForm({ ...form, provider_id: e.target.value })}><option value="">--</option>{providers.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
            <div className="form-group"><label>Due</label><input type="date" value={form.due_date} onChange={e => setForm({ ...form, due_date: e.target.value })} /></div>
            <div className="form-group" style={{ gridColumn: '1/-1' }}><label>Steps (one per line)</label><textarea rows={3} value={form.stepsText} onChange={e => setForm({ ...form, stepsText: e.target.value })} /></div>
          </div>
          <div className="modal-footer"><button type="button" className="btn btn-secondary" onClick={() => setForm(null)}>Cancel</button><button className="btn btn-primary">Save</button></div>
        </form>
      )}
      {!tasks ? <div className="loading"><div className="spinner" />Loading...</div> : tasks.length === 0 ? (
        <div className="empty-state"><div className="empty-icon">&#9989;</div><p>No tasks here.</p></div>
      ) : tasks.map(t => (
        <div key={t.id} className="card" style={{ opacity: t.status === 'done' ? .7 : 1 }}>
          <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <strong style={{ flex: 1 }}>{t.title}</strong>{statusBadge(t.status)}
            <select value={t.status} onChange={e => update(t, { status: e.target.value })} style={{ width: 'auto', padding: '.25rem' }}>
              <option value="open">Open</option><option value="in_progress">In progress</option><option value="waiting">Waiting on someone</option><option value="done">Done</option>
            </select>
            <button className="btn btn-danger btn-sm" onClick={async () => { if (confirm('Delete task?')) { await capi.del('/api/tasks/' + t.id); load(); } }}>x</button>
          </div>
          <div style={{ fontSize: '.8rem', color: 'var(--gray-700)', marginTop: '.25rem' }}>{t.provider_name && <>With {t.provider_name} &middot; </>}{t.due_date && <>Due {t.due_date}</>}</div>
          {t.description && <p style={{ fontSize: '.86rem', marginTop: '.4rem' }}>{t.description}</p>}
          {t.steps.length > 0 && (
            <div style={{ marginTop: '.5rem' }}>
              {t.steps.map((s, i) => (
                <label key={i} style={{ display: 'flex', gap: '.5rem', alignItems: 'flex-start', fontWeight: 400, fontSize: '.88rem', color: 'var(--gray-900)', padding: '.2rem 0', cursor: 'pointer' }}>
                  <input type="checkbox" style={{ width: 'auto', marginTop: '.2rem' }} checked={s.done} onChange={() => toggleStep(t, i)} />
                  <span style={{ textDecoration: s.done ? 'line-through' : 'none' }}>{i + 1}. {s.text}</span>
                </label>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/* ---------------- Outbox (drafts the parent approves) ---------------- */
function DraftCard({ d, emailStatus, onChange, showAlert }) {
  const [edit, setEdit] = useState(false);
  const [f, setF] = useState({ to_email: d.to_email || '', subject: d.subject, body: d.body });
  const [busy, setBusy] = useState(false);
  useEffect(() => setF({ to_email: d.to_email || '', subject: d.subject, body: d.body }), [d.id, d.subject, d.body, d.to_email]);
  const save = async () => { await capi.put('/api/outbox/' + d.id, f); setEdit(false); onChange(); };
  const send = async () => {
    if (!confirm('Send this email to ' + (f.to_email || '(no address)') + '?')) return;
    setBusy(true);
    try { if (edit) await capi.put('/api/outbox/' + d.id, f); await capi.post('/api/outbox/' + d.id + '/send'); showAlert('success', 'Email sent'); setEdit(false); onChange(); }
    catch (e) { showAlert('error', e.message); onChange(); } finally { setBusy(false); }
  };
  const mailto = 'mailto:' + encodeURIComponent(f.to_email || '') + '?subject=' + encodeURIComponent(f.subject) + '&body=' + encodeURIComponent(f.body);
  return (
    <div style={{ border: '1px solid var(--gray-300)', borderRadius: 8, padding: '.75rem', marginBottom: '.6rem', background: 'var(--white)' }}>
      <div style={{ display: 'flex', gap: '.4rem', alignItems: 'center', marginBottom: '.4rem', flexWrap: 'wrap' }}>
        <span className={'badge ' + (d.status === 'sent' ? 'badge-green' : d.status === 'failed' ? 'badge-red' : 'badge-orange')}>{d.status === 'draft' ? 'Draft: needs your OK' : d.status}</span>
        {d.provider_name && <span style={{ fontSize: '.8rem', color: 'var(--gray-700)' }}>{d.provider_name}</span>}
      </div>
      {edit ? (
        <div className="form-grid">
          <div className="form-group" style={{ gridColumn: '1/-1' }}><label>To</label><input value={f.to_email} onChange={e => setF({ ...f, to_email: e.target.value })} /></div>
          <div className="form-group" style={{ gridColumn: '1/-1' }}><label>Subject</label><input value={f.subject} onChange={e => setF({ ...f, subject: e.target.value })} /></div>
          <div className="form-group" style={{ gridColumn: '1/-1' }}><label>Message</label><textarea rows={10} value={f.body} onChange={e => setF({ ...f, body: e.target.value })} /></div>
        </div>
      ) : (
        <div style={{ fontSize: '.86rem' }}>
          <div><strong>To:</strong> {d.to_email || <span style={{ color: 'var(--red)' }}>no email address; tap Edit to add one</span>}</div>
          <div><strong>Subject:</strong> {d.subject}</div>
          <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', background: 'var(--gray-100)', padding: '.6rem', borderRadius: 6, marginTop: '.4rem' }}>{d.body}</pre>
        </div>
      )}
      {d.error && <div className="alert alert-error" style={{ marginTop: '.5rem' }}>{d.error}</div>}
      {d.status !== 'sent' && (
        <div style={{ display: 'flex', gap: '.4rem', flexWrap: 'wrap', marginTop: '.6rem' }}>
          {emailStatus?.send_enabled
            ? <button className="btn btn-success btn-sm" disabled={busy} onClick={send}>{busy ? 'Sending...' : 'Send'}</button>
            : <a className="btn btn-success btn-sm" href={mailto}>Open in my email app</a>}
          {edit ? <button className="btn btn-primary btn-sm" onClick={save}>Save edits</button> : <button className="btn btn-secondary btn-sm" onClick={() => setEdit(true)}>Edit</button>}
          <CopyBtn text={f.body} />
          <button className="btn btn-danger btn-sm" onClick={async () => { await capi.del('/api/outbox/' + d.id); onChange(); }}>Discard</button>
        </div>
      )}
    </div>
  );
}

/* ---------------- Assistant ---------------- */
const SUGGESTIONS = [
  'Email our DME company to request this month\'s feeding supplies',
  'What\'s low on supplies, and who do I call to reorder?',
  'Check my email for anything from our providers that needs a reply',
  'Help me get a new wheelchair approved: what are the steps?',
  'Our trach supplies prescription expired. What do I do?',
];

function renderText(t) {
  return t.split('\n').map((line, i) => {
    const parts = line.split(/(\*\*[^*]+\*\*)/g).map((s, j) => s.startsWith('**') && s.endsWith('**') ? <strong key={j}>{s.slice(2, -2)}</strong> : s);
    return <div key={i} style={{ minHeight: line ? undefined : '.6rem' }}>{parts}</div>;
  });
}

function AssistantTab({ showAlert, initialPrompt, onPromptUsed }) {
  const [status, setStatus] = useState(null);
  const [emailStatus, setEmailStatus] = useState(null);
  const [apiMessages, setApiMessages] = useState([]);
  const [display, setDisplay] = useState([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [drafts, setDrafts] = useState([]);
  const [panel, setPanel] = useState('outbox');
  const [inbox, setInbox] = useState(null);
  const [inboxErr, setInboxErr] = useState('');
  const endRef = useRef(null);
  const loadDrafts = () => capi.get('/api/outbox').then(setDrafts);
  useEffect(() => {
    capi.get('/api/assistant/status').then(setStatus);
    capi.get('/api/email/status').then(setEmailStatus);
    loadDrafts();
  }, []);
  useEffect(() => { if (initialPrompt) { setInput(initialPrompt); onPromptUsed && onPromptUsed(); } }, [initialPrompt]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }, [display, busy]);

  const send = async text => {
    const msg = (text ?? input).trim();
    if (!msg || busy) return;
    setInput('');
    const next = [...apiMessages, { role: 'user', content: msg }];
    setDisplay(d => [...d, { role: 'user', text: msg }]);
    setBusy(true);
    try {
      const r = await capi.post('/api/assistant/chat', { messages: next });
      setApiMessages(r.messages);
      setDisplay(d => [...d, { role: 'assistant', text: r.reply, actions: r.actions }]);
      if (r.actions.some(a => a.type === 'draft_created')) { loadDrafts(); setPanel('outbox'); }
    } catch (e) {
      setDisplay(d => [...d, { role: 'error', text: e.message }]);
    } finally { setBusy(false); }
  };

  const loadInbox = async () => {
    setInbox(null); setInboxErr('');
    try { setInbox(await capi.get('/api/email/inbox?limit=15')); } catch (e) { setInboxErr(e.message); setInbox([]); }
  };

  const actionLabel = a => a.type === 'draft_created' ? 'Email draft added to Outbox: "' + a.draft.subject + '"'
    : a.type === 'task_created' ? 'Task created: ' + a.task.title
    : a.type === 'task_updated' ? 'Task updated: ' + a.task.title
    : a.type === 'provider_saved' ? 'Saved to care team: ' + a.provider.name : a.type;
  const pending = drafts.filter(d => d.status !== 'sent');

  return (
    <div>
      <div className="section-title">Care Assistant</div>
      {status && !status.enabled && (
        <div className="alert alert-warning" style={{ display: 'block' }}>
          The assistant isn't turned on yet. Add your <code>ANTHROPIC_API_KEY</code> to <code>server/.env</code> and restart MediTrack.
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(320px,1fr))', gap: '1rem', alignItems: 'start' }}>
        <div className="card" style={{ display: 'flex', flexDirection: 'column', minHeight: 460 }}>
          <div style={{ flex: 1, overflowY: 'auto', maxHeight: '60vh', paddingRight: '.25rem' }}>
            {display.length === 0 && (
              <div>
                <p style={{ fontSize: '.9rem', marginBottom: '.6rem', color: 'var(--gray-700)' }}>Tell me what you need. I can look up numbers, draft emails, check your inbox, and walk you through what to say. I never send anything until you approve it.</p>
                {SUGGESTIONS.map(s => <button key={s} className="btn btn-secondary btn-sm" style={{ display: 'block', marginBottom: '.4rem', textAlign: 'left' }} onClick={() => send(s)}>{s}</button>)}
              </div>
            )}
            {display.map((m, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start', marginBottom: '.6rem' }}>
                <div style={{
                  maxWidth: '88%', padding: '.6rem .8rem', borderRadius: 12, fontSize: '.9rem', lineHeight: 1.45,
                  background: m.role === 'user' ? 'var(--blue)' : m.role === 'error' ? 'var(--red-light)' : 'var(--gray-100)',
                  color: m.role === 'user' ? 'white' : m.role === 'error' ? 'var(--red)' : 'var(--gray-900)',
                }}>
                  {renderText(m.text)}
                  {m.actions && m.actions.length > 0 && (
                    <div style={{ marginTop: '.5rem' }}>{m.actions.map((a, j) => <div key={j} className="badge badge-green" style={{ display: 'block', marginTop: '.25rem', whiteSpace: 'normal' }}>{actionLabel(a)}</div>)}</div>
                  )}
                </div>
              </div>
            ))}
            {busy && <div className="loading" style={{ padding: '1rem', justifyContent: 'flex-start' }}><div className="spinner" />Working on it...</div>}
            <div ref={endRef} />
          </div>
          <form onSubmit={e => { e.preventDefault(); send(); }} style={{ display: 'flex', gap: '.5rem', marginTop: '.75rem' }}>
            <textarea rows={2} value={input} placeholder="e.g. Email Apria and ask for a new feeding pump backpack" onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }} style={{ flex: 1, resize: 'vertical' }} />
            <button className="btn btn-primary" disabled={busy || !input.trim()}>Send</button>
          </form>
          {display.length > 0 && <button className="btn btn-secondary btn-sm" style={{ marginTop: '.5rem', width: 'fit-content' }} onClick={() => { setApiMessages([]); setDisplay([]); }}>New conversation</button>}
        </div>

        <div className="card">
          <div style={{ display: 'flex', gap: '.5rem', marginBottom: '.75rem' }}>
            <button className={'btn btn-sm ' + (panel === 'outbox' ? 'btn-primary' : 'btn-secondary')} onClick={() => setPanel('outbox')}>Outbox ({pending.length})</button>
            <button className={'btn btn-sm ' + (panel === 'inbox' ? 'btn-primary' : 'btn-secondary')} onClick={() => { setPanel('inbox'); if (!inbox) loadInbox(); }}>Inbox</button>
          </div>
          {panel === 'outbox' && (
            <div>
              {emailStatus && !emailStatus.send_enabled && <p style={{ fontSize: '.78rem', color: 'var(--gray-700)', marginBottom: '.5rem' }}>Direct sending isn't set up, so "Open in my email app" opens a pre-filled email you can send yourself. To send from here, add SMTP settings to server/.env.</p>}
              {drafts.length === 0 ? <p style={{ fontSize: '.86rem', color: 'var(--gray-500)' }}>No drafts yet. Ask the assistant to write an email.</p>
                : drafts.map(d => <DraftCard key={d.id} d={d} emailStatus={emailStatus} onChange={loadDrafts} showAlert={showAlert} />)}
            </div>
          )}
          {panel === 'inbox' && (
            <div>
              <button className="btn btn-secondary btn-sm" style={{ marginBottom: '.5rem' }} onClick={loadInbox}>Refresh</button>
              {inboxErr && <div className="alert alert-warning">{inboxErr}</div>}
              {inbox === null ? <div className="loading"><div className="spinner" />Loading...</div> : inbox.map(m => (
                <div key={m.uid} style={{ borderBottom: '1px solid var(--gray-200)', padding: '.5rem 0', fontSize: '.85rem' }}>
                  <div style={{ fontWeight: 700 }}>{m.subject}</div>
                  <div style={{ color: 'var(--gray-700)' }}>{m.from} &middot; {m.date ? new Date(m.date).toLocaleString() : ''}</div>
                  <div style={{ color: 'var(--gray-700)', marginTop: '.2rem' }}>{m.text.slice(0, 160)}{m.text.length > 160 ? '...' : ''}</div>
                  <button className="btn btn-secondary btn-sm" style={{ marginTop: '.3rem' }} onClick={() => send(`Read the email "${m.subject}" from ${m.from}. Summarize it, tell me what I need to do, and draft a reply if one is needed.`)}>Ask assistant about this</button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { CareTeamTab, SetupWizard, TasksTab, AssistantTab });
})();
