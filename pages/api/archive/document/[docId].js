import { ensureDb, getDb } from '../../../../lib/db';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const { docId } = req.query;
  try {
    await ensureDb();
    const db = getDb();
    const rows = await db.prepare('SELECT * FROM archived_versions WHERE doc_id = ? ORDER BY archived_at DESC').all(docId);
    db.close();
    res.json(rows.map(r => ({ ...r, evidence: JSON.parse(r.evidence || '[]') })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
