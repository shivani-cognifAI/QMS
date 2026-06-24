import { ensureDb, getDb } from '../../../lib/db';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  try {
    await ensureDb();
    const db = getDb();
    const rows = db.prepare('SELECT DISTINCT type, COUNT(*) as count FROM documents GROUP BY type').all();
    db.close();
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
