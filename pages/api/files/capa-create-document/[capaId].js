import { ensureDb, getDb } from '../../../../lib/db';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { capaId } = req.query;
  try {
    await ensureDb();
    const { title, content_html, file_category, uploaded_by } = req.body;
    if (!title || !title.trim()) return res.status(400).json({ error: 'Title is required' });
    const db = getDb();
    const capa = await db.prepare('SELECT id FROM capas WHERE id=?').get(capaId);
    if (!capa) { db.close(); return res.status(404).json({ error: 'CAPA record not found' }); }
    const html = content_html || '';
    await db.prepare(`INSERT INTO document_files (doc_id, filename, originalname, mimetype, size, file_hash, is_primary, file_category, content_html, uploaded_by, entity_type, entity_id) VALUES ('', '', ?, 'application/x-qms-document', ?, NULL, 0, ?, ?, ?, 'capa', ?)`).run(title.trim(), html.length, file_category || 'evidence', html, uploaded_by || 'System', capaId);
    const record = await db.prepare(`SELECT * FROM document_files WHERE entity_type='capa' AND entity_id=? ORDER BY id DESC LIMIT 1`).get(capaId);
    db.close();
    res.status(201).json(record);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
