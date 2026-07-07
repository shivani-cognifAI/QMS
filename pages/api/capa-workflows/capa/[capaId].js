import { ensureDb, getDb } from '../../../../lib/db';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const { capaId } = req.query;
  try {
    await ensureDb();
    const db = getDb();
    const wf = await db.prepare('SELECT * FROM capa_workflows WHERE capa_id = ? ORDER BY id DESC LIMIT 1').get(capaId);
    if (!wf) { db.close(); return res.json(null); }
    wf.steps = await db.prepare('SELECT * FROM capa_approval_steps WHERE workflow_id = ? ORDER BY step_order').all(wf.id);
    db.close();
    res.json(wf);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
