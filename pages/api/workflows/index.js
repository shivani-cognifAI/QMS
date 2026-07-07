import { ensureDb, getDb } from '../../../lib/db';
const { createNotification } = require('../../../lib/notify');

export default async function handler(req, res) {
  try {
    await ensureDb();

    if (req.method === 'GET') {
      const db = getDb();
      const { doc_id, status } = req.query;
      let sql = 'SELECT * FROM workflows WHERE 1=1';
      const params = [];
      if (doc_id) { sql += ' AND doc_id = ?'; params.push(doc_id); }
      if (status) { sql += ' AND status = ?'; params.push(status); }
      sql += ' ORDER BY created_at DESC';
      const workflows = await db.prepare(sql).all(...params);
      for (const wf of workflows) {
        wf.steps = await db.prepare('SELECT * FROM approval_steps WHERE workflow_id = ? ORDER BY step_order').all(wf.id);
      }
      db.close();
      return res.json(workflows);
    }

    if (req.method === 'POST') {
      const { doc_id, submitted_by, approver_ids } = req.body;
      const purpose = req.body.purpose || 'approval';
      if (!doc_id || !submitted_by || !Array.isArray(approver_ids) || approver_ids.length < 1) {
        return res.status(400).json({ error: 'doc_id, submitted_by, approver_ids (min 1) are required' });
      }
      if (!['approval','retirement'].includes(purpose)) return res.status(400).json({ error: 'Invalid purpose' });

      const db = getDb();
      const doc = await db.prepare('SELECT * FROM documents WHERE id = ?').get(doc_id);
      if (!doc) { db.close(); return res.status(404).json({ error: 'Document not found' }); }

      if (purpose === 'retirement') {
        if (doc.status !== 'Approved') { db.close(); return res.status(400).json({ error: `Cannot submit "${doc.status}" document for retirement.` }); }
      } else if (!['Draft','Rejected'].includes(doc.status)) {
        db.close(); return res.status(400).json({ error: `Cannot submit a document with status "${doc.status}".` });
      }

      for (const aid of approver_ids) {
        const user = await db.prepare('SELECT id FROM users WHERE id = ?').get(aid);
        if (!user) { db.close(); return res.status(400).json({ error: `User ID ${aid} not found` }); }
      }

      let newWorkflowId;
      await db.transaction(async () => {
        await db.prepare(`UPDATE documents SET status='Under Review', updated_at=datetime('now') WHERE id=?`).run(doc_id);
        const wfResult = await db.prepare(`INSERT INTO workflows (doc_id, doc_version, submitted_by, status, purpose) VALUES (?, ?, ?, 'In Progress', ?)`).run(doc_id, doc.version, submitted_by, purpose);
        newWorkflowId = wfResult.lastInsertRowid;
        for (const [idx, aid] of approver_ids.entries()) {
          const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(aid);
          const stepStatus = idx === 0 ? 'Awaiting' : 'Pending';
          await db.prepare(`INSERT INTO approval_steps (workflow_id, step_order, approver_id, approver_name, status) VALUES (?, ?, ?, ?, ?)`).run(newWorkflowId, idx + 1, aid, user.name, stepStatus);
        }
        const submitNote = purpose === 'retirement'
          ? `Submitted for retirement approval — ${approver_ids.length} approver(s) assigned`
          : `Submitted for sequential approval — ${approver_ids.length} approver(s) assigned`;
        await db.prepare(`INSERT INTO version_history (doc_id, version, author, change_note) VALUES (?,?,?,?)`).run(doc_id, doc.version, submitted_by, submitNote);
      });

      const workflow = await db.prepare('SELECT * FROM workflows WHERE id = ?').get(newWorkflowId);
      workflow.steps = await db.prepare('SELECT * FROM approval_steps WHERE workflow_id = ? ORDER BY step_order').all(workflow.id);

      createNotification(db, { userId: approver_ids[0], type: purpose === 'retirement' ? 'document_retirement_requested' : 'document_approval_requested', title: `${purpose === 'retirement' ? 'Retirement approval' : 'Approval'} requested — ${doc_id}`, message: doc.title, link: '/workflows', createdBy: submitted_by });

      db.close();
      return res.status(201).json(workflow);
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
