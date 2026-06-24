import { ensureDb, getDb } from '../../../lib/db';

export default async function handler(req, res) {
  const { id } = req.query;
  try {
    await ensureDb();

    if (req.method === 'PUT') {
      const { name, email, role } = req.body;
      if (!name || !email || !role) return res.status(400).json({ error: 'name, email, role are required' });
      const db = getDb();
      db.prepare('UPDATE users SET name=?, email=?, role=? WHERE id=?').run(name, email, role, id);
      const user = db.prepare('SELECT * FROM users WHERE id=?').get(id);
      db.close();
      if (!user) return res.status(404).json({ error: 'User not found' });
      return res.json(user);
    }

    if (req.method === 'DELETE') {
      const db = getDb();
      db.prepare('DELETE FROM users WHERE id=?').run(id);
      db.close();
      return res.json({ message: 'User deleted' });
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
