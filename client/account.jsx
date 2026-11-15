// Sign-in, first-run setup, My account and Settings → People (M2 + M3).
(function () {
const { useState, useEffect } = React;

// Patient data lives under /api/patients/<id>/… Phase 1a has one patient, chosen automatically.
window.MT = window.MT || { pid: null };
const PATIENT_PATHS = ['supplies', 'scan-log', 'dashboard', 'profile', 'providers', 'tasks', 'outbox'];
window.mtPath = function (p) {
  const m = /^\/api\/([a-z-]+)(.*)$/.exec(p);
  if (m && PATIENT_PATHS.includes(m[1]) && window.MT.pid) return '/api/patients/' + window.MT.pid + '/' + m[1] + m[2];
  return p;
};
// Signed out (or must choose a new password): start again from the top.
window.mtCheckAuth = function (r, data) {
  if (r.status === 401 || (r.status === 403 && data && data.must_change_password)) { window.location.reload(); return false; }
  return true;
};

const http = async (method, path, body) => {
  const r = await fetch(path, { method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(data.error || ('Request failed (' + r.status + ')')); e.status = r.status; e.data = data; throw e; }
  return data;
};

const TRUST_NOTE = name => `Everyone you add can see and do everything for ${name || 'your child'}: medical information, insurance numbers, documents and the care email. Only add people you trust with all of it.`;
const big = { fontSize: '16px', padding: '.75rem .9rem' };
const fmt = d => { if (!d) return ''; const t = new Date(/Z$|[+-]\d\d:\d\d$/.test(d) ? d : d.replace(' ', 'T') + 'Z'); return t.toLocaleString(); };

function Field({ label, value, onChange, type = 'text', autoComplete, placeholder }) {
  return (
    <div className="form-group" style={{ marginBottom: '.75rem' }}>
      <label>{label}</label>
      <input style={big} type={type} value={value} autoComplete={autoComplete} placeholder={placeholder} onChange={e => onChange(e.target.value)} />
    </div>
  );
}

function Panel({ title, children }) {
  return (
    <div className="card" style={{ maxWidth: 460, margin: '2rem auto' }}>
      <div className="portal-header" style={{ marginBottom: '1rem' }}><h2>{title}</h2></div>
      {children}
    </div>
  );
}

/* ---------- Sign in ---------- */
function SignIn({ onDone }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async e => {
    e.preventDefault(); setBusy(true); setErr('');
    try { await http('POST', '/api/auth/login', { email, password }); onDone(); }
    catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  return (
    <Panel title="Sign in to MediTrack">
      <form onSubmit={submit}>
        <Field label="Email" type="email" autoComplete="username" value={email} onChange={setEmail} />
        <Field label="Password" type="password" autoComplete="current-password" value={password} onChange={setPassword} />
        {err && <div className="alert alert-error">{err}</div>}
        <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center', ...big }} disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
      <p style={{ fontSize: '.85rem', color: 'var(--gray-700)', marginTop: '1rem' }}>
        Forgot your password? Ask the person who runs MediTrack at home to set a temporary one for you.
      </p>
    </Panel>
  );
}

/* ---------- Choose a new password ---------- */
function ChangePassword({ forced, onDone }) {
  const [current, setCurrent] = useState('');
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');
  const submit = async e => {
    e.preventDefault(); setErr(''); setOk('');
    if (password !== again) return setErr('The two new passwords are not the same.');
    try { await http('POST', '/api/auth/password', { current, password }); setCurrent(''); setPassword(''); setAgain(''); setOk('Password changed. Your other devices were signed out.'); onDone && onDone(); }
    catch (x) { setErr(x.message); }
  };
  const form = (
    <form onSubmit={submit}>
      {forced && <p style={{ marginBottom: '.75rem', fontSize: '.9rem' }}>You signed in with a temporary password. Please choose your own (at least 10 characters).</p>}
      <Field label={forced ? 'Temporary password' : 'Current password'} type="password" autoComplete="current-password" value={current} onChange={setCurrent} />
      <Field label="New password (at least 10 characters)" type="password" autoComplete="new-password" value={password} onChange={setPassword} />
      <Field label="New password again" type="password" autoComplete="new-password" value={again} onChange={setAgain} />
      {err && <div className="alert alert-error">{err}</div>}
      {ok && <div className="alert alert-success">{ok}</div>}
      <button className="btn btn-primary" style={big}>Save new password</button>
    </form>
  );
  return forced ? <Panel title="Choose your password">{form}</Panel> : form;
}

/* ---------- First run (on the Mac) ---------- */
function FirstRun({ onDone }) {
  const [step, setStep] = useState('account');
  const [f, setF] = useState({ code: '', name: '', title: '', email: '', password: '', again: '', over18: false });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [patient, setPatient] = useState(null);
  const set = k => v => setF(x => ({ ...x, [k]: v }));

  const createAccount = async e => {
    e.preventDefault(); setErr('');
    if (f.password !== f.again) return setErr('The two passwords are not the same.');
    setBusy(true);
    try {
      const r = await http('POST', '/api/setup', f);
      const p = r.patients[0] || null;
      if (p) { window.MT.pid = p.id; setPatient(p); }
      setStep('awake');
    } catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  // After the checklist: an upgraded install confirms the child's name and birth date; a new one goes to the setup wizard.
  const afterChecklist = () => (patient && patient.onboarded ? setStep('child') : onDone());

  if (step === 'account') return (
    <Panel title="Welcome to MediTrack">
      <form onSubmit={createAccount}>
        <p style={{ fontSize: '.9rem', marginBottom: '.75rem' }}>
          First, create your account. You'll be the <strong>home admin</strong>: you add the other people who use MediTrack.
        </p>
        <Field label="Setup code (shown on this Mac in a notification and in the MediTrack window or log)" value={f.code} onChange={set('code')} placeholder="1234-5678" />
        <Field label="Your name" value={f.name} onChange={set('name')} autoComplete="name" />
        <Field label="Title (shown to others, e.g. Mom, Dad)" value={f.title} onChange={set('title')} />
        <Field label="Email" type="email" value={f.email} onChange={set('email')} autoComplete="username" />
        <Field label="Password (at least 10 characters)" type="password" value={f.password} onChange={set('password')} autoComplete="new-password" />
        <Field label="Password again" type="password" value={f.again} onChange={set('again')} autoComplete="new-password" />
        <label style={{ display: 'flex', gap: '.5rem', alignItems: 'center', fontSize: '.9rem', marginBottom: '.75rem' }}>
          <input type="checkbox" style={{ width: 22, height: 22 }} checked={f.over18} onChange={e => set('over18')(e.target.checked)} /> I am 18 or older
        </label>
        {err && <div className="alert alert-error">{err}</div>}
        <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center', ...big }} disabled={busy}>{busy ? 'Creating…' : 'Create my account'}</button>
      </form>
    </Panel>
  );

  if (step === 'awake') return (
    <Panel title="Keep this Mac awake">
      <p style={{ fontSize: '.9rem', marginBottom: '.5rem' }}>MediTrack only works for your phones while this Mac is on, awake and logged in.</p>
      <ul style={{ marginLeft: '1.2rem', lineHeight: 1.7, fontSize: '.9rem' }}>
        <li><strong>MacBook:</strong> System Settings → Battery → Options… → turn on "Prevent automatic sleeping on power adapter when the display is off".</li>
        <li><strong>iMac / Mac mini:</strong> System Settings → Energy → turn on "Prevent automatic sleeping when the display is off" and "Start up automatically after a power failure".</li>
        <li>MacBook: keep the <strong>lid open</strong> and the <strong>charger plugged in</strong>.</li>
        <li>After the Mac restarts, <strong>log in once</strong> so MediTrack comes back.</li>
      </ul>
      <button className="btn btn-primary" style={{ marginTop: '1rem', ...big }} onClick={afterChecklist}>Done</button>
    </Panel>
  );

  return <ConfirmChild pid={patient.id} onDone={onDone} />;
}

function ConfirmChild({ pid, onDone }) {
  const [p, setP] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => { http('GET', '/api/patients/' + pid + '/profile').then(setP).catch(x => setErr(x.message)); }, [pid]);
  if (!p) return err ? <div className="alert alert-error">{err}</div> : <div className="loading"><div className="spinner" />Loading...</div>;
  const set = k => v => setP(x => ({ ...x, [k]: v }));
  const save = async () => {
    try { await http('PUT', '/api/patients/' + pid + '/profile', { first_name: p.first_name, last_name: p.last_name, dob: p.dob }); onDone(); }
    catch (x) { setErr(x.message); }
  };
  return (
    <Panel title="Check your child's details">
      <p style={{ fontSize: '.9rem', marginBottom: '.75rem' }}>We moved your child's profile into the new format. Please check the name is split correctly and the birth date is right.</p>
      <Field label="First name" value={p.first_name || ''} onChange={set('first_name')} />
      <Field label="Last name" value={p.last_name || ''} onChange={set('last_name')} />
      <Field label="Date of birth" type="date" value={p.dob || ''} onChange={set('dob')} />
      {err && <div className="alert alert-error">{err}</div>}
      <button className="btn btn-primary" style={big} onClick={save}>Looks right</button>
    </Panel>
  );
}

/* ---------- My account ---------- */
function AccountTab({ me, showAlert }) {
  const [devices, setDevices] = useState(null);
  const load = () => http('GET', '/api/auth/sessions').then(setDevices).catch(() => setDevices([]));
  useEffect(() => { load(); }, []);
  const signOutDevice = async d => { await http('DELETE', '/api/auth/sessions/' + d.id); showAlert('success', d.device_name + ' signed out'); load(); };
  return (
    <div>
      <div className="section-title">My account</div>
      <div className="card">
        <div style={{ fontWeight: 700 }}>{me.user.name}{me.user.title ? ' (' + me.user.title + ')' : ''}</div>
        <div style={{ fontSize: '.85rem', color: 'var(--gray-700)' }}>{me.user.email}{me.user.is_home_admin ? ' · Home admin' : ''}</div>
        <button className="btn btn-secondary" style={{ marginTop: '.75rem', ...big }} onClick={signOut}>Sign out</button>
      </div>
      <div className="card">
        <div className="card-title">Signed-in devices</div>
        {!devices ? <div className="loading"><div className="spinner" /></div> : devices.map(d => (
          <div key={d.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '.5rem 0', borderBottom: '1px solid var(--gray-200)' }}>
            <div><strong>{d.device_name}</strong><div style={{ fontSize: '.78rem', color: 'var(--gray-700)' }}>Last used {fmt(d.last_seen_at)}</div></div>
            {d.current ? <span className="badge badge-green">This device</span> : <button className="btn btn-secondary btn-sm" onClick={() => signOutDevice(d)}>Sign out</button>}
          </div>
        ))}
      </div>
      <div className="card"><div className="card-title">Change password</div><ChangePassword onDone={load} /></div>
    </div>
  );
}

async function signOut() {
  await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
  window.location.reload();
}

/* ---------- Settings → People (home admin) ---------- */
function SettingsTab({ me, showAlert }) {
  const [people, setPeople] = useState(null);
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState({ name: '', title: '', email: '', password: '' });
  const [err, setErr] = useState('');
  const childName = (me.patients[0] && me.patients[0].first_name) || 'your child';
  const load = () => http('GET', '/api/admin/users').then(setPeople).catch(x => showAlert('error', x.message));
  useEffect(() => { load(); }, []);
  const set = k => v => setF(x => ({ ...x, [k]: v }));
  const act = async (u, what, body, msg) => {
    try { await http('POST', '/api/admin/users/' + u.id + '/' + what, body); showAlert('success', msg); load(); }
    catch (x) { showAlert('error', x.message); }
  };
  const add = async e => {
    e.preventDefault(); setErr('');
    try { await http('POST', '/api/admin/users', f); showAlert('success', f.name + ' added. Give them their email and temporary password.'); setF({ name: '', title: '', email: '', password: '' }); setAdding(false); load(); }
    catch (x) { setErr(x.message); }
  };
  const tempPw = u => {
    const pw = window.prompt('New temporary password for ' + u.name + ' (at least 10 characters). They will choose their own when they sign in.');
    if (pw) act(u, 'temp-password', { password: pw }, 'Temporary password set for ' + u.name);
  };
  return (
    <div>
      <div className="section-title">Settings</div>
      <div className="card">
        <div className="card-title" style={{ justifyContent: 'space-between' }}>People
          {!adding && <button className="btn btn-primary btn-sm" onClick={() => setAdding(true)}>+ Add person</button>}
        </div>
        {adding && (
          <form onSubmit={add} style={{ marginBottom: '1rem' }}>
            <div className="alert alert-warning" style={{ display: 'block' }}>{TRUST_NOTE(childName)}</div>
            <Field label="Name" value={f.name} onChange={set('name')} />
            <Field label="Title (e.g. Nurse, Grandma)" value={f.title} onChange={set('title')} />
            <Field label="Email" type="email" value={f.email} onChange={set('email')} />
            <Field label="Temporary password (at least 10 characters)" value={f.password} onChange={set('password')} />
            {err && <div className="alert alert-error">{err}</div>}
            <div style={{ display: 'flex', gap: '.5rem' }}>
              <button className="btn btn-primary" style={big}>Add person</button>
              <button type="button" className="btn btn-secondary" style={big} onClick={() => { setAdding(false); setErr(''); }}>Cancel</button>
            </div>
          </form>
        )}
        {!people ? <div className="loading"><div className="spinner" /></div> : people.map(u => (
          <div key={u.id} style={{ padding: '.6rem 0', borderBottom: '1px solid var(--gray-200)' }}>
            <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
              <strong>{u.name}{u.title ? ' (' + u.title + ')' : ''}</strong>
              {u.is_home_admin && <span className="badge badge-blue">Home admin</span>}
              {!u.active && <span className="badge badge-gray">Turned off</span>}
              {u.locked && <span className="badge badge-red">Locked (too many wrong passwords)</span>}
              {u.must_change_password && u.active && <span className="badge badge-orange">Has a temporary password</span>}
            </div>
            <div style={{ fontSize: '.8rem', color: 'var(--gray-700)' }}>{u.email}{u.last_login_at ? ' · last sign-in ' + fmt(u.last_login_at) : ' · never signed in'}</div>
            <div style={{ display: 'flex', gap: '.4rem', flexWrap: 'wrap', marginTop: '.4rem' }}>
              {u.locked && <button className="btn btn-success btn-sm" onClick={() => act(u, 'unlock', {}, u.name + ' unlocked')}>Unlock</button>}
              {u.active && <button className="btn btn-secondary btn-sm" onClick={() => tempPw(u)}>Set temporary password</button>}
              {u.id !== me.user.id && (u.active
                ? <button className="btn btn-danger btn-sm" onClick={() => { if (confirm('Turn off ' + u.name + '? They will be signed out everywhere.')) act(u, 'deactivate', {}, u.name + ' turned off'); }}>Turn off</button>
                : <button className="btn btn-secondary btn-sm" onClick={() => act(u, 'reactivate', {}, u.name + ' turned back on')}>Turn back on</button>)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

Object.assign(window, { SignIn, FirstRun, ChangePassword, AccountTab, SettingsTab, mtSignOut: signOut });
})();
