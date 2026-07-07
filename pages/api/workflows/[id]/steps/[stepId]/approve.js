import { ensureDb, getDb } from '../../../../../../lib/db';
const { createNotification } = require('../../../../../../lib/notify');

async function getWorkflowFull(db, workflowId) {
  const wf = await db.prepare('SELECT * FROM workflows WHERE id = ?').get(workflowId);
  if (!wf) return null;
  wf.steps = await db.prepare('SELECT * FROM approval_steps WHERE workflow_id = ? ORDER BY step_order').all(workflowId);
  return wf;
}

async function advanceWorkflow(db, workflowId) {
  const steps = await db.prepare('SELECT * FROM approval_steps WHERE workflow_id = ? ORDER BY step_order').all(workflowId);
  const wf    = await db.prepare('SELECT * FROM workflows WHERE id = ?').get(workflowId);
  const doc   = await db.prepare('SELECT * FROM documents WHERE id = ?').get(wf.doc_id);
  const isRetirement = wf.purpose === 'retirement';

  const rejected = steps.find(s => s.status === 'Rejected');
  if (rejected) {
    await db.prepare(`UPDATE workflows SET status='Rejected', completed_at=datetime('now'), rejection_comment=? WHERE id=?`).run(rejected.comment, workflowId);
    await db.prepare(`UPDATE documents SET status=?, updated_at=datetime('now') WHERE id=?`).run(isRetirement ? 'Approved' : 'Draft', wf.doc_id);
    await db.prepare(`INSERT INTO version_history (doc_id, version, author, change_note) VALUES (?,?,?,?)`).run(wf.doc_id, doc.version, rejected.approver_name, `${isRetirement ? 'Retirement request' : 'Submission'} rejected at step ${rejected.step_order}: ${rejected.comment || 'No comment provided'}`);
    if (doc && doc.owner_id) createNotification(db, { userId: doc.owner_id, type: 'document_rejected', title: `${wf.doc_id} ${isRetirement ? 'retirement was rejected' : 'was rejected'}`, message: rejected.comment || 'No comment provided.', link: '/documents', createdBy: rejected.approver_name });
    return;
  }

  const allApproved = steps.every(s => s.status === 'Approved');
  if (allApproved) {
    const approvedDate = new Date().toISOString().replace('T', ' ').slice(0, 19);
    const allApprovers = steps.map(s => s.approver_name).join(', ');
    await db.prepare(`UPDATE workflows SET status='Approved', completed_at=datetime('now') WHERE id=?`).run(workflowId);

    if (isRetirement) {
      await db.prepare(`UPDATE documents SET status='Retired', updated_at=datetime('now') WHERE id=?`).run(wf.doc_id);
      await db.prepare(`INSERT INTO archived_versions (doc_id, doc_title, version, version_date, status, type, standard, clause, owner, review_date, scope, evidence, archived_at, archived_by, workflow_id, change_note) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'),?,?,?)`).run(doc.id, doc.title, doc.version, doc.version_date, 'Retired', doc.type, doc.standard, doc.clause, doc.owner, doc.review_date, doc.scope, doc.evidence, allApprovers, workflowId, `Document retired via approval workflow (${steps.length} approver${steps.length > 1 ? 's' : ''}: ${allApprovers}).`);
      await db.prepare(`INSERT INTO version_history (doc_id, version, author, approved_by, change_note) VALUES (?,?,?,?,?)`).run(wf.doc_id, doc.version, wf.submitted_by, allApprovers, `Retirement approved via workflow. Document retired at v${doc.version}, effective ${approvedDate} (UTC). This document is now locked.`);
      if (doc && doc.owner_id) createNotification(db, { userId: doc.owner_id, type: 'document_retired', title: `${wf.doc_id} retirement was approved`, message: `${doc.title} is now Retired and locked.`, link: '/documents', createdBy: allApprovers });
      return;
    }

    await db.prepare(`UPDATE documents SET status='Approved', version_date=?, updated_at=datetime('now') WHERE id=?`).run(approvedDate, wf.doc_id);
    await db.prepare(`INSERT INTO version_history (doc_id, version, author, approved_by, change_note) VALUES (?,?,?,?,?)`).run(wf.doc_id, doc.version, wf.submitted_by, allApprovers, `Approved via sequential workflow (${steps.length} approver${steps.length > 1 ? 's' : ''}). Document approved at v${doc.version}, effective ${approvedDate} (UTC).`);
    await db.prepare(`UPDATE version_history SET approved_by = ? WHERE id = (SELECT id FROM version_history WHERE doc_id = ? AND version = ? AND change_note NOT LIKE 'Submitted for sequential approval%' AND change_note NOT LIKE 'Approved via sequential workflow%' AND change_note NOT LIKE 'Rejected at step%' ORDER BY changed_at DESC LIMIT 1)`).run(allApprovers, wf.doc_id, doc.version);
    if (doc && doc.owner_id) createNotification(db, { userId: doc.owner_id, type: 'document_approved', title: `${wf.doc_id} was approved`, message: doc.title, link: '/documents', createdBy: allApprovers });
    return;
  }

  const nextPending = steps.find(s => s.status === 'Pending');
  if (nextPending) {
    await db.prepare(`UPDATE approval_steps SET status='Awaiting' WHERE id=?`).run(nextPending.id);
    createNotification(db, { userId: nextPending.approver_id, type: 'document_approval_requested', title: `Approval requested — ${wf.doc_id}`, message: doc ? doc.title : null, link: '/workflows', createdBy: wf.submitted_by });
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { id, stepId } = req.query;
  try {
    await ensureDb();
    const db = getDb();
    const wf = await db.prepare('SELECT * FROM workflows WHERE id = ?').get(id);
    if (!wf) { db.close(); return res.status(404).json({ error: 'Workflow not found' }); }
    if (wf.status !== 'In Progress') { db.close(); return res.status(400).json({ error: 'Workflow is not active' }); }
    const step = await db.prepare('SELECT * FROM approval_steps WHERE id = ? AND workflow_id = ?').get(stepId, id);
    if (!step) { db.close(); return res.status(404).json({ error: 'Step not found' }); }
    if (step.status !== 'Awaiting') { db.close(); return res.status(400).json({ error: `Step is "${step.status}" — only Awaiting steps can be acted on` }); }
    await db.transaction(async () => {
      await db.prepare(`UPDATE approval_steps SET status='Approved', comment=?, acted_at=datetime('now') WHERE id=?`).run(req.body.comment || null, step.id);
      await advanceWorkflow(db, wf.id);
    });
    const updated = await getWorkflowFull(db, wf.id);
    db.close();
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
