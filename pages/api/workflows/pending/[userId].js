import { ensureDb, getDb } from '../../../../lib/db';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const { userId } = req.query;
  try {
    await ensureDb();
    const db = getDb();
    const steps = db.prepare(`
      SELECT s.*, w.doc_id, w.doc_version, w.submitted_by, w.created_at as wf_created, w.purpose,
             d.title as doc_title, d.type as doc_type, d.standard as doc_standard
      FROM approval_steps s
      JOIN workflows w ON s.workflow_id = w.id
      JOIN documents d ON w.doc_id = d.id
      WHERE s.approver_id = ? AND s.status = 'Awaiting' AND w.status = 'In Progress'
      ORDER BY w.created_at ASC
    `).all(userId);
    db.close();
    res.json(steps);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
