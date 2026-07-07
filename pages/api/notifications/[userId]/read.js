import { ensureDb, getDb } from '../../../../lib/db';

export default async function handler(req, res) {
  if (req.method !== 'PUT') return res.status(405).json({ error: 'Method not allowed' });
  // PUT /api/notifications/:id/read — mark a single notification as read
  const { userId } = req.query; // userId here is actually the notification id
  try {
    await ensureDb();
    const db = getDb();
    await db.prepare('UPDATE notifications SET is_read = 1 WHERE id = ?').run(userId);
    db.close();
    res.json({ message: 'Marked as read' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
