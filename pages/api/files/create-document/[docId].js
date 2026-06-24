import { ensureDb, getDb } from '../../../../lib/db';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { docId } = req.query;
  try {
    await ensureDb();
    const { title, content_html, file_category, uploaded_by } = req.body;
    if (!title || !title.trim()) return res.status(400).json({ error: 'Title is required' });
    if (!['supporting','evidence'].includes(file_category)) return res.status(400).json({ error: 'file_category must be "supporting" or "evidence"' });
    const db = getDb();
    const doc = db.prepare('SELECT id FROM documents WHERE id=?').get(docId);
    if (!doc) { db.close(); return res.status(404).json({ error: 'Document not found' }); }
    const html = content_html || '';
    db.prepare(`INSERT INTO document_files (doc_id, filename, originalname, mimetype, size, file_hash, is_primary, file_category, content_html, uploaded_by) VALUES (?, '', ?, 'application/x-qms-document', ?, NULL, 0, ?, ?, ?)`).run(docId, title.trim(), html.length, file_category, html, uploaded_by || 'System');
    const record = db.prepare('SELECT * FROM document_files WHERE doc_id=? ORDER BY id DESC LIMIT 1').get(docId);
    db.close();
    res.status(201).json(record);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
