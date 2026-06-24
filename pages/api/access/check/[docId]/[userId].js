import { ensureDb, getDb } from '../../../../../lib/db';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const { docId, userId } = req.query;
  try {
    await ensureDb();
    const db = getDb();
    const user = db.prepare('SELECT * FROM users WHERE id=?').get(userId);
    if (!user) { db.close(); return res.status(404).json({ error: 'User not found' }); }
    if (user.system_role === 'admin') { db.close(); return res.json({ permission: 'edit', reason: 'admin' }); }
    const perm = db.prepare('SELECT permission FROM access_permissions WHERE doc_id=? AND user_id=?').get(docId, userId);
    db.close();
    if (perm) return res.json({ permission: perm.permission });
    if (user.system_role === 'editor') return res.json({ permission: 'view', reason: 'editor-default' });
    return res.json({ permission: 'view', reason: 'default' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
