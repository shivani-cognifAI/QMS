import { ensureDb, getDb } from '../../../lib/db';

export default async function handler(req, res) {
  const { docId } = req.query;
  try {
    await ensureDb();

    if (req.method === 'GET') {
      const db = getDb();
      const perms = await db.prepare(`SELECT ap.*, u.name as user_name, u.email, u.role as user_role, u.system_role FROM access_permissions ap JOIN users u ON ap.user_id = u.id WHERE ap.doc_id = ? ORDER BY ap.permission DESC, u.name ASC`).all(docId);
      db.close();
      return res.json(perms);
    }

    if (req.method === 'POST') {
      const { user_id, permission, granted_by } = req.body;
      if (!user_id || !permission) return res.status(400).json({ error: 'user_id and permission required' });
      if (!['view','edit'].includes(permission)) return res.status(400).json({ error: 'permission must be view or edit' });
      const db = getDb();
      const existing = await db.prepare('SELECT id FROM access_permissions WHERE doc_id=? AND user_id=?').get(docId, user_id);
      if (existing) await db.prepare('UPDATE access_permissions SET permission=?, granted_by=?, granted_at=datetime("now") WHERE id=?').run(permission, granted_by || 'System', existing.id);
      else          await db.prepare('INSERT INTO access_permissions (doc_id, user_id, permission, granted_by) VALUES (?,?,?,?)').run(docId, user_id, permission, granted_by || 'System');
      const perms = await db.prepare(`SELECT ap.*, u.name as user_name, u.email, u.role as user_role FROM access_permissions ap JOIN users u ON ap.user_id = u.id WHERE ap.doc_id = ? ORDER BY ap.permission DESC, u.name ASC`).all(docId);
      db.close();
      return res.json(perms);
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
