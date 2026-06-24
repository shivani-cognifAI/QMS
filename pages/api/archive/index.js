import { ensureDb, getDb } from '../../../lib/db';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  try {
    await ensureDb();
    const db = getDb();
    const { doc_id, type, standard, search } = req.query;
    let sql = 'SELECT * FROM archived_versions WHERE 1=1';
    const params = [];
    if (doc_id)   { sql += ' AND doc_id = ?';                           params.push(doc_id); }
    if (type)     { sql += ' AND type = ?';                             params.push(type); }
    if (standard) { sql += ' AND standard = ?';                         params.push(standard); }
    if (search)   { sql += ' AND (doc_title LIKE ? OR doc_id LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }
    sql += ' ORDER BY archived_at DESC';
    const rows = db.prepare(sql).all(...params);
    db.close();
    res.json(rows.map(r => ({ ...r, evidence: JSON.parse(r.evidence || '[]') })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
