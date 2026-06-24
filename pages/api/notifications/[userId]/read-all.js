import { ensureDb, getDb } from '../../../../lib/db';

export default async function handler(req, res) {
  if (req.method !== 'PUT') return res.status(405).json({ error: 'Method not allowed' });
  const { userId } = req.query;
  try {
    await ensureDb();
    const db = getDb();
    db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ?').run(userId);
    db.close();
    res.json({ message: 'All marked as read' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
