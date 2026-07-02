import { ensureDb, getDb } from '../../../lib/db';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
const { requireAuth } = require('../../../lib/auth');
const { sendPasswordResetEmail } = require('../../../lib/email');

function generateOtp() {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  return Array.from(crypto.randomBytes(8)).map(b => chars[b % chars.length]).join('');
}

async function handler(req, res) {
  if (req.user.system_role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  const { id } = req.query;
  try {
    await ensureDb();

    if (req.method === 'PUT') {
      const { name, email, role, system_role } = req.body;
      if (!name || !email || !role) return res.status(400).json({ error: 'name, email, role are required' });
      const db = getDb();
      db.prepare('UPDATE users SET name=?,email=?,role=?,system_role=? WHERE id=?')
        .run(name, email, role, system_role || 'viewer', id);
      const user = db.prepare('SELECT id,name,email,role,system_role,must_change_password,created_at FROM users WHERE id=?').get(id);
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

    // POST /api/users/[id] — admin resets password, sends new OTP via email
    if (req.method === 'POST') {
      const db = getDb();
      const user = db.prepare('SELECT * FROM users WHERE id=?').get(id);
      if (!user) { db.close(); return res.status(404).json({ error: 'User not found' }); }
      const otp  = generateOtp();
      const hash = await bcrypt.hash(otp, 10);
      db.prepare('UPDATE users SET password_hash=?,must_change_password=1 WHERE id=?').run(hash, id);
      db.close();
      sendPasswordResetEmail({ to: user.email, name: user.name, otp }).catch(err =>
        console.error('Reset email failed:', err.message)
      );
      return res.json({ message: 'Password reset — OTP sent to user email' });
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export default requireAuth(handler);
