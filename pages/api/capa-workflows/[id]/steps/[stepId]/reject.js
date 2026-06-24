import { ensureDb, getDb } from '../../../../../../lib/db';
const { createNotification } = require('../../../../../../lib/notify');

function advanceCapaWorkflow(db, workflowId) {
  const steps = db.prepare('SELECT * FROM capa_approval_steps WHERE workflow_id = ? ORDER BY step_order').all(workflowId);
  const wf    = db.prepare('SELECT * FROM capa_workflows WHERE id = ?').get(workflowId);
  const capa  = db.prepare('SELECT * FROM capas WHERE id = ?').get(wf.capa_id);
  const rejected = steps.find(s => s.status === 'Rejected');
  if (rejected) {
    db.prepare(`UPDATE capa_workflows SET status='Rejected', completed_at=datetime('now'), rejection_comment=? WHERE id=?`).run(rejected.comment, workflowId);
    db.prepare(`UPDATE capas SET approval_status='Rejected', updated_at=datetime('now') WHERE id=?`).run(wf.capa_id);
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
    const wf = db.prepare('SELECT * FROM capa_workflows WHERE id = ?').get(id);
    if (!wf) { db.close(); return res.status(404).json({ error: 'Workflow not found' }); }
    if (wf.status !== 'In Progress') { db.close(); return res.status(400).json({ error: 'Workflow is not active' }); }
    const step = db.prepare('SELECT * FROM capa_approval_steps WHERE id = ? AND workflow_id = ?').get(stepId, id);
    if (!step) { db.close(); return res.status(404).json({ error: 'Step not found' }); }
    if (step.status !== 'Awaiting') { db.close(); return res.status(400).json({ error: `Step is "${step.status}" — only Awaiting steps can be acted on` }); }
    db.transaction(() => {
      db.prepare(`UPDATE capa_approval_steps SET status='Rejected', comment=?, acted_at=datetime('now') WHERE id=?`).run(req.body.comment, step.id);
      db.prepare(`UPDATE capa_approval_steps SET status='Skipped' WHERE workflow_id=? AND status IN ('Pending','Awaiting') AND id != ?`).run(wf.id, step.id);
      advanceCapaWorkflow(db, wf.id);
    })();
    const updated = db.prepare('SELECT * FROM capa_workflows WHERE id = ?').get(wf.id);
    updated.steps = db.prepare('SELECT * FROM capa_approval_steps WHERE workflow_id = ? ORDER BY step_order').all(wf.id);
    db.close();
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
