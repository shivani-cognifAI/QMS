import { ensureDb, getDb } from '../../../lib/db';
import bcrypt from 'bcryptjs';
const { requireAuth, signToken, setCookieHeader } = require('../../../lib/auth');

async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { newPassword } = req.body || {};
  if (!newPassword || newPassword.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

  try {
    await ensureDb();
    const db = getDb();
    const hash = await bcrypt.hash(newPassword, 10);
    await db.prepare('UPDATE users SET password_hash=?, must_change_password=0 WHERE id=?').run(hash, req.user.id);
    const user = await db.prepare('SELECT id,name,email,role,system_role FROM users WHERE id=?').get(req.user.id);
    db.close();

    // Issue a fresh token with must_change_password cleared
    const payload = { id: user.id, name: user.name, email: user.email, role: user.role, system_role: user.system_role, must_change_password: false };
    const token = signToken(payload);
    res.setHeader('Set-Cookie', setCookieHeader(token));
    return res.json(payload);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export default requireAuth(handler);
