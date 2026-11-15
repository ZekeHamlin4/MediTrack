// Supplies, scan log and dashboard (moved from index.js in M3).
// Mounted at /api/patients/:pid after the membership check, which sets req.patientId and req.user.
const express = require('express');
const db = require('./db');

const router = express.Router();
const wrap = fn => (req, res) => {
  try { fn(req, res); }
  catch (e) {
    if (String(e.code).startsWith('SQLITE_CONSTRAINT') && /barcode/.test(e.message)) return res.status(409).json({ error: 'Another supply already uses that barcode.' });
    res.status(e.status || 500).json({ error: e.status ? e.message : 'Something went wrong' });
  }
};
const getSupply = (pid, id) => db.prepare('SELECT * FROM supplies WHERE id = ? AND patient_id = ?').get(id, pid);

router.get('/supplies', wrap((req, res) => {
  const { category, search, low_stock } = req.query;
  let sql = 'SELECT * FROM supplies';
  const conditions = ['patient_id = ?'], params = [req.patientId];
  if (category) { conditions.push('category = ?'); params.push(category); }
  if (search) { conditions.push('(name LIKE ? OR description LIKE ? OR barcode LIKE ?)'); const t = '%' + search + '%'; params.push(t, t, t); }
  if (low_stock === '1') conditions.push('quantity <= low_stock_threshold');
  sql += ' WHERE ' + conditions.join(' AND ') + ' ORDER BY category, name';
  res.json(db.prepare(sql).all(...params));
}));
router.get('/supplies/categories', wrap((req, res) => {
  res.json(db.prepare('SELECT DISTINCT category FROM supplies WHERE patient_id = ? ORDER BY category').all(req.patientId).map(r => r.category));
}));
router.get('/supplies/barcode/:code', wrap((req, res) => {
  const row = db.prepare('SELECT * FROM supplies WHERE patient_id = ? AND (barcode = ? OR qr_code = ?)').get(req.patientId, req.params.code, req.params.code);
  if (!row) return res.status(404).json({ error: 'Supply not found' });
  res.json(row);
}));
router.get('/supplies/:id', wrap((req, res) => {
  const row = getSupply(req.patientId, req.params.id);
  if (!row) return res.status(404).json({ error: 'Supply not found' });
  res.json(row);
}));
router.post('/supplies', wrap((req, res) => {
  const { name, category, description, quantity, unit, barcode, qr_code, low_stock_threshold } = req.body || {};
  if (!name || !category) return res.status(400).json({ error: 'name and category required' });
  const r = db.prepare('INSERT INTO supplies (name,category,description,quantity,unit,barcode,qr_code,low_stock_threshold,patient_id) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(name, category, description || null, quantity || 0, unit || 'each', barcode || null, qr_code || null, low_stock_threshold || 5, req.patientId);
  res.status(201).json(getSupply(req.patientId, r.lastInsertRowid));
}));
router.put('/supplies/:id', wrap((req, res) => {
  const { name, category, description, quantity, unit, barcode, qr_code, low_stock_threshold } = req.body || {};
  const e = getSupply(req.patientId, req.params.id);
  if (!e) return res.status(404).json({ error: 'Supply not found' });
  db.prepare('UPDATE supplies SET name=?,category=?,description=?,quantity=?,unit=?,barcode=?,qr_code=?,low_stock_threshold=?,version=version+1,updated_at=CURRENT_TIMESTAMP WHERE id=? AND patient_id=?')
    .run(name ?? e.name, category ?? e.category, description ?? e.description, quantity ?? e.quantity, unit ?? e.unit, barcode ?? e.barcode, qr_code ?? e.qr_code, low_stock_threshold ?? e.low_stock_threshold, e.id, req.patientId);
  res.json(getSupply(req.patientId, e.id));
}));
router.delete('/supplies/:id', wrap((req, res) => {
  const r = db.prepare('DELETE FROM supplies WHERE id = ? AND patient_id = ?').run(req.params.id, req.patientId);
  if (r.changes === 0) return res.status(404).json({ error: 'Supply not found' });
  res.json({ success: true });
}));
// "Logged by" is always the signed-in person (no picking someone else).
router.post('/supplies/scan', wrap((req, res) => {
  const { supply_id, action, quantity, notes } = req.body || {};
  if (!supply_id || !action) return res.status(400).json({ error: 'supply_id and action required' });
  if (!['add', 'remove', 'check'].includes(action)) return res.status(400).json({ error: 'Invalid action' });
  const supply = getSupply(req.patientId, supply_id);
  if (!supply) return res.status(404).json({ error: 'Supply not found' });
  const qty = parseInt(quantity) || 1;
  if (action === 'add') db.prepare('UPDATE supplies SET quantity=quantity+?,version=version+1,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(qty, supply.id);
  else if (action === 'remove') db.prepare('UPDATE supplies SET quantity=MAX(0,quantity-?),version=version+1,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(qty, supply.id);
  db.prepare('INSERT INTO scan_log (supply_id,user_id,action,quantity,notes,patient_id) VALUES (?,?,?,?,?,?)').run(supply.id, req.user.id, action, qty, notes || null, req.patientId);
  res.json({ supply: getSupply(req.patientId, supply.id), logged: true });
}));
router.get('/scan-log', wrap((req, res) => {
  const { limit = 100, supply_id } = req.query;
  let sql = 'SELECT sl.*,s.name as supply_name,s.category,u.name as user_name FROM scan_log sl LEFT JOIN supplies s ON sl.supply_id=s.id LEFT JOIN users u ON sl.user_id=u.id WHERE sl.patient_id = ?';
  const params = [req.patientId];
  if (supply_id) { sql += ' AND sl.supply_id=?'; params.push(supply_id); }
  sql += ' ORDER BY sl.scanned_at DESC LIMIT ?'; params.push(Math.min(parseInt(limit) || 100, 1000));
  res.json(db.prepare(sql).all(...params));
}));
router.get('/dashboard', wrap((req, res) => {
  const pid = req.patientId;
  const totalSupplies = db.prepare('SELECT COUNT(*) as c FROM supplies WHERE patient_id=?').get(pid).c;
  const lowStockCount = db.prepare('SELECT COUNT(*) as c FROM supplies WHERE patient_id=? AND quantity<=low_stock_threshold').get(pid).c;
  const totalItems = db.prepare('SELECT SUM(quantity) as s FROM supplies WHERE patient_id=?').get(pid).s || 0;
  const categoryBreakdown = db.prepare('SELECT category,COUNT(*) as count,SUM(quantity) as total_qty FROM supplies WHERE patient_id=? GROUP BY category ORDER BY category').all(pid);
  const recentScans = db.prepare('SELECT sl.*,s.name as supply_name,u.name as user_name FROM scan_log sl LEFT JOIN supplies s ON sl.supply_id=s.id LEFT JOIN users u ON sl.user_id=u.id WHERE sl.patient_id=? ORDER BY sl.scanned_at DESC LIMIT 10').all(pid);
  const lowStockItems = db.prepare('SELECT * FROM supplies WHERE patient_id=? AND quantity<=low_stock_threshold ORDER BY (quantity*1.0/low_stock_threshold) ASC').all(pid);
  res.json({ totalSupplies, lowStockCount, totalItems, categoryBreakdown, recentScans, lowStockItems });
}));

module.exports = { patientRouter: router };
