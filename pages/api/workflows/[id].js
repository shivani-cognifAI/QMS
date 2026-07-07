import { ensureDb, getDb } from '../../../lib/db';
const { createNotification } = require('../../../lib/notify');

async function getWorkflowFull(db, workflowId) {
  const wf = await db.prepare('SELECT * FROM workflows WHERE id = ?').get(workflowId);
  if (!wf) return null;
  wf.steps = await db.prepare('SELECT * FROM approval_steps WHERE workflow_id = ? ORDER BY step_order').all(workflowId);
  return wf;
}

export default async function handler(req, res) {
  const { id } = req.query;
  try {
    await ensureDb();

    if (req.method === 'GET') {
      const db = getDb();
      const wf = await getWorkflowFull(db, id);
      db.close();
      if (!wf) return res.status(404).json({ error: 'Workflow not found' });
      return res.json(wf);
    }

    if (req.method === 'DELETE') {
      const db = getDb();
      const wf = await db.prepare('SELECT * FROM workflows WHERE id = ?').get(id);
      if (!wf) { db.close(); return res.status(404).json({ error: 'Workflow not found' }); }
      if (!['In Progress','Pending'].includes(wf.status)) { db.close(); return res.status(400).json({ error: 'Only active workflows can be cancelled' }); }
      await db.transaction(async () => {
        await db.prepare(`UPDATE workflows SET status='Cancelled', completed_at=datetime('now') WHERE id=?`).run(wf.id);
        await db.prepare(`UPDATE documents SET status='Draft', updated_at=datetime('now') WHERE id=?`).run(wf.doc_id);
        await db.prepare(`INSERT INTO version_history (doc_id, version, author, change_note) VALUES (?,?,?,?)`).run(wf.doc_id, wf.doc_version, 'System', 'Approval workflow cancelled — document returned to Draft');
      });
      db.close();
      return res.json({ message: 'Workflow cancelled, document returned to Draft' });
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
