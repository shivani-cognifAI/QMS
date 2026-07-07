import { ensureDb, getDb } from '../../../lib/db';
import bcrypt from 'bcryptjs';
const { signToken, setCookieHeader } = require('../../../lib/auth');

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });

  try {
    await ensureDb();
    const db = getDb();
    const user = await db.prepare('SELECT * FROM users WHERE lower(email)=lower(?)').get(email.trim());
    db.close();

    if (!user || !user.password_hash) return res.status(401).json({ error: 'Invalid email or password' });
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid email or password' });

    const payload = {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      system_role: user.system_role,
      must_change_password: user.must_change_password === 1,
    };
    const token = signToken(payload);
    res.setHeader('Set-Cookie', setCookieHeader(token));
    return res.json(payload);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
