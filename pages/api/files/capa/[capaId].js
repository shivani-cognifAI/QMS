import { ensureDb, getDb } from '../../../../lib/db';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const { capaId } = req.query;
  try {
    await ensureDb();
    const db = getDb();
    const files = db.prepare(`SELECT * FROM document_files WHERE entity_type='capa' AND entity_id=? ORDER BY uploaded_at DESC`).all(capaId);
    db.close();
    res.json(files);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
