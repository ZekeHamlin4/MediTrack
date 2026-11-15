const Database = require('better-sqlite3');
const path = require('path');
const db = new Database(path.join(__dirname, 'meditrack.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT UNIQUE,
    role TEXT NOT NULL DEFAULT 'nurse' CHECK(role IN ('family','nurse','doctor','admin')),
    pin_hash TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS supplies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    description TEXT,
    quantity INTEGER NOT NULL DEFAULT 0,
    unit TEXT NOT NULL DEFAULT 'each',
    barcode TEXT UNIQUE,
    qr_code TEXT,
    low_stock_threshold INTEGER NOT NULL DEFAULT 5,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS scan_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    supply_id INTEGER REFERENCES supplies(id),
    user_id INTEGER REFERENCES users(id),
    action TEXT NOT NULL CHECK(action IN ('add','remove','check')),
    quantity INTEGER NOT NULL DEFAULT 1,
    notes TEXT,
    scanned_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);
const seedUsers = () => {
  if (db.prepare('SELECT COUNT(*) as c FROM users').get().c > 0) return;
  const ins = db.prepare('INSERT INTO users (name,email,role,pin_hash) VALUES (?,?,?,?)');
  ins.run('Admin User','admin@meditrack.local','admin','0000');
  ins.run('Parent / Family','family@meditrack.local','family','1234');
  ins.run('Day Nurse','daynurse@meditrack.local','nurse','5678');
  ins.run('Night Nurse','nightnurse@meditrack.local','nurse','9012');
  ins.run('Pediatric Doctor','doctor@meditrack.local','doctor','3456');
};
const seedSupplies = () => {
  if (db.prepare('SELECT COUNT(*) as c FROM supplies').get().c > 0) return;
  const ins = db.prepare('INSERT INTO supplies (name,category,description,quantity,unit,barcode,low_stock_threshold) VALUES (?,?,?,?,?,?,?)');
  const data = [
    ['Trach Tube - Bivona 4.0 Pedi','Trach & Airway','Bivona FlexTend pediatric trach tube 4.0mm',5,'each','BIVONA-40-PEDI',2],
    ['Trach Tube - Shiley 4 Pedi','Trach & Airway','Shiley pediatric cuffless trach tube size 4',3,'each','SHILEY-4-PEDI',2],
    ['Trach Ties Velcro','Trach & Airway','Dale trach tube holder adjustable velcro',10,'each','TRACH-TIES-VEL',3],
    ['Suction Catheter 8Fr','Trach & Airway','Flexible suction catheter 8 French sterile',60,'each','SUC-CATH-8FR',15],
    ['Suction Catheter 10Fr','Trach & Airway','Flexible suction catheter 10 French sterile',40,'each','SUC-CATH-10FR',10],
    ['HME Heat Moisture Exchanger','Trach & Airway','Thermovent T HME with speaking valve option',20,'each','HME-THERMOVENT',5],
    ['Trach Care Kit','Trach & Airway','Complete tracheostomy care kit',15,'kit','TRACH-CARE-KIT',5],
    ['Yankauer Suction Tip','Trach & Airway','Rigid oral suction tip Yankauer style',12,'each','YANKAUER-TIP',4],
    ['Ventilator Circuit Pediatric','Ventilator','Single-limb vent circuit pediatric size',4,'each','VENT-CIRCUIT-PEDI',2],
    ['Ambu Bag BVM Pediatric','Ventilator','Pediatric bag-valve-mask with PEEP valve',2,'each','AMBU-PEDI-BVM',1],
    ['Oxygen Tubing','Ventilator','Standard oxygen supply tubing 7ft',8,'each','O2-TUBING-7FT',3],
    ['Inline Suction Catheter','Ventilator','Closed inline suction catheter 8Fr',6,'each','INLINE-SUCTION-8FR',2],
    ['Ventilator Filter','Ventilator','Bacterial/viral filter for vent circuit',10,'each','VENT-FILTER-BV',3],
    ['G-Tube MIC-KEY 14Fr 1.5cm','G-Tube & Feeding','MIC-KEY low-profile gastrostomy button',3,'each','MICKEY-14-15',1],
    ['G-Tube Extension Set Bolus','G-Tube & Feeding','MIC-KEY right angle bolus extension set',20,'each','MICKEY-EXT-BOLUS',5],
    ['G-Tube Extension Set Continuous','G-Tube & Feeding','MIC-KEY continuous feed extension set',10,'each','MICKEY-EXT-CONT',3],
    ['Feeding Bag 500mL','G-Tube & Feeding','Gravity/pump feeding bag 500mL with tubing',30,'each','FEED-BAG-500ML',10],
    ['Enteral Syringe 60mL','G-Tube & Feeding','60mL ENFit enteral syringe for bolus feeds',25,'each','ENT-SYR-60ML',8],
    ['Formula Pediasure 1.0 8oz','G-Tube & Feeding','Pediasure 1.0 cal/mL pediatric formula',48,'can','PEDIASURE-10-8OZ',12],
    ['Wheelchair Cushion Cover','Wheelchair & Mobility','Replacement cover for tilt-in-space cushion',4,'each','WC-CUSHION-COVER',2],
    ['Positioning Wedge','Wheelchair & Mobility','Foam positioning wedge for wheelchair seating',2,'each','POSITION-WEDGE',1],
    ['Transfer Belt Gait Belt','Wheelchair & Mobility','Transfer gait belt 60 inch adjustable',3,'each','GAIT-BELT-60',1],
    ['Gauze 2x2 Sterile','Wound Care','Sterile 2x2 gauze pads 12-ply',100,'each','GAUZE-2X2-STERILE',20],
    ['Gauze 4x4 Sterile','Wound Care','Sterile 4x4 gauze pads 12-ply',60,'each','GAUZE-4X4-STERILE',15],
    ['Medical Tape Silk 1in','Wound Care','Cloth silk medical tape 1in x 10yd',10,'roll','MED-TAPE-SILK-1IN',3],
    ['Bacitracin Ointment','Wound Care','Antibiotic ointment for trach/stoma site',5,'tube','BACITRACIN-OZ',2],
    ['Gloves Nitrile Small','General Nursing','Nitrile exam gloves powder-free small',200,'each','GLOVES-NITRILE-S',50],
    ['Gloves Nitrile Medium','General Nursing','Nitrile exam gloves powder-free medium',200,'each','GLOVES-NITRILE-M',50],
    ['Gloves Nitrile Large','General Nursing','Nitrile exam gloves powder-free large',150,'each','GLOVES-NITRILE-L',50],
    ['Pulse Oximeter Probe Pedi','General Nursing','Pediatric reusable SpO2 probe wrap-style',10,'each','PULSEOX-PROBE-PEDI',3],
    ['Normal Saline Flush 10mL','General Nursing','Sterile normal saline 0.9% flush 10mL',50,'each','NS-FLUSH-10ML',15],
    ['Alcohol Prep Pads','General Nursing','Sterile isopropyl alcohol prep pads',200,'each','ALCO-PREP-PAD',50],
    ['Albuterol Nebulizer 2.5mg','Medications','Albuterol sulfate 2.5mg/3mL unit dose',30,'vial','ALBUTEROL-25MG',10],
    ['Hypertonic Saline 7% 4mL','Medications','Sodium chloride 7% inhalation solution',20,'vial','HYPER-SAL-7PCT',6],
    ['Normal Saline Nebulizer 3mL','Medications','Sterile 0.9% sodium chloride for nebulization',30,'vial','NS-NEB-3ML',10],
  ];
  db.transaction(items => { for (const i of items) ins.run(...i); })(data);
};
db.exec(`
  CREATE TABLE IF NOT EXISTS patient_profile (
    id INTEGER PRIMARY KEY CHECK(id = 1),
    child_name TEXT, dob TEXT, parent_name TEXT, parent_phone TEXT, parent_email TEXT,
    address TEXT, city TEXT, state TEXT, zip TEXT,
    insurance_name TEXT, insurance_member_id TEXT, medicaid_id TEXT,
    diagnoses TEXT, equipment TEXT, notes TEXT,
    onboarded INTEGER NOT NULL DEFAULT 0,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  INSERT OR IGNORE INTO patient_profile (id) VALUES (1);
  CREATE TABLE IF NOT EXISTS providers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'other',
    specialty TEXT, contact_person TEXT,
    phone TEXT, fax TEXT, email TEXT, website TEXT, portal_url TEXT,
    address TEXT, city TEXT, state TEXT, zip TEXT,
    npi TEXT, account_number TEXT,
    departments TEXT NOT NULL DEFAULT '[]',
    tips TEXT, notes TEXT,
    favorite INTEGER NOT NULL DEFAULT 0,
    source TEXT NOT NULL DEFAULT 'manual',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL, description TEXT,
    provider_id INTEGER REFERENCES providers(id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','in_progress','waiting','done')),
    due_date TEXT,
    steps TEXT NOT NULL DEFAULT '[]',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS outbox (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    provider_id INTEGER REFERENCES providers(id) ON DELETE SET NULL,
    task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
    to_email TEXT, subject TEXT NOT NULL, body TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','sent','failed')),
    error TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    sent_at DATETIME
  );
`);
seedUsers();
seedSupplies();
module.exports = db;
