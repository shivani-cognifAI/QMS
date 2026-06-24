import { ensureDb, getDb } from '../../../../lib/db';

function isWordFile(mimetype = '', originalname = '') {
  const ext = (originalname || '').toLowerCase();
  return ext.endsWith('.doc') || ext.endsWith('.docx') || mimetype.includes('word') || mimetype.includes('msword');
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { docId } = req.query;
  try {
    await ensureDb();
    const db = getDb();
    const files = db.prepare('SELECT * FROM document_files WHERE doc_id=?').all(docId);
    db.prepare('UPDATE document_files SET is_primary=0 WHERE doc_id=?').run(docId);
    const wordFile = files.filter(f => isWordFile(f.mimetype, f.originalname)).sort((a, b) => new Date(b.uploaded_at) - new Date(a.uploaded_at))[0];
    if (wordFile) db.prepare('UPDATE document_files SET is_primary=1 WHERE id=?').run(wordFile.id);
    const updated = db.prepare('SELECT * FROM document_files WHERE doc_id=? ORDER BY is_primary DESC, uploaded_at DESC').all(docId);
    db.close();
    res.json({ fixed: wordFile ? 1 : 0, files: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
