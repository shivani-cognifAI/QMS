import { ensureDb, getDb } from '../../../lib/db';

export default async function handler(req, res) {
  try {
    await ensureDb();

    if (req.method === 'GET') {
      const db = getDb();
      const users = db.prepare('SELECT * FROM users ORDER BY name').all();
      db.close();
      return res.json(users);
    }

    if (req.method === 'POST') {
      const { name, email, role } = req.body;
      if (!name || !email || !role) return res.status(400).json({ error: 'name, email, role are required' });
      const db = getDb();
      const exists = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
      if (exists) { db.close(); return res.status(409).json({ error: 'Email already registered' }); }
      const result = db.prepare('INSERT INTO users (name, email, role) VALUES (?, ?, ?)').run(name, email, role);
      const user = db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);
      db.close();
      return res.status(201).json(user);
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
