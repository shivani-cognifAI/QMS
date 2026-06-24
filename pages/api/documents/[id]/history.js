import { ensureDb, getDb } from '../../../../lib/db';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const { id } = req.query;
  try {
    await ensureDb();
    const db = getDb();
    const history = db.prepare('SELECT * FROM version_history WHERE doc_id = ? ORDER BY changed_at DESC').all(id);
    db.close();
    res.json(history);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
