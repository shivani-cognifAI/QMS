const initSqlJs = require('sql.js');
const path = require('path');
const fs   = require('fs');

const DB_PATH = path.join(process.cwd(), 'data/qms.db');

// ── sql.js compatibility wrapper ─────────────────────────────────────────────
// Makes sql.js look like better-sqlite3 so all routes work unchanged.
// sql.js is pure JavaScript — no C++ compilation, works on every Node version.

let _sqlJs = null;
async function getSqlJs() {
  if (!_sqlJs) _sqlJs = await initSqlJs();
  return _sqlJs;
}

class Statement {
  constructor(db, sql) {
    this._db  = db;
    this._sql = sql;
  }
  run(...args) {
    let sql = this._sql;
    let values = [];

    if (args.length === 1 && args[0] !== null && typeof args[0] === 'object' && !Array.isArray(args[0])) {
      const params = args[0];
      values = [];
      sql = sql.replace(/@(\w+)/g, (_, key) => { values.push(params[key] !== undefined ? params[key] : null); return '?'; });
    } else if (args.length === 1 && Array.isArray(args[0])) {
      values = args[0];
    } else {
      values = args;
    }

    this._db.run(sql, values);
    const lastRow = this._db.exec('SELECT last_insert_rowid() as id');
    return { lastInsertRowid: lastRow[0]?.values[0][0] ?? 0 };
  }
  _resolve(args) {
    let sql = this._sql;
    let values = [];
    if (args.length === 1 && args[0] !== null && typeof args[0] === 'object' && !Array.isArray(args[0])) {
      const params = args[0];
      sql = sql.replace(/@(\w+)/g, (_, key) => { values.push(params[key] !== undefined ? params[key] : null); return '?'; });
    } else if (args.length === 1 && Array.isArray(args[0])) {
      values = args[0];
    } else {
      values = args;
    }
    return { sql, values };
  }

  get(...args) {
    const { sql, values } = this._resolve(args);
    const res = this._db.exec(sql, values);
    if (!res.length || !res[0].values.length) return undefined;
    const cols = res[0].columns;
    return Object.fromEntries(cols.map((c, i) => [c, res[0].values[0][i]]));
  }

  all(...args) {
    const { sql, values } = this._resolve(args);
    const res = this._db.exec(sql, values);
    if (!res.length) return [];
    const cols = res[0].columns;
    return res[0].values.map(row => Object.fromEntries(cols.map((c, i) => [c, row[i]])));
  }
}

class CompatDb {
  constructor(sqlJsDb) {
    this._db = sqlJsDb;
  }
  prepare(sql) {
    return new Statement(this._db, sql.trim());
  }
  exec(sql) {
    this._db.run(sql);
  }
  run(sql, params = []) {
    this._db.run(sql, params);
  }
  transaction(fn) {
    return (...args) => {
      this._db.run('BEGIN');
      try {
        fn(...args);
        this._db.run('COMMIT');
      } catch (e) {
        this._db.run('ROLLBACK');
        throw e;
      }
    };
  }
  close() {
    // Save to disk on every close (this is how sql.js persists data)
    const dir = path.dirname(DB_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(DB_PATH, Buffer.from(this._db.export()));
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

let _cachedSqlJs = null;

function getDb() {
  if (!_cachedSqlJs) throw new Error('Database not initialised. Call initDb() first.');
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  let sqlJsDb;
  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    sqlJsDb = new _cachedSqlJs.Database(fileBuffer);
  } else {
    sqlJsDb = new _cachedSqlJs.Database();
  }
  return new CompatDb(sqlJsDb);
}

async function initDb() {
  _cachedSqlJs = await getSqlJs();

  const db = getDb();

  db.exec(`
    CREATE TABLE IF NOT EXISTS documents (
      id           TEXT PRIMARY KEY,
      title        TEXT NOT NULL,
      type         TEXT NOT NULL,
      standard     TEXT NOT NULL,
      clause       TEXT,
      version      TEXT NOT NULL DEFAULT '1.0',
      version_date TEXT,
      status       TEXT NOT NULL DEFAULT 'Draft',
      owner        TEXT,
      owner_id     INTEGER,
      review_date  TEXT,
      scope        TEXT,
      evidence     TEXT DEFAULT '[]',
      created_by   TEXT,
      updated_by   TEXT,
      created_at   TEXT DEFAULT (datetime('now')),
      updated_at   TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS version_history (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      doc_id      TEXT NOT NULL,
      version     TEXT NOT NULL,
      changed_at  TEXT DEFAULT (datetime('now')),
      author      TEXT,
      approved_by TEXT,
      change_note TEXT,
      snapshot    TEXT
    );

    CREATE TABLE IF NOT EXISTS users (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT NOT NULL,
      email       TEXT UNIQUE NOT NULL,
      role        TEXT NOT NULL DEFAULT 'Reviewer',
      system_role TEXT NOT NULL DEFAULT 'viewer',
      created_at  TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS workflows (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      doc_id            TEXT NOT NULL,
      doc_version       TEXT NOT NULL,
      submitted_by      TEXT NOT NULL,
      status            TEXT NOT NULL DEFAULT 'Pending',
      purpose           TEXT NOT NULL DEFAULT 'approval',
      rejection_comment TEXT,
      created_at        TEXT DEFAULT (datetime('now')),
      completed_at      TEXT
    );

    CREATE TABLE IF NOT EXISTS approval_steps (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      workflow_id   INTEGER NOT NULL,
      step_order    INTEGER NOT NULL,
      approver_id   INTEGER NOT NULL,
      approver_name TEXT NOT NULL,
      status        TEXT NOT NULL DEFAULT 'Pending',
      comment       TEXT,
      acted_at      TEXT
    );

    CREATE TABLE IF NOT EXISTS archived_versions (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      doc_id       TEXT NOT NULL,
      doc_title    TEXT NOT NULL,
      version      TEXT NOT NULL,
      version_date TEXT,
      status       TEXT NOT NULL,
      type         TEXT NOT NULL,
      standard     TEXT NOT NULL,
      clause       TEXT,
      owner        TEXT,
      review_date  TEXT,
      scope        TEXT,
      evidence     TEXT DEFAULT '[]',
      archived_at  TEXT DEFAULT (datetime('now')),
      archived_by  TEXT,
      workflow_id  INTEGER,
      change_note  TEXT
    );

    CREATE TABLE IF NOT EXISTS document_files (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      doc_id        TEXT NOT NULL,
      filename      TEXT NOT NULL DEFAULT '',
      originalname  TEXT NOT NULL,
      mimetype      TEXT NOT NULL,
      size          INTEGER NOT NULL,
      file_hash     TEXT,
      is_primary    INTEGER DEFAULT 0,
      file_category TEXT DEFAULT 'supporting',
      content_html  TEXT,
      uploaded_by   TEXT,
      uploaded_at   TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS access_permissions (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      doc_id     TEXT NOT NULL,
      user_id    INTEGER NOT NULL,
      permission TEXT NOT NULL DEFAULT 'view',
      granted_by TEXT,
      granted_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS capas (
      id           TEXT PRIMARY KEY,
      type         TEXT NOT NULL DEFAULT 'NCR',
      title        TEXT NOT NULL,
      detail       TEXT,
      clause       TEXT,
      source       TEXT,
      owner        TEXT,
      owner_id     INTEGER,
      due_date     TEXT,
      root_cause   TEXT,
      action       TEXT,
      status       TEXT NOT NULL DEFAULT 'In Progress',
      pct_complete INTEGER DEFAULT 0,
      raised_at    TEXT DEFAULT (datetime('now')),
      closed_at    TEXT,
      created_by   TEXT,
      updated_by   TEXT,
      created_at   TEXT DEFAULT (datetime('now')),
      updated_at   TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     INTEGER NOT NULL,
      type        TEXT NOT NULL DEFAULT 'general',
      title       TEXT NOT NULL,
      message     TEXT,
      link        TEXT,
      is_read     INTEGER NOT NULL DEFAULT 0,
      created_by  TEXT,
      created_at  TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS capa_seq (
      record_type TEXT NOT NULL,
      suffix      TEXT NOT NULL DEFAULT '',
      last_seq    INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (record_type, suffix)
    );

    CREATE TABLE IF NOT EXISTS capa_workflows (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      capa_id           TEXT NOT NULL,
      submitted_by      TEXT NOT NULL,
      status            TEXT NOT NULL DEFAULT 'In Progress',
      rejection_comment TEXT,
      created_at        TEXT DEFAULT (datetime('now')),
      completed_at      TEXT
    );

    CREATE TABLE IF NOT EXISTS capa_approval_steps (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      workflow_id   INTEGER NOT NULL,
      step_order    INTEGER NOT NULL,
      approver_id   INTEGER NOT NULL,
      approver_name TEXT NOT NULL,
      status        TEXT NOT NULL DEFAULT 'Pending',
      comment       TEXT,
      acted_at      TEXT
    );
  `);

  // capa_seq primary key migration
  try {
    const cols = db._db.exec(`PRAGMA table_info(capa_seq)`);
    const hasSuffix = cols.length > 0 && cols[0].values.some(row => row[1] === 'suffix');
    if (!hasSuffix) {
      db.exec(`ALTER TABLE capa_seq RENAME TO capa_seq_old`);
      db.exec(`
        CREATE TABLE capa_seq (
          record_type TEXT NOT NULL,
          suffix      TEXT NOT NULL DEFAULT '',
          last_seq    INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY (record_type, suffix)
        )
      `);
      db.exec(`INSERT INTO capa_seq (record_type, suffix, last_seq) SELECT record_type, '', last_seq FROM capa_seq_old`);
      db.exec(`DROP TABLE capa_seq_old`);
    }
  } catch (_) {}

  // Safe migrations for existing databases
  try { db.exec(`ALTER TABLE users ADD COLUMN system_role TEXT NOT NULL DEFAULT 'viewer'`); } catch(_) {}
  try { db.exec(`ALTER TABLE document_files ADD COLUMN is_primary INTEGER DEFAULT 0`); } catch(_) {}
  try { db.exec(`ALTER TABLE document_files ADD COLUMN file_category TEXT DEFAULT 'supporting'`); } catch(_) {}
  try { db.exec(`ALTER TABLE document_files ADD COLUMN content_html TEXT`); } catch(_) {}
  try { db.exec(`ALTER TABLE version_history ADD COLUMN approved_by TEXT`); } catch(_) {}
  try { db.exec(`ALTER TABLE document_files ADD COLUMN file_hash TEXT`); } catch(_) {}
  try { db.exec(`ALTER TABLE document_files ADD COLUMN entity_type TEXT NOT NULL DEFAULT 'document'`); } catch(_) {}
  try { db.exec(`ALTER TABLE document_files ADD COLUMN entity_id TEXT`); } catch(_) {}
  try { db.exec(`UPDATE document_files SET entity_id = doc_id WHERE entity_id IS NULL AND doc_id IS NOT NULL AND doc_id != ''`); } catch(_) {}
  try { db.exec(`ALTER TABLE capas ADD COLUMN approval_status TEXT DEFAULT 'Not Submitted'`); } catch(_) {}
  try { db.exec(`ALTER TABLE capas ADD COLUMN owner_id INTEGER`); } catch(_) {}
  try { db.exec(`ALTER TABLE capas ADD COLUMN created_by TEXT`); } catch(_) {}
  try { db.exec(`ALTER TABLE capas ADD COLUMN updated_by TEXT`); } catch(_) {}
  try {
    const migrationFlag = db.prepare(`SELECT value FROM settings WHERE key='capa_status_migration_v1'`).get();
    if (!migrationFlag) {
      db.exec(`UPDATE capas SET status = 'Waiting for Approval' WHERE status = 'In Progress'`);
      db.exec(`UPDATE capas SET status = 'In Progress' WHERE status = 'Open'`);
      db.exec(`UPDATE capas SET status = 'Approved & Closed' WHERE status = 'Closed'`);
      db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES ('capa_status_migration_v1', 'done')`).run();
    }
  } catch (_) {}
  try { db.exec(`ALTER TABLE documents ADD COLUMN owner_id INTEGER`); } catch(_) {}
  try { db.exec(`ALTER TABLE documents ADD COLUMN created_by TEXT`); } catch(_) {}
  try { db.exec(`ALTER TABLE documents ADD COLUMN updated_by TEXT`); } catch(_) {}
  try { db.exec(`ALTER TABLE workflows ADD COLUMN purpose TEXT NOT NULL DEFAULT 'approval'`); } catch(_) {}
  try { db.exec(`CREATE TABLE IF NOT EXISTS access_permissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT, doc_id TEXT NOT NULL, user_id INTEGER NOT NULL,
    permission TEXT NOT NULL DEFAULT 'view', granted_by TEXT, granted_at TEXT DEFAULT (datetime('now'))
  )`); } catch(_) {}

  // Seed if empty
  const count = db.prepare('SELECT COUNT(*) as n FROM documents').get();
  if (count && count.n === 0) {
    const insertDoc = db.prepare(`
      INSERT OR IGNORE INTO documents (id,title,type,standard,clause,version,status,owner,review_date,scope,evidence)
      VALUES (@id,@title,@type,@standard,@clause,@version,@status,@owner,@review_date,@scope,@evidence)
    `);
    const insertVH = db.prepare(`
      INSERT INTO version_history (doc_id,version,author,change_note,changed_at)
      VALUES (@doc_id,@version,@author,@change_note,@changed_at)
    `);

    const seedDocs = [
      { id:'SOP-001', title:'Document Control Procedure', type:'SOP', standard:'Both', clause:'7.5 / A.5.10', version:'3.1', status:'Approved', owner:'QA Manager', review_date:'2025-07-15', scope:'Controls creation, approval, distribution and retention of QMS documents.', evidence:JSON.stringify(['Document register v3.1','Approval sign-off sheet','Distribution log']) },
      { id:'SOP-002', title:'Internal Audit Procedure', type:'SOP', standard:'Both', clause:'9.2 / A.5.35', version:'2.0', status:'Approved', owner:'Internal Auditor', review_date:'2025-09-01', scope:'Defines planning and execution of internal audits against ISO 9001 and 27001.', evidence:JSON.stringify(['Audit schedule 2025','Audit checklist','NCR log']) },
      { id:'SOP-003', title:'Corrective Action Procedure', type:'SOP', standard:'ISO 9001', clause:'10.2', version:'2.2', status:'Approved', owner:'QA Manager', review_date:'2025-08-20', scope:'Process for identifying root causes and implementing corrective actions.', evidence:JSON.stringify(['CAPA register','Root cause analysis template']) },
      { id:'SOP-004', title:'Risk & Opportunity Management', type:'SOP', standard:'Both', clause:'6.1 / A.6.1', version:'1.5', status:'Under Review', owner:'Risk Officer', review_date:'2025-06-30', scope:'Identifies, evaluates and treats risks and opportunities across the QMS and ISMS.', evidence:JSON.stringify(['Risk register','Risk treatment plan']) },
      { id:'SOP-005', title:'Supplier Evaluation Procedure', type:'SOP', standard:'ISO 9001', clause:'8.4', version:'1.2', status:'Approved', owner:'Procurement', review_date:'2025-12-01', scope:'Criteria and method for evaluating and re-evaluating external providers.', evidence:JSON.stringify(['Supplier scorecard','Approved supplier list']) },
      { id:'POL-001', title:'Information Security Policy', type:'Policy', standard:'ISO 27001', clause:'A.5.1', version:'4.0', status:'Approved', owner:'CISO', review_date:'2025-07-01', scope:'Establishes management direction and support for information security.', evidence:JSON.stringify(['Board approval minutes','Staff acknowledgement log']) },
      { id:'POL-002', title:'Quality Policy', type:'Policy', standard:'ISO 9001', clause:'5.2', version:'3.0', status:'Approved', owner:'MD / CEO', review_date:'2026-01-15', scope:'Statement of quality objectives and commitment signed by top management.', evidence:JSON.stringify(['Signed policy v3.0','Communication record']) },
      { id:'POL-003', title:'Access Control Policy', type:'Policy', standard:'ISO 27001', clause:'A.8.3', version:'2.1', status:'Approved', owner:'IT Manager', review_date:'2025-08-10', scope:'Rules for granting, reviewing and revoking access to information systems.', evidence:JSON.stringify(['Access matrix','Role-based access review log']) },
      { id:'POL-004', title:'Acceptable Use Policy', type:'Policy', standard:'ISO 27001', clause:'A.5.10', version:'1.8', status:'Approved', owner:'HR Manager', review_date:'2025-10-01', scope:'Defines acceptable use of company IT assets and information systems.', evidence:JSON.stringify(['Signed AUP forms 2024','Training completion records']) },
      { id:'POL-005', title:'Business Continuity Policy', type:'Policy', standard:'Both', clause:'8.5.5 / A.5.29', version:'1.0', status:'Draft', owner:'Risk Officer', review_date:'2025-07-20', scope:'Policy for maintaining critical operations during disruptions.', evidence:JSON.stringify([]) },
      { id:'EVD-001', title:'Management Review Minutes Q1 2025', type:'Evidence', standard:'Both', clause:'9.3', version:'1.0', status:'Approved', owner:'QA Manager', review_date:'2026-01-01', scope:'Signed minutes from Q1 management review meeting.', evidence:JSON.stringify(['Minutes_Q1_2025.pdf','Attendance sheet']) },
      { id:'EVD-002', title:'Customer Satisfaction Survey Results', type:'Evidence', standard:'ISO 9001', clause:'9.1.2', version:'1.0', status:'Approved', owner:'QA Manager', review_date:'2025-12-31', scope:'Compiled survey results for FY2024-25.', evidence:JSON.stringify(['Survey_results_FY2425.xlsx','Analysis report']) },
      { id:'EVD-003', title:'Penetration Test Report 2024', type:'Evidence', standard:'ISO 27001', clause:'A.8.8', version:'1.0', status:'Approved', owner:'IT Manager', review_date:'2025-11-01', scope:'External pentest findings and remediation status.', evidence:JSON.stringify(['Pentest_report_Oct24.pdf','Remediation tracker']) },
      { id:'EVD-004', title:'Security Awareness Training Records', type:'Evidence', standard:'ISO 27001', clause:'A.6.3', version:'1.0', status:'Approved', owner:'HR Manager', review_date:'2025-12-15', scope:'Completion records for mandatory security awareness training.', evidence:JSON.stringify(['Training completion matrix 2024','Quiz scores']) },
    ];

    const seedHistory = [
      { doc_id:'SOP-001', version:'3.1', author:'QA Manager', change_note:'Updated retention periods to reflect new legal requirement. Section 5.3 revised.', changed_at:'2025-04-10' },
      { doc_id:'SOP-001', version:'3.0', author:'QA Manager', change_note:'Restructured approval workflow; added e-signature requirement.', changed_at:'2025-01-15' },
      { doc_id:'SOP-001', version:'2.2', author:'QA Lead',    change_note:'Minor clarification on distribution log format.', changed_at:'2024-07-01' },
      { doc_id:'POL-001', version:'4.0', author:'CISO',       change_note:'Major revision to align with ISO 27001:2022 controls. Added AI system guidance.', changed_at:'2025-03-20' },
      { doc_id:'POL-001', version:'3.1', author:'CISO',       change_note:'Annual review — no substantive changes; re-approved.', changed_at:'2024-09-05' },
      { doc_id:'SOP-004', version:'1.5', author:'Risk Officer',change_note:'Updated risk appetite thresholds. Under review pending board sign-off.', changed_at:'2025-05-01' },
    ];

    db.transaction(() => {
      for (const d of seedDocs)    insertDoc.run(d);
      for (const v of seedHistory) insertVH.run(v);
    })();

    const insertCapa = db.prepare(`
      INSERT OR IGNORE INTO capas (id,type,title,detail,clause,source,owner,due_date,root_cause,action,status,pct_complete,raised_at)
      VALUES (@id,@type,@title,@detail,@clause,@source,@owner,@due_date,@root_cause,@action,@status,@pct_complete,@raised_at)
    `);
    const seedCapas = [
      { id:'NCR-001', type:'NCR',  title:'Document review overdue — SOP-004', detail:'SOP-004 exceeded its scheduled review date by 45 days without re-approval.', clause:'7.5 / 9.1', source:'Internal Audit',  owner:'QA Manager',  due_date:'2025-06-25', root_cause:'Reminder process not in place.', action:'Implement automated review reminders.', status:'Waiting for Approval', pct_complete:60,  raised_at:'2025-05-10' },
      { id:'CAPA-001',type:'CAPA', title:'Access rights not revoked on employee exit', detail:'3 terminated employee accounts still active in core business application.', clause:'A.8.3', source:'Internal Audit',  owner:'IT Manager',  due_date:'2025-06-15', root_cause:'Offboarding checklist missing IT step.',  action:'Updated HR offboarding SOP.',        status:'Approved & Closed',      pct_complete:100, raised_at:'2025-04-22' },
      { id:'NCR-002', type:'NCR',  title:'Supplier evaluation not completed — Q1',    detail:'Two critical suppliers not re-evaluated in Q1 2025 as per SOP-005.',       clause:'8.4',      source:'Management Review', owner:'Procurement', due_date:'2025-07-01', root_cause:'Pending investigation.',               action:'Pending.',                          status:'In Progress',        pct_complete:0,   raised_at:'2025-05-15' },
    ];
    db.transaction(() => { for (const c of seedCapas) insertCapa.run(c); })();

    const insertUser = db.prepare(`INSERT OR IGNORE INTO users (name,email,role,system_role) VALUES (@name,@email,@role,@system_role)`);
    const seedUsers = [
      { name:'Arjun Mehta',  email:'arjun.mehta@company.com',  role:'QA Manager',       system_role:'admin'  },
      { name:'Priya Sharma', email:'priya.sharma@company.com', role:'CISO',              system_role:'admin'  },
      { name:'Rohan Patel',  email:'rohan.patel@company.com',  role:'IT Manager',        system_role:'editor' },
      { name:'Sneha Desai',  email:'sneha.desai@company.com',  role:'Risk Officer',      system_role:'editor' },
      { name:'Vikram Nair',  email:'vikram.nair@company.com',  role:'MD / CEO',          system_role:'admin'  },
      { name:'Kavya Iyer',   email:'kavya.iyer@company.com',   role:'HR Manager',        system_role:'editor' },
      { name:'Manish Gupta', email:'manish.gupta@company.com', role:'Procurement',       system_role:'viewer' },
      { name:'Divya Kapoor', email:'divya.kapoor@company.com', role:'Internal Auditor',  system_role:'viewer' },
    ];
    db.transaction(() => { for (const u of seedUsers) insertUser.run(u); })();

    // Seed example workflow for SOP-004
    db.prepare(`INSERT INTO workflows (doc_id,doc_version,submitted_by,status,created_at) VALUES (@doc_id,@doc_version,@submitted_by,@status,@created_at)`)
      .run({ doc_id:'SOP-004', doc_version:'1.5', submitted_by:'Sneha Desai', status:'In Progress', created_at:'2025-05-02 09:00:00' });

    const wfId = db.prepare('SELECT last_insert_rowid() as id').get()?.id || 1;
    const arjun  = db.prepare("SELECT id FROM users WHERE email='arjun.mehta@company.com'").get();
    const priya  = db.prepare("SELECT id FROM users WHERE email='priya.sharma@company.com'").get();
    const vikram = db.prepare("SELECT id FROM users WHERE email='vikram.nair@company.com'").get();

    db.transaction(() => {
      db.prepare(`INSERT INTO approval_steps (workflow_id,step_order,approver_id,approver_name,status,comment,acted_at) VALUES (@workflow_id,@step_order,@approver_id,@approver_name,@status,@comment,@acted_at)`)
        .run({ workflow_id:wfId, step_order:1, approver_id:arjun?.id||1,  approver_name:'Arjun Mehta',  status:'Approved', comment:'Risk appetite thresholds look reasonable.', acted_at:'2025-05-03 11:20:00' });
      db.prepare(`INSERT INTO approval_steps (workflow_id,step_order,approver_id,approver_name,status,comment,acted_at) VALUES (@workflow_id,@step_order,@approver_id,@approver_name,@status,@comment,@acted_at)`)
        .run({ workflow_id:wfId, step_order:2, approver_id:priya?.id||2,  approver_name:'Priya Sharma',  status:'Awaiting', comment:null, acted_at:null });
      db.prepare(`INSERT INTO approval_steps (workflow_id,step_order,approver_id,approver_name,status,comment,acted_at) VALUES (@workflow_id,@step_order,@approver_id,@approver_name,@status,@comment,@acted_at)`)
        .run({ workflow_id:wfId, step_order:3, approver_id:vikram?.id||5, approver_name:'Vikram Nair',   status:'Pending',  comment:null, acted_at:null });
    })();
  }

  db.close();
  console.log('Database initialised:', DB_PATH);
}

// Singleton promise pattern — safe for Next.js concurrent requests
let _initPromise = null;
function ensureDb() {
  if (!_initPromise) _initPromise = initDb();
  return _initPromise;
}

module.exports = { getDb, initDb, ensureDb };
