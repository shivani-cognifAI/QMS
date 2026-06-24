import { ensureDb, getDb } from '../../../../../../lib/db';
const { createNotification } = require('../../../../../../lib/notify');

function getWorkflowFull(db, workflowId) {
  const wf = db.prepare('SELECT * FROM workflows WHERE id = ?').get(workflowId);
  if (!wf) return null;
  wf.steps = db.prepare('SELECT * FROM approval_steps WHERE workflow_id = ? ORDER BY step_order').all(workflowId);
  return wf;
}

function advanceWorkflow(db, workflowId) {
  const steps = db.prepare('SELECT * FROM approval_steps WHERE workflow_id = ? ORDER BY step_order').all(workflowId);
  const wf    = db.prepare('SELECT * FROM workflows WHERE id = ?').get(workflowId);
  const doc   = db.prepare('SELECT * FROM documents WHERE id = ?').get(wf.doc_id);
  const isRetirement = wf.purpose === 'retirement';
  const rejected = steps.find(s => s.status === 'Rejected');
  if (rejected) {
    db.prepare(`UPDATE workflows SET status='Rejected', completed_at=datetime('now'), rejection_comment=? WHERE id=?`).run(rejected.comment, workflowId);
    db.prepare(`UPDATE documents SET status=?, updated_at=datetime('now') WHERE id=?`).run(isRetirement ? 'Approved' : 'Draft', wf.doc_id);
    db.prepare(`INSERT INTO version_history (doc_id, version, author, change_note) VALUES (?,?,?,?)`).run(wf.doc_id, doc.version, rejected.approver_name, `${isRetirement ? 'Retirement request' : 'Submission'} rejected at step ${rejected.step_order}: ${rejected.comment || 'No comment provided'}`);
    if (doc && doc.owner_id) createNotification(db, { userId: doc.owner_id, type: 'document_rejected', title: `${wf.doc_id} was rejected`, message: rejected.comment || 'No comment provided.', link: '/documents', createdBy: rejected.approver_name });
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { id, stepId } = req.query;
  if (!req.body.comment) return res.status(400).json({ error: 'Rejection comment is required' });
  try {
    await ensureDb();
    const db = getDb();
    const wf = db.prepare('SELECT * FROM workflows WHERE id = ?').get(id);
    if (!wf) { db.close(); return res.status(404).json({ error: 'Workflow not found' }); }
    if (wf.status !== 'In Progress') { db.close(); return res.status(400).json({ error: 'Workflow is not active' }); }
    const step = db.prepare('SELECT * FROM approval_steps WHERE id = ? AND workflow_id = ?').get(stepId, id);
    if (!step) { db.close(); return res.status(404).json({ error: 'Step not found' }); }
    if (step.status !== 'Awaiting') { db.close(); return res.status(400).json({ error: `Step is "${step.status}" — only Awaiting steps can be acted on` }); }
    db.transaction(() => {
      db.prepare(`UPDATE approval_steps SET status='Rejected', comment=?, acted_at=datetime('now') WHERE id=?`).run(req.body.comment, step.id);
      db.prepare(`UPDATE approval_steps SET status='Skipped' WHERE workflow_id=? AND status IN ('Pending','Awaiting') AND id != ?`).run(wf.id, step.id);
      advanceWorkflow(db, wf.id);
    })();
    const updated = getWorkflowFull(db, wf.id);
    db.close();
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
