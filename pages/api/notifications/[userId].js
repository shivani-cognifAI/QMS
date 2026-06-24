import { ensureDb, getDb } from '../../../lib/db';

export default async function handler(req, res) {
  const { userId } = req.query;
  try {
    await ensureDb();

    if (req.method === 'GET') {
      const db = getDb();
      const rows = db.prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50').all(userId);
      db.close();
      return res.json(rows);
    }

    if (req.method === 'DELETE') {
      // DELETE /api/notifications/:id — delete a single notification
      const db = getDb();
      db.prepare('DELETE FROM notifications WHERE id = ?').run(userId);
      db.close();
      return res.json({ message: 'Notification deleted' });
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
