import { ensureDb, getDb } from '../../../../../../lib/db';
const { createNotification } = require('../../../../../../lib/notify');

async function advanceCapaWorkflow(db, workflowId) {
  const steps = await db.prepare('SELECT * FROM capa_approval_steps WHERE workflow_id = ? ORDER BY step_order').all(workflowId);
  const wf    = await db.prepare('SELECT * FROM capa_workflows WHERE id = ?').get(workflowId);
  const capa  = await db.prepare('SELECT * FROM capas WHERE id = ?').get(wf.capa_id);
  const rejected = steps.find(s => s.status === 'Rejected');
  if (rejected) {
    await db.prepare(`UPDATE capa_workflows SET status='Rejected', completed_at=datetime('now'), rejection_comment=? WHERE id=?`).run(rejected.comment, workflowId);
    await db.prepare(`UPDATE capas SET approval_status='Rejected', updated_at=datetime('now') WHERE id=?`).run(wf.capa_id);
    if (capa && capa.owner_id) createNotification(db, { userId: capa.owner_id, type: 'capa_rejected', title: `${wf.capa_id} was rejected`, message: rejected.comment || 'No comment provided.', link: '/capas', createdBy: rejected.approver_name });
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { id, stepId } = req.query;
  if (!req.body.comment) return res.status(400).json({ error: 'Rejection comment is required' });
  try {
    await ensureDb();
    const db = getDb();
    const wf = await db.prepare('SELECT * FROM capa_workflows WHERE id = ?').get(id);
    if (!wf) { db.close(); return res.status(404).json({ error: 'Workflow not found' }); }
    if (wf.status !== 'In Progress') { db.close(); return res.status(400).json({ error: 'Workflow is not active' }); }
    const step = await db.prepare('SELECT * FROM capa_approval_steps WHERE id = ? AND workflow_id = ?').get(stepId, id);
    if (!step) { db.close(); return res.status(404).json({ error: 'Step not found' }); }
    if (step.status !== 'Awaiting') { db.close(); return res.status(400).json({ error: `Step is "${step.status}" — only Awaiting steps can be acted on` }); }
    await db.transaction(async () => {
      await db.prepare(`UPDATE capa_approval_steps SET status='Rejected', comment=?, acted_at=datetime('now') WHERE id=?`).run(req.body.comment, step.id);
      await db.prepare(`UPDATE capa_approval_steps SET status='Skipped' WHERE workflow_id=? AND status IN ('Pending','Awaiting') AND id != ?`).run(wf.id, step.id);
      await advanceCapaWorkflow(db, wf.id);
    });
    const updated = await db.prepare('SELECT * FROM capa_workflows WHERE id = ?').get(wf.id);
    updated.steps = await db.prepare('SELECT * FROM capa_approval_steps WHERE workflow_id = ? ORDER BY step_order').all(wf.id);
    db.close();
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
