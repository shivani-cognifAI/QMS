import { ensureDb, getDb } from '../../../lib/db';
import bcrypt from 'bcryptjs';
const { requireAuth } = require('../../../lib/auth');

async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { userId, newPassword, currentPassword } = req.body || {};
  if (!newPassword || newPassword.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

  const isSelf = !userId || Number(userId) === Number(req.user.id);
  const isAdmin = req.user.system_role === 'admin';

  if (!isSelf && !isAdmin) return res.status(403).json({ error: 'Admins only can set other users\' passwords' });

  try {
    await ensureDb();
    const db = getDb();
    const target = db.prepare('SELECT * FROM users WHERE id=?').get(userId || req.user.id);
    if (!target) { db.close(); return res.status(404).json({ error: 'User not found' }); }

    if (isSelf && !isAdmin) {
      if (!currentPassword) { db.close(); return res.status(400).json({ error: 'Current password required' }); }
      const valid = target.password_hash && await bcrypt.compare(currentPassword, target.password_hash);
      if (!valid) { db.close(); return res.status(401).json({ error: 'Current password is incorrect' }); }
    }

    const hash = await bcrypt.hash(newPassword, 10);
    db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hash, target.id);
    db.close();
    return res.json({ message: 'Password updated' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export default requireAuth(handler);
