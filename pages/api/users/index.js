import { ensureDb, getDb } from '../../../lib/db';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
const { requireAuth } = require('../../../lib/auth');
const { sendOtpEmail } = require('../../../lib/email');

function generateOtp() {
  // 8 chars — uppercase letters + digits, no ambiguous chars (0,O,1,I,L)
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  return Array.from(crypto.randomBytes(8)).map(b => chars[b % chars.length]).join('');
}

async function handler(req, res) {
  try {
    await ensureDb();

    if (req.method === 'GET') {
      const db = getDb();
      const users = await db.prepare('SELECT id,name,email,role,system_role,must_change_password,created_at FROM users ORDER BY name').all();
      db.close();
      return res.json(users);
    }

    if (req.method === 'POST') {
      if (req.user.system_role !== 'admin') return res.status(403).json({ error: 'Admin only' });
      const { name, email, role, system_role = 'viewer' } = req.body;
      if (!name || !email || !role) return res.status(400).json({ error: 'name, email, role are required' });

      const db = getDb();
      const exists = await db.prepare('SELECT id FROM users WHERE lower(email)=lower(?)').get(email);
      if (exists) { db.close(); return res.status(409).json({ error: 'Email already registered' }); }

      const otp  = generateOtp();
      const hash = await bcrypt.hash(otp, 10);
      const result = await db.prepare(
        'INSERT INTO users (name,email,role,system_role,password_hash,must_change_password) VALUES (?,?,?,?,?,1)'
      ).run(name, email.trim().toLowerCase(), role, system_role, hash);
      const user = await db.prepare('SELECT id,name,email,role,system_role,must_change_password,created_at FROM users WHERE id=?').get(result.lastInsertRowid);
      db.close();

      // Send OTP email — non-blocking so the API responds fast
      sendOtpEmail({ to: email, name, otp }).catch(err =>
        console.error('OTP email failed:', err.message)
      );

      return res.status(201).json(user);
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export default requireAuth(handler);
