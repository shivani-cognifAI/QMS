import { ensureDb, getDb } from '../../../lib/db';

export default async function handler(req, res) {
  const { id } = req.query;
  try {
    await ensureDb();

    if (req.method === 'GET') {
      const db = getDb();
      const wf = await db.prepare('SELECT * FROM capa_workflows WHERE id = ?').get(id);
      if (!wf) { db.close(); return res.status(404).json({ error: 'Workflow not found' }); }
      wf.steps = await db.prepare('SELECT * FROM capa_approval_steps WHERE workflow_id = ? ORDER BY step_order').all(id);
      db.close();
      return res.json(wf);
    }

    if (req.method === 'DELETE') {
      const db = getDb();
      const wf = await db.prepare('SELECT * FROM capa_workflows WHERE id = ?').get(id);
      if (!wf) { db.close(); return res.status(404).json({ error: 'Workflow not found' }); }
      await db.transaction(async () => {
        await db.prepare(`UPDATE capa_workflows SET status='Cancelled', completed_at=datetime('now') WHERE id=?`).run(wf.id);
        await db.prepare(`UPDATE capas SET approval_status='Not Submitted', updated_at=datetime('now') WHERE id=?`).run(wf.capa_id);
      });
      db.close();
      return res.json({ message: 'Workflow cancelled' });
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
