import { ensureDb, getDb } from '../../../lib/db';

export default async function handler(req, res) {
  const { id } = req.query;
  try {
    await ensureDb();

    if (req.method === 'GET') {
      const db = getDb();
      const row = db.prepare('SELECT * FROM archived_versions WHERE id = ?').get(id);
      db.close();
      if (!row) return res.status(404).json({ error: 'Archived version not found' });
      return res.json({ ...row, evidence: JSON.parse(row.evidence || '[]') });
    }

    if (req.method === 'DELETE') {
      const db = getDb();
      const row = db.prepare('SELECT id FROM archived_versions WHERE id = ?').get(id);
      if (!row) { db.close(); return res.status(404).json({ error: 'Archived version not found' }); }
      db.prepare('DELETE FROM archived_versions WHERE id = ?').run(id);
      db.close();
      return res.json({ message: 'Archived version permanently deleted' });
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
