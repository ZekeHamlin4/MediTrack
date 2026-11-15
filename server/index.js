const fs = require('fs');
const envPath = require('path').join(__dirname, '.env');
if (fs.existsSync(envPath)) process.loadEnvFile(envPath);
const express = require('express');
const path = require('path');
const cors = require('cors');
const db = require('./db');
const macos = require('./macos');
const app = express();
const PORT = process.env.PORT || 3000;
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../client')));
app.get('/api/supplies', (req, res) => {
  const { category, search, low_stock } = req.query;
  let sql = 'SELECT * FROM supplies';
  const conditions = [], params = [];
  if (category) { conditions.push('category = ?'); params.push(category); }
  if (search) { conditions.push('(name LIKE ? OR description LIKE ? OR barcode LIKE ?)'); const t = '%'+search+'%'; params.push(t,t,t); }
  if (low_stock === '1') conditions.push('quantity <= low_stock_threshold');
  if (conditions.length) sql += ' WHERE ' + conditions.join(' AND ');
  sql += ' ORDER BY category, name';
  try { res.json(db.prepare(sql).all(...params)); } catch(e) { res.status(500).json({error:e.message}); }
});
app.get('/api/supplies/categories', (req, res) => {
  try { res.json(db.prepare('SELECT DISTINCT category FROM supplies ORDER BY category').all().map(r=>r.category)); } catch(e) { res.status(500).json({error:e.message}); }
});
app.get('/api/supplies/barcode/:code', (req, res) => {
  try {
    const row = db.prepare('SELECT * FROM supplies WHERE barcode = ? OR qr_code = ?').get(req.params.code, req.params.code);
    if (!row) return res.status(404).json({error:'Supply not found'});
    res.json(row);
  } catch(e) { res.status(500).json({error:e.message}); }
});
app.get('/api/supplies/:id', (req, res) => {
  try {
    const row = db.prepare('SELECT * FROM supplies WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({error:'Supply not found'});
    res.json(row);
  } catch(e) { res.status(500).json({error:e.message}); }
});
app.post('/api/supplies', (req, res) => {
  const { name, category, description, quantity, unit, barcode, qr_code, low_stock_threshold } = req.body;
  if (!name || !category) return res.status(400).json({error:'name and category required'});
  try {
    const result = db.prepare('INSERT INTO supplies (name,category,description,quantity,unit,barcode,qr_code,low_stock_threshold,patient_id) VALUES (?,?,?,?,?,?,?,?,?)').run(name,category,description||null,quantity||0,unit||'each',barcode||null,qr_code||null,low_stock_threshold||5,db.currentPatientId());
    res.status(201).json(db.prepare('SELECT * FROM supplies WHERE id = ?').get(result.lastInsertRowid));
  } catch(e) { res.status(500).json({error:e.message}); }
});
app.put('/api/supplies/:id', (req, res) => {
  const { name, category, description, quantity, unit, barcode, qr_code, low_stock_threshold } = req.body;
  try {
    const e = db.prepare('SELECT * FROM supplies WHERE id = ?').get(req.params.id);
    if (!e) return res.status(404).json({error:'Supply not found'});
    db.prepare('UPDATE supplies SET name=?,category=?,description=?,quantity=?,unit=?,barcode=?,qr_code=?,low_stock_threshold=?,version=version+1,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(name??e.name,category??e.category,description??e.description,quantity??e.quantity,unit??e.unit,barcode??e.barcode,qr_code??e.qr_code,low_stock_threshold??e.low_stock_threshold,req.params.id);
    res.json(db.prepare('SELECT * FROM supplies WHERE id = ?').get(req.params.id));
  } catch(e) { res.status(500).json({error:e.message}); }
});
app.delete('/api/supplies/:id', (req, res) => {
  try {
    const result = db.prepare('DELETE FROM supplies WHERE id = ?').run(req.params.id);
    if (result.changes === 0) return res.status(404).json({error:'Supply not found'});
    res.json({success:true});
  } catch(e) { res.status(500).json({error:e.message}); }
});
app.post('/api/supplies/scan', (req, res) => {
  const { supply_id, user_id, action, quantity, notes } = req.body;
  if (!supply_id || !action) return res.status(400).json({error:'supply_id and action required'});
  if (!['add','remove','check'].includes(action)) return res.status(400).json({error:'Invalid action'});
  try {
    const supply = db.prepare('SELECT * FROM supplies WHERE id = ?').get(supply_id);
    if (!supply) return res.status(404).json({error:'Supply not found'});
    const qty = parseInt(quantity)||1;
    if (action==='add') db.prepare('UPDATE supplies SET quantity=quantity+?,version=version+1,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(qty,supply_id);
    else if (action==='remove') db.prepare('UPDATE supplies SET quantity=MAX(0,quantity-?),version=version+1,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(qty,supply_id);
    db.prepare('INSERT INTO scan_log (supply_id,user_id,action,quantity,notes,patient_id) VALUES (?,?,?,?,?,?)').run(supply_id,user_id||null,action,qty,notes||null,supply.patient_id);
    res.json({supply:db.prepare('SELECT * FROM supplies WHERE id = ?').get(supply_id),logged:true});
  } catch(e) { res.status(500).json({error:e.message}); }
});
app.get('/api/users', (req, res) => {
  try { res.json(db.prepare('SELECT id,name,email,role,created_at FROM users WHERE active=1 ORDER BY role,name').all()); } catch(e) { res.status(500).json({error:e.message}); }
});
app.post('/api/users', (req, res) => {
  // PINs are no longer stored here (they were plain text). Sign-in comes in step M2.
  const { name, email, role } = req.body;
  if (!name || !role) return res.status(400).json({error:'name and role required'});
  try {
    const result = db.prepare('INSERT INTO users (name,email,role,org_id) VALUES (?,?,?,(SELECT MIN(id) FROM organizations))').run(name,email||null,role);
    res.status(201).json(db.prepare('SELECT id,name,email,role,created_at FROM users WHERE id=?').get(result.lastInsertRowid));
  } catch(e) { res.status(500).json({error:e.message}); }
});
app.delete('/api/users/:id', (req, res) => {
  try {
    const result = db.prepare('DELETE FROM users WHERE id=?').run(req.params.id);
    if (result.changes===0) return res.status(404).json({error:'User not found'});
    res.json({success:true});
  } catch(e) { res.status(500).json({error:e.message}); }
});
app.get('/api/scan-log', (req, res) => {
  const { limit=100, supply_id } = req.query;
  try {
    let sql = 'SELECT sl.*,s.name as supply_name,s.category,u.name as user_name FROM scan_log sl LEFT JOIN supplies s ON sl.supply_id=s.id LEFT JOIN users u ON sl.user_id=u.id';
    const params = [];
    if (supply_id) { sql+=' WHERE sl.supply_id=?'; params.push(supply_id); }
    sql+=' ORDER BY sl.scanned_at DESC LIMIT ?'; params.push(parseInt(limit));
    res.json(db.prepare(sql).all(...params));
  } catch(e) { res.status(500).json({error:e.message}); }
});
app.get('/api/dashboard', (req, res) => {
  try {
    const totalSupplies = db.prepare('SELECT COUNT(*) as c FROM supplies').get().c;
    const lowStockCount = db.prepare('SELECT COUNT(*) as c FROM supplies WHERE quantity<=low_stock_threshold').get().c;
    const totalItems = db.prepare('SELECT SUM(quantity) as s FROM supplies').get().s||0;
    const categoryBreakdown = db.prepare('SELECT category,COUNT(*) as count,SUM(quantity) as total_qty FROM supplies GROUP BY category ORDER BY category').all();
    const recentScans = db.prepare('SELECT sl.*,s.name as supply_name,u.name as user_name FROM scan_log sl LEFT JOIN supplies s ON sl.supply_id=s.id LEFT JOIN users u ON sl.user_id=u.id ORDER BY sl.scanned_at DESC LIMIT 10').all();
    const lowStockItems = db.prepare('SELECT * FROM supplies WHERE quantity<=low_stock_threshold ORDER BY (quantity*1.0/low_stock_threshold) ASC').all();
    res.json({totalSupplies,lowStockCount,totalItems,categoryBreakdown,recentScans,lowStockItems});
  } catch(e) { res.status(500).json({error:e.message}); }
});
app.use('/api', require('./care').router);
app.use('/api', require('./email').router);
app.use('/api', require('./assistant').router);
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../client/index.html'));
});
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
