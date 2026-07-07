import { ensureDb, getDb } from '../../../../lib/db';

export default async function handler(req, res) {
  if (req.method !== 'DELETE') return res.status(405).json({ error: 'Method not allowed' });
  const { docId, userId } = req.query;
  try {
    await ensureDb();
    const db = getDb();
    await db.prepare('DELETE FROM access_permissions WHERE doc_id=? AND user_id=?').run(docId, userId);
    db.close();
    res.json({ message: 'Permission revoked' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
