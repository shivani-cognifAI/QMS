import { ensureDb, getDb } from '../../../lib/db';
const { createNotification } = require('../../../lib/notify');
const { getDocumentTypes } = require('../../../lib/documentTypes');

export default async function handler(req, res) {
  try {
    await ensureDb();

    if (req.method === 'GET') {
      const db = getDb();
      const { type, status, standard, search } = req.query;
      let sql = 'SELECT * FROM documents WHERE 1=1';
      const params = [];
      if (type)     { sql += ' AND type = ?';     params.push(type); }
      if (status)   { sql += ' AND status = ?';   params.push(status); }
      if (standard) { sql += ' AND standard = ?'; params.push(standard); }
      if (search)   { sql += ' AND (title LIKE ? OR id LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }
      sql += ' ORDER BY id ASC';
      const rows = db.prepare(sql).all(...params);
      db.close();
      return res.json(rows.map(r => ({ ...r, evidence: JSON.parse(r.evidence || '[]') })));
    }

    if (req.method === 'POST') {
      const db = getDb();
      const { id, title, type, standard, clause, version, status, owner_id, review_date, scope, evidence, change_note, created_by } = req.body;

      if (!id || !title || !type || !standard || !status) {
        db.close();
        return res.status(400).json({ error: 'id, title, type, standard, status are required' });
      }
      const validTypes = getDocumentTypes(db);
      if (!validTypes.includes(type)) { db.close(); return res.status(400).json({ error: `Invalid type` }); }
      if (!['ISO 9001','ISO 27001','Both'].includes(standard)) { db.close(); return res.status(400).json({ error: 'Invalid standard' }); }
      if (!['Draft','Under Review','Approved','Retired'].includes(status)) { db.close(); return res.status(400).json({ error: 'Invalid status' }); }

      const existing = db.prepare('SELECT id FROM documents WHERE id = ?').get(id);
      if (existing) { db.close(); return res.status(409).json({ error: 'Document ID already exists' }); }

      let owner = null;
      if (owner_id) {
        const user = db.prepare('SELECT name FROM users WHERE id = ?').get(owner_id);
        if (user) owner = user.name;
      }

      const version_date = status === 'Approved'
        ? new Date().toISOString().replace('T', ' ').slice(0, 19) : null;

      db.prepare(`
        INSERT INTO documents (id, title, type, standard, clause, version, version_date, status, owner, owner_id, review_date, scope, evidence, created_by, updated_by)
        VALUES (@id, @title, @type, @standard, @clause, @version, @version_date, @status, @owner, @owner_id, @review_date, @scope, @evidence, @created_by, @created_by)
      `).run({ id, title, type, standard, clause: clause || null, version: version || '1.0', version_date, status: status || 'Draft', owner, owner_id: owner_id || null, review_date: review_date || null, scope: scope || null, evidence: JSON.stringify(evidence || []), created_by: created_by || 'Unknown' });

      db.prepare(`INSERT INTO version_history (doc_id, version, author, change_note) VALUES (?, ?, ?, ?)`)
        .run(id, version || '1.0', created_by || owner || 'System', change_note || `Initial version v${version || '1.0'}`);

      if (owner_id) {
        createNotification(db, { userId: owner_id, type: 'document_assigned', title: `New document assigned to you — ${id}`, message: title, link: '/documents', createdBy: created_by || 'System' });
      }

      const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(id);
      db.close();
      return res.status(201).json({ ...doc, evidence: JSON.parse(doc.evidence || '[]') });
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
