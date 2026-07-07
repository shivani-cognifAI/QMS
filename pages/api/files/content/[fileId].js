import { ensureDb, getDb } from '../../../../lib/db';

export default async function handler(req, res) {
  if (req.method !== 'PUT') return res.status(405).json({ error: 'Method not allowed' });
  const { fileId } = req.query;
  try {
    await ensureDb();
    const { title, content_html } = req.body;
    const db = getDb();
    const file = await db.prepare('SELECT * FROM document_files WHERE id=?').get(fileId);
    if (!file) { db.close(); return res.status(404).json({ error: 'File not found' }); }
    if (file.mimetype !== 'application/x-qms-document') { db.close(); return res.status(400).json({ error: 'Only created documents can be edited this way' }); }
    const html = content_html !== undefined ? content_html : file.content_html;
    await db.prepare(`UPDATE document_files SET originalname=?, content_html=?, size=? WHERE id=?`).run(title?.trim() || file.originalname, html, (html || '').length, fileId);
    const updated = await db.prepare('SELECT * FROM document_files WHERE id=?').get(fileId);
    db.close();
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
