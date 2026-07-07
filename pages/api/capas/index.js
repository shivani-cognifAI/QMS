import { ensureDb, getDb } from '../../../lib/db';
const { createNotification } = require('../../../lib/notify');

async function getNumberingConfig(db, type) {
  const row = await db.prepare(`SELECT value FROM settings WHERE key='capa_numbering'`).get();
  let all = {};
  if (row && row.value) { try { all = JSON.parse(row.value); } catch (_) {} }
  const cfg = all[type] || { prefix: '', rules: [] };
  if (!Array.isArray(cfg.rules)) {
    return { prefix: cfg.prefix || '', rules: cfg.suffix ? [{ suffix: cfg.suffix, start_date: null, end_date: null }] : [] };
  }
  return { prefix: cfg.prefix || '', rules: cfg.rules };
}

export default async function handler(req, res) {
  try {
    await ensureDb();

    if (req.method === 'GET') {
      const db = getDb();
      const { status, type, search } = req.query;
      let sql = 'SELECT * FROM capas WHERE 1=1';
      const params = [];
      if (status) { sql += ' AND status = ?'; params.push(status); }
      if (type)   { sql += ' AND type = ?';   params.push(type); }
      if (search) { sql += ' AND (title LIKE ? OR id LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }
      sql += ' ORDER BY raised_at DESC';
      const rows = await db.prepare(sql).all(...params);
      db.close();
      return res.json(rows);
    }

    if (req.method === 'POST') {
      const { id, type, title, detail, clause, source, owner_id, due_date, root_cause, action, status, pct_complete, created_by } = req.body;
      if (!id || !title || !type || !status) return res.status(400).json({ error: 'id, title, type, status are required' });
      if (!['NCR','CAPA','Observation','Opportunity for Improvement'].includes(type)) return res.status(400).json({ error: 'Invalid type' });
      if (!['In Progress','Waiting for Approval','Approved & Closed','Overdue'].includes(status)) return res.status(400).json({ error: 'Invalid status' });

      const db = getDb();
      const existing = await db.prepare('SELECT id FROM capas WHERE id = ?').get(id);
      if (existing) { db.close(); return res.status(409).json({ error: 'CAPA ID already exists' }); }

      let owner = null;
      if (owner_id) { const user = await db.prepare('SELECT name FROM users WHERE id = ?').get(owner_id); if (user) owner = user.name; }

      await db.prepare(`INSERT INTO capas (id, type, title, detail, clause, source, owner, owner_id, due_date, root_cause, action, status, pct_complete, created_by, updated_by) VALUES (@id, @type, @title, @detail, @clause, @source, @owner, @owner_id, @due_date, @root_cause, @action, @status, @pct_complete, @created_by, @created_by)`)
        .run({ id, type, title, detail: detail || null, clause: clause || null, source: source || null, owner, owner_id: owner_id || null, due_date: due_date || null, root_cause: root_cause || null, action: action || null, status, pct_complete: pct_complete || 0, created_by: created_by || 'Unknown' });

      // Sync auto-numbering sequence
      const cfg = await getNumberingConfig(db, type);
      const escapedPrefix = (cfg.prefix || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const candidateSuffixes = cfg.rules.length > 0 ? cfg.rules.map(r => r.suffix || '') : [''];
      for (const suffix of candidateSuffixes) {
        const suffixPart = suffix ? `-${suffix}` : '';
        const escapedSuffix = suffixPart.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const pattern = new RegExp(`^${escapedPrefix}(\\d{3,})${escapedSuffix}$`);
        const match = pattern.exec(id);
        if (match) {
          const usedSeq = parseInt(match[1], 10);
          const seqRow = await db.prepare('SELECT last_seq FROM capa_seq WHERE record_type=? AND suffix=?').get(type, suffix);
          if (!seqRow) await db.prepare('INSERT INTO capa_seq (record_type, suffix, last_seq) VALUES (?,?,?)').run(type, suffix, usedSeq);
          else if (usedSeq > seqRow.last_seq) await db.prepare('UPDATE capa_seq SET last_seq=? WHERE record_type=? AND suffix=?').run(usedSeq, type, suffix);
          break;
        }
      }

      if (owner_id && String(owner_id) !== String(req.body.current_user_id || '')) {
        createNotification(db, { userId: owner_id, type: 'capa_assigned', title: `New ${type} assigned to you — ${id}`, message: title, link: '/capas', createdBy: created_by || 'System' });
      }

      const capa = await db.prepare('SELECT * FROM capas WHERE id = ?').get(id);
      db.close();
      return res.status(201).json(capa);
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
