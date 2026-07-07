import { ensureDb, getDb } from '../../../../lib/db';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const { userId } = req.query;
  try {
    await ensureDb();
    const db = getDb();
    const steps = await db.prepare(`
      SELECT s.*, w.capa_id, w.submitted_by, w.created_at as wf_created,
             c.title as capa_title, c.type as capa_type, c.clause as capa_clause
      FROM capa_approval_steps s
      JOIN capa_workflows w ON s.workflow_id = w.id
      JOIN capas c ON w.capa_id = c.id
      WHERE s.approver_id = ? AND s.status = 'Awaiting' AND w.status = 'In Progress'
      ORDER BY w.created_at ASC
    `).all(userId);
    db.close();
    res.json(steps);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
