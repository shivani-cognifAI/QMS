import { ensureDb, getDb } from '../../lib/db';

export default async function handler(req, res) {
  try {
    await ensureDb();
    const db = getDb();
    db.prepare('SELECT 1').get();
    db.close();
    res.json({ status: 'ok' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
