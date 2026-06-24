import { ensureDb, getDb } from '../../../../../lib/db';

export default async function handler(req, res) {
  if (req.method !== 'PUT') return res.status(405).json({ error: 'Method not allowed' });
  const { id } = req.query;
  const { system_role } = req.body;
  if (!['admin','editor','viewer'].includes(system_role)) return res.status(400).json({ error: 'system_role must be admin, editor, or viewer' });
  try {
    await ensureDb();
    const db = getDb();
    db.prepare('UPDATE users SET system_role=? WHERE id=?').run(system_role, id);
    const user = db.prepare('SELECT * FROM users WHERE id=?').get(id);
    db.close();
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
