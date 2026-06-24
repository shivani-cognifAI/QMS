import { ensureDb, getDb } from '../../../../lib/db';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const { userId } = req.query;
  try {
    await ensureDb();
    const db = getDb();
    const row = db.prepare('SELECT COUNT(*) as n FROM notifications WHERE user_id = ? AND is_read = 0').get(userId);
    db.close();
    res.json({ count: row ? row.n : 0 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
