const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 10,
});

// ── Compatibility wrapper ────────────────────────────────────────────────────
// Makes pg look like better-sqlite3 (async) so all routes work with minimal changes

class Statement {
  constructor(sql) { this._orig = sql.trim(); }

  _resolve(args) {
    let sql = this._orig;
    const values = [];
    let i = 0;

    // Named params @name → $N
    if (args.length === 1 && args[0] !== null && typeof args[0] === 'object' && !Array.isArray(args[0])) {
      sql = sql.replace(/@(\w+)/g, (_, key) => {
        values.push(args[0][key] !== undefined ? args[0][key] : null);
        return `$${++i}`;
      });
    } else {
      // Positional ? → $N
      const flat = args.flat();
      sql = sql.replace(/\?/g, () => { values.push(flat[i] !== undefined ? flat[i] : null); return `$${++i}`; });
    }

    // SQLite → PostgreSQL SQL fixes
    const hasOrIgnore  = /\bINSERT\s+OR\s+IGNORE\b/i.test(sql);
    const hasOrReplace = /\bINSERT\s+OR\s+REPLACE\b/i.test(sql);
    sql = sql
      .replace(/\bINSERT\s+OR\s+IGNORE\s+INTO\b/gi,  'INSERT INTO')
      .replace(/\bINSERT\s+OR\s+REPLACE\s+INTO\b/gi, 'INSERT INTO')
      .replace(/\bdatetime\('now'\)/gi,  "to_char(NOW(), 'YYYY-MM-DD HH24:MI:SS')")
      .replace(/\bdatetime\("now"\)/gi,  "to_char(NOW(), 'YYYY-MM-DD HH24:MI:SS')")
      .replace(/\bdate\('now'\)/gi,      'CURRENT_DATE::TEXT');

    if (hasOrIgnore)  sql += ' ON CONFLICT DO NOTHING';
    if (hasOrReplace && /INTO\s+settings\b/i.test(sql)) {
      sql += ' ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value';
    }

    return { sql, values };
  }

  async get(...args) {
    const { sql, values } = this._resolve(args);
    const r = await pool.query(sql, values);
    return r.rows[0] ?? undefined;
  }

  async all(...args) {
    const { sql, values } = this._resolve(args);
    const r = await pool.query(sql, values);
    return r.rows;
  }

  async run(...args) {
    let { sql, values } = this._resolve(args);
    if (/^\s*INSERT/i.test(sql) && !/RETURNING/i.test(sql)) sql += ' RETURNING id';
    const r = await pool.query(sql, values);
    return { lastInsertRowid: r.rows[0]?.id ?? null, changes: r.rowCount };
  }
}

class CompatDb {
  prepare(sql) { return new Statement(sql); }
  async exec(sql) {
    sql = sql
      .replace(/\bINSERT\s+OR\s+IGNORE\s+INTO\b/gi,  'INSERT INTO')
      .replace(/\bINSERT\s+OR\s+REPLACE\s+INTO\b/gi, 'INSERT INTO')
      .replace(/\bdatetime\('now'\)/gi,  "to_char(NOW(), 'YYYY-MM-DD HH24:MI:SS')")
      .replace(/\bdatetime\("now"\)/gi,  "to_char(NOW(), 'YYYY-MM-DD HH24:MI:SS')");
    await pool.query(sql);
  }
  async transaction(fn) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await fn();
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }
  close() {} // no-op — pool manages connections
}

let _db = null;
function getDb() { if (!_db) _db = new CompatDb(); return _db; }

// ── Schema ───────────────────────────────────────────────────────────────────

const NOW_TEXT = `to_char(NOW(), 'YYYY-MM-DD HH24:MI:SS')`;

const SCHEMA_SQL = `
CREATE SCHEMA IF NOT EXISTS qms;
SET search_path TO qms, public;

CREATE TABLE IF NOT EXISTS documents (
  id           TEXT PRIMARY KEY,
  title        TEXT NOT NULL,
  type         TEXT NOT NULL,
  standard     TEXT NOT NULL DEFAULT 'ISO 9001',
  clause       TEXT,
  version      TEXT NOT NULL DEFAULT '1.0',
  status       TEXT NOT NULL DEFAULT 'Draft',
  owner        TEXT,
  owner_id     INTEGER,
  review_date  TEXT,
  scope        TEXT,
  evidence     TEXT DEFAULT '[]',
  version_date TEXT,
  created_by   TEXT,
  updated_by   TEXT,
  created_at   TEXT DEFAULT ${NOW_TEXT},
  updated_at   TEXT DEFAULT ${NOW_TEXT}
);

CREATE TABLE IF NOT EXISTS version_history (
  id          SERIAL PRIMARY KEY,
  doc_id      TEXT NOT NULL,
  version     TEXT NOT NULL,
  changed_at  TEXT DEFAULT ${NOW_TEXT},
  author      TEXT,
  approved_by TEXT,
  change_note TEXT,
  snapshot    TEXT
);

CREATE TABLE IF NOT EXISTS users (
  id                   SERIAL PRIMARY KEY,
  name                 TEXT NOT NULL,
  email                TEXT UNIQUE NOT NULL,
  role                 TEXT NOT NULL DEFAULT 'Reviewer',
  system_role          TEXT NOT NULL DEFAULT 'viewer',
  password_hash        TEXT,
  must_change_password INTEGER NOT NULL DEFAULT 0,
  created_at           TEXT DEFAULT ${NOW_TEXT}
);

CREATE TABLE IF NOT EXISTS workflows (
  id                SERIAL PRIMARY KEY,
  doc_id            TEXT NOT NULL,
  doc_version       TEXT NOT NULL,
  submitted_by      TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'Pending',
  purpose           TEXT NOT NULL DEFAULT 'approval',
  rejection_comment TEXT,
  created_at        TEXT DEFAULT ${NOW_TEXT},
  completed_at      TEXT
);

CREATE TABLE IF NOT EXISTS approval_steps (
  id            SERIAL PRIMARY KEY,
  workflow_id   INTEGER NOT NULL,
  step_order    INTEGER NOT NULL,
  approver_id   INTEGER NOT NULL,
  approver_name TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'Pending',
  comment       TEXT,
  acted_at      TEXT
);

CREATE TABLE IF NOT EXISTS archived_versions (
  id           SERIAL PRIMARY KEY,
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
  archived_at  TEXT DEFAULT ${NOW_TEXT},
  archived_by  TEXT,
  workflow_id  INTEGER,
  change_note  TEXT
);

CREATE TABLE IF NOT EXISTS document_files (
  id            SERIAL PRIMARY KEY,
  doc_id        TEXT NOT NULL DEFAULT '',
  filename      TEXT NOT NULL DEFAULT '',
  originalname  TEXT NOT NULL,
  mimetype      TEXT NOT NULL,
  size          INTEGER NOT NULL,
  file_hash     TEXT,
  is_primary    INTEGER DEFAULT 0,
  file_category TEXT DEFAULT 'supporting',
  content_html  TEXT,
  uploaded_by   TEXT,
  uploaded_at   TEXT DEFAULT ${NOW_TEXT},
  entity_type   TEXT NOT NULL DEFAULT 'document',
  entity_id     TEXT,
  file_data     TEXT
);

CREATE TABLE IF NOT EXISTS access_permissions (
  id         SERIAL PRIMARY KEY,
  doc_id     TEXT NOT NULL,
  user_id    INTEGER NOT NULL,
  permission TEXT NOT NULL DEFAULT 'view',
  granted_by TEXT,
  granted_at TEXT DEFAULT ${NOW_TEXT}
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS capas (
  id              TEXT PRIMARY KEY,
  type            TEXT NOT NULL DEFAULT 'NCR',
  title           TEXT NOT NULL,
  detail          TEXT,
  clause          TEXT,
  source          TEXT,
  owner           TEXT,
  owner_id        INTEGER,
  due_date        TEXT,
  root_cause      TEXT,
  action          TEXT,
  status          TEXT NOT NULL DEFAULT 'In Progress',
  pct_complete    INTEGER DEFAULT 0,
  raised_at       TEXT DEFAULT ${NOW_TEXT},
  closed_at       TEXT,
  created_by      TEXT,
  updated_by      TEXT,
  approval_status TEXT DEFAULT 'Not Submitted',
  created_at      TEXT DEFAULT ${NOW_TEXT},
  updated_at      TEXT DEFAULT ${NOW_TEXT}
);

CREATE TABLE IF NOT EXISTS notifications (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER NOT NULL,
  type       TEXT NOT NULL DEFAULT 'general',
  title      TEXT NOT NULL,
  message    TEXT,
  link       TEXT,
  is_read    INTEGER NOT NULL DEFAULT 0,
  created_by TEXT,
  created_at TEXT DEFAULT ${NOW_TEXT}
);

CREATE TABLE IF NOT EXISTS capa_seq (
  record_type TEXT NOT NULL,
  suffix      TEXT NOT NULL DEFAULT '',
  last_seq    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (record_type, suffix)
);

CREATE TABLE IF NOT EXISTS capa_workflows (
  id                SERIAL PRIMARY KEY,
  capa_id           TEXT NOT NULL,
  submitted_by      TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'In Progress',
  rejection_comment TEXT,
  created_at        TEXT DEFAULT ${NOW_TEXT},
  completed_at      TEXT
);

CREATE TABLE IF NOT EXISTS capa_approval_steps (
  id            SERIAL PRIMARY KEY,
  workflow_id   INTEGER NOT NULL,
  step_order    INTEGER NOT NULL,
  approver_id   INTEGER NOT NULL,
  approver_name TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'Pending',
  comment       TEXT,
  acted_at      TEXT
);
`;

// ── Init ─────────────────────────────────────────────────────────────────────

let _initPromise = null;

async function initDb() {
  const client = await pool.connect();
  try {
    // Create schema + all tables
    await client.query(`CREATE SCHEMA IF NOT EXISTS qms`);
    await client.query(`SET search_path TO qms, public`);

    // Run each CREATE TABLE statement individually
    const statements = SCHEMA_SQL
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 5 && !/^(CREATE SCHEMA|SET search_path)/i.test(s));
    for (const stmt of statements) {
      await client.query(stmt);
    }

    // ── Seed data ────────────────────────────────────────────────────────────
    const { rows: [{ n }] } = await client.query('SELECT COUNT(*) as n FROM qms.documents');
    if (Number(n) === 0) {
      const seedDocs = [
        { id:'SOP-001', title:'Document Control Procedure',      type:'SOP',    standard:'Both',      clause:'7.5 / A.5.10',  version:'3.1', status:'Approved',     owner:'QA Manager',      review_date:'2025-07-15', scope:'Controls creation, approval, distribution and retention of QMS documents.',            evidence:JSON.stringify(['Document register v3.1','Approval sign-off sheet','Distribution log']) },
        { id:'SOP-002', title:'Internal Audit Procedure',         type:'SOP',    standard:'Both',      clause:'9.2 / A.5.35',  version:'2.0', status:'Approved',     owner:'Internal Auditor', review_date:'2025-09-01', scope:'Defines planning and execution of internal audits against ISO 9001 and 27001.',      evidence:JSON.stringify(['Audit schedule 2025','Audit checklist','NCR log']) },
        { id:'SOP-003', title:'Corrective Action Procedure',      type:'SOP',    standard:'ISO 9001',  clause:'10.2',          version:'2.2', status:'Approved',     owner:'QA Manager',      review_date:'2025-08-20', scope:'Process for identifying root causes and implementing corrective actions.',             evidence:JSON.stringify(['CAPA register','Root cause analysis template']) },
        { id:'SOP-004', title:'Risk & Opportunity Management',    type:'SOP',    standard:'Both',      clause:'6.1 / A.6.1',   version:'1.5', status:'Under Review', owner:'Risk Officer',    review_date:'2025-06-30', scope:'Identifies, evaluates and treats risks and opportunities across the QMS and ISMS.',  evidence:JSON.stringify(['Risk register','Risk treatment plan']) },
        { id:'SOP-005', title:'Supplier Evaluation Procedure',    type:'SOP',    standard:'ISO 9001',  clause:'8.4',           version:'1.2', status:'Approved',     owner:'Procurement',     review_date:'2025-12-01', scope:'Criteria and method for evaluating and re-evaluating external providers.',             evidence:JSON.stringify(['Supplier scorecard','Approved supplier list']) },
        { id:'POL-001', title:'Information Security Policy',      type:'Policy', standard:'ISO 27001', clause:'A.5.1',         version:'4.0', status:'Approved',     owner:'CISO',            review_date:'2025-07-01', scope:'Establishes management direction and support for information security.',               evidence:JSON.stringify(['Board approval minutes','Staff acknowledgement log']) },
        { id:'POL-002', title:'Quality Policy',                   type:'Policy', standard:'ISO 9001',  clause:'5.2',           version:'3.0', status:'Approved',     owner:'MD / CEO',        review_date:'2026-01-15', scope:'Statement of quality objectives and commitment signed by top management.',           evidence:JSON.stringify(['Signed policy v3.0','Communication record']) },
        { id:'POL-003', title:'Access Control Policy',            type:'Policy', standard:'ISO 27001', clause:'A.8.3',         version:'2.1', status:'Approved',     owner:'IT Manager',      review_date:'2025-08-10', scope:'Rules for granting, reviewing and revoking access to information systems.',            evidence:JSON.stringify(['Access matrix','Role-based access review log']) },
        { id:'POL-004', title:'Acceptable Use Policy',            type:'Policy', standard:'ISO 27001', clause:'A.5.10',        version:'1.8', status:'Approved',     owner:'HR Manager',      review_date:'2025-10-01', scope:'Defines acceptable use of company IT assets and information systems.',                evidence:JSON.stringify(['Signed AUP forms 2024','Training completion records']) },
        { id:'POL-005', title:'Business Continuity Policy',       type:'Policy', standard:'Both',      clause:'8.5.5 / A.5.29',version:'1.0', status:'Draft',        owner:'Risk Officer',    review_date:'2025-07-20', scope:'Policy for maintaining critical operations during disruptions.',                      evidence:JSON.stringify([]) },
        { id:'EVD-001', title:'Management Review Minutes Q1 2025',type:'Evidence',standard:'Both',     clause:'9.3',           version:'1.0', status:'Approved',     owner:'QA Manager',      review_date:'2026-01-01', scope:'Signed minutes from Q1 management review meeting.',                                   evidence:JSON.stringify(['Minutes_Q1_2025.pdf','Attendance sheet']) },
        { id:'EVD-002', title:'Customer Satisfaction Survey Results',type:'Evidence',standard:'ISO 9001',clause:'9.1.2',       version:'1.0', status:'Approved',     owner:'QA Manager',      review_date:'2025-12-31', scope:'Compiled survey results for FY2024-25.',                                              evidence:JSON.stringify(['Survey_results_FY2425.xlsx','Analysis report']) },
        { id:'EVD-003', title:'Penetration Test Report 2024',     type:'Evidence',standard:'ISO 27001',clause:'A.8.8',         version:'1.0', status:'Approved',     owner:'IT Manager',      review_date:'2025-11-01', scope:'External pentest findings and remediation status.',                                   evidence:JSON.stringify(['Pentest_report_Oct24.pdf','Remediation tracker']) },
        { id:'EVD-004', title:'Security Awareness Training Records',type:'Evidence',standard:'ISO 27001',clause:'A.6.3',       version:'1.0', status:'Approved',     owner:'HR Manager',      review_date:'2025-12-15', scope:'Completion records for mandatory security awareness training.',                        evidence:JSON.stringify(['Training completion matrix 2024','Quiz scores']) },
      ];
      for (const d of seedDocs) {
        await client.query(
          `INSERT INTO qms.documents (id,title,type,standard,clause,version,status,owner,review_date,scope,evidence) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT DO NOTHING`,
          [d.id,d.title,d.type,d.standard,d.clause,d.version,d.status,d.owner,d.review_date,d.scope,d.evidence]
        );
      }

      const seedHistory = [
        { doc_id:'SOP-001', version:'3.1', author:'QA Manager',  change_note:'Updated retention periods to reflect new legal requirement.', changed_at:'2025-04-10' },
        { doc_id:'SOP-001', version:'3.0', author:'QA Manager',  change_note:'Restructured approval workflow; added e-signature requirement.', changed_at:'2025-01-15' },
        { doc_id:'SOP-001', version:'2.2', author:'QA Lead',     change_note:'Minor clarification on distribution log format.', changed_at:'2024-07-01' },
        { doc_id:'POL-001', version:'4.0', author:'CISO',        change_note:'Major revision to align with ISO 27001:2022 controls.', changed_at:'2025-03-20' },
        { doc_id:'POL-001', version:'3.1', author:'CISO',        change_note:'Annual review — no substantive changes; re-approved.', changed_at:'2024-09-05' },
        { doc_id:'SOP-004', version:'1.5', author:'Risk Officer', change_note:'Updated risk appetite thresholds. Under review pending board sign-off.', changed_at:'2025-05-01' },
      ];
      for (const v of seedHistory) {
        await client.query(
          `INSERT INTO qms.version_history (doc_id,version,author,change_note,changed_at) VALUES ($1,$2,$3,$4,$5)`,
          [v.doc_id,v.version,v.author,v.change_note,v.changed_at]
        );
      }

      const seedUsers = [
        { name:'Arjun Mehta',  email:'arjun.mehta@company.com',  role:'QA Manager',      system_role:'admin'  },
        { name:'Priya Sharma', email:'priya.sharma@company.com', role:'CISO',             system_role:'admin'  },
        { name:'Rohan Patel',  email:'rohan.patel@company.com',  role:'IT Manager',       system_role:'editor' },
        { name:'Sneha Desai',  email:'sneha.desai@company.com',  role:'Risk Officer',     system_role:'editor' },
        { name:'Vikram Nair',  email:'vikram.nair@company.com',  role:'MD / CEO',         system_role:'admin'  },
        { name:'Kavya Iyer',   email:'kavya.iyer@company.com',   role:'HR Manager',       system_role:'editor' },
        { name:'Manish Gupta', email:'manish.gupta@company.com', role:'Procurement',      system_role:'viewer' },
        { name:'Divya Kapoor', email:'divya.kapoor@company.com', role:'Internal Auditor', system_role:'viewer' },
      ];
      for (const u of seedUsers) {
        await client.query(
          `INSERT INTO qms.users (name,email,role,system_role) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
          [u.name,u.email,u.role,u.system_role]
        );
      }

      const seedCapas = [
        { id:'NCR-001',  type:'NCR',  title:'Document review overdue — SOP-004',          detail:'SOP-004 exceeded its scheduled review date by 45 days without re-approval.',       clause:'7.5 / 9.1', source:'Internal Audit',   owner:'QA Manager',  due_date:'2025-06-25', root_cause:'Reminder process not in place.',         action:'Implement automated review reminders.',   status:'Waiting for Approval', pct_complete:60,  raised_at:'2025-05-10' },
        { id:'CAPA-001', type:'CAPA', title:'Access rights not revoked on employee exit',  detail:'3 terminated employee accounts still active in core business application.',         clause:'A.8.3',     source:'Internal Audit',   owner:'IT Manager',  due_date:'2025-06-15', root_cause:'Offboarding checklist missing IT step.', action:'Updated HR offboarding SOP.',             status:'Approved & Closed',    pct_complete:100, raised_at:'2025-04-22' },
        { id:'NCR-002',  type:'NCR',  title:'Supplier evaluation not completed — Q1',      detail:'Two critical suppliers not re-evaluated in Q1 2025 as per SOP-005.',               clause:'8.4',       source:'Management Review', owner:'Procurement', due_date:'2025-07-01', root_cause:'Pending investigation.',                 action:'Pending.',                                status:'In Progress',          pct_complete:0,   raised_at:'2025-05-15' },
      ];
      for (const c of seedCapas) {
        await client.query(
          `INSERT INTO qms.capas (id,type,title,detail,clause,source,owner,due_date,root_cause,action,status,pct_complete,raised_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT DO NOTHING`,
          [c.id,c.type,c.title,c.detail,c.clause,c.source,c.owner,c.due_date,c.root_cause,c.action,c.status,c.pct_complete,c.raised_at]
        );
      }

      // Seed workflow
      const wfRes = await client.query(
        `INSERT INTO qms.workflows (doc_id,doc_version,submitted_by,status,created_at) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        ['SOP-004','1.5','Sneha Desai','In Progress','2025-05-02 09:00:00']
      );
      const wfId = wfRes.rows[0].id;
      const arjun  = (await client.query(`SELECT id FROM qms.users WHERE email='arjun.mehta@company.com'`)).rows[0];
      const priya  = (await client.query(`SELECT id FROM qms.users WHERE email='priya.sharma@company.com'`)).rows[0];
      const vikram = (await client.query(`SELECT id FROM qms.users WHERE email='vikram.nair@company.com'`)).rows[0];
      await client.query(`INSERT INTO qms.approval_steps (workflow_id,step_order,approver_id,approver_name,status,comment,acted_at) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [wfId,1,arjun?.id||1,'Arjun Mehta','Approved','Risk appetite thresholds look reasonable.','2025-05-03 11:20:00']);
      await client.query(`INSERT INTO qms.approval_steps (workflow_id,step_order,approver_id,approver_name,status,comment,acted_at) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [wfId,2,priya?.id||2,'Priya Sharma','Awaiting',null,null]);
      await client.query(`INSERT INTO qms.approval_steps (workflow_id,step_order,approver_id,approver_name,status,comment,acted_at) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [wfId,3,vikram?.id||5,'Vikram Nair','Pending',null,null]);
    }

    // Ensure default admin exists
    const adminRes = await client.query(`SELECT id FROM qms.users WHERE system_role='admin' AND password_hash IS NOT NULL LIMIT 1`);
    if (adminRes.rows.length === 0) {
      const hash = bcrypt.hashSync('Admin@1234', 10);
      await client.query(
        `INSERT INTO qms.users (name,email,role,system_role,password_hash) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
        ['Administrator','admin@qms.local','QA Manager','admin',hash]
      );
    }

    console.log('PostgreSQL (qms schema) initialised');
  } finally {
    client.release();
  }
}

function ensureDb() {
  if (!_initPromise) _initPromise = initDb().catch(e => { _initPromise = null; throw e; });
  return _initPromise;
}

// Set search_path for every new pool connection
pool.on('connect', client => { client.query('SET search_path TO qms, public'); });

module.exports = { ensureDb, getDb };
