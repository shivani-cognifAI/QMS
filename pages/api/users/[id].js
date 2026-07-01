import { ensureDb, getDb } from '../../../lib/db';
import bcrypt from 'bcryptjs';
const { requireAuth } = require('../../../lib/auth');

async function handler(req, res) {
  if (req.user.system_role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  const { id } = req.query;
  try {
    await ensureDb();

    if (req.method === 'PUT') {
      const { name, email, role, system_role, password } = req.body;
      if (!name || !email || !role) return res.status(400).json({ error: 'name, email, role are required' });
      const db = getDb();
      if (password) {
        const hash = await bcrypt.hash(password, 10);
        db.prepare('UPDATE users SET name=?,email=?,role=?,system_role=?,password_hash=? WHERE id=?').run(name, email, role, system_role || 'viewer', hash, id);
      } else {
        db.prepare('UPDATE users SET name=?,email=?,role=?,system_role=? WHERE id=?').run(name, email, role, system_role || 'viewer', id);
      }
      const user = db.prepare('SELECT id,name,email,role,system_role,created_at FROM users WHERE id=?').get(id);
      db.close();
      if (!user) return res.status(404).json({ error: 'User not found' });
      return res.json(user);
    }

    if (req.method === 'DELETE') {
      if (Number(id) === Number(req.user.id)) return res.status(400).json({ error: 'Cannot delete your own account' });
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

export default requireAuth(handler);
