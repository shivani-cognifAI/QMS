import { ensureDb, getDb } from '../../../lib/db';
import bcrypt from 'bcryptjs';
const { requireAuth } = require('../../../lib/auth');

async function handler(req, res) {
  try {
    await ensureDb();

    if (req.method === 'GET') {
      const db = getDb();
      const users = db.prepare('SELECT id,name,email,role,system_role,created_at FROM users ORDER BY name').all();
      db.close();
      return res.json(users);
    }

    if (req.method === 'POST') {
      if (req.user.system_role !== 'admin') return res.status(403).json({ error: 'Admin only' });
      const { name, email, role, system_role = 'viewer', password } = req.body;
      if (!name || !email || !role) return res.status(400).json({ error: 'name, email, role are required' });
      const db = getDb();
      const exists = db.prepare('SELECT id FROM users WHERE lower(email)=lower(?)').get(email);
      if (exists) { db.close(); return res.status(409).json({ error: 'Email already registered' }); }
      const password_hash = password ? await bcrypt.hash(password, 10) : null;
      const result = db.prepare('INSERT INTO users (name,email,role,system_role,password_hash) VALUES (?,?,?,?,?)').run(name, email, role, system_role, password_hash);
      const user = db.prepare('SELECT id,name,email,role,system_role,created_at FROM users WHERE id=?').get(result.lastInsertRowid);
      db.close();
      return res.status(201).json(user);
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export default requireAuth(handler);
