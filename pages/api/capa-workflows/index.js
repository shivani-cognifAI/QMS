import { ensureDb, getDb } from '../../../lib/db';
const { createNotification } = require('../../../lib/notify');

export default async function handler(req, res) {
  try {
    await ensureDb();

    if (req.method === 'GET') {
      const db = getDb();
      const { capa_id, status } = req.query;
      let sql = 'SELECT * FROM capa_workflows WHERE 1=1';
      const params = [];
      if (capa_id) { sql += ' AND capa_id = ?'; params.push(capa_id); }
      if (status)  { sql += ' AND status = ?';  params.push(status); }
      sql += ' ORDER BY created_at DESC';
      const workflows = await db.prepare(sql).all(...params);
      for (const wf of workflows) {
        wf.steps = await db.prepare('SELECT * FROM capa_approval_steps WHERE workflow_id = ? ORDER BY step_order').all(wf.id);
      }
      db.close();
      return res.json(workflows);
    }

    if (req.method === 'POST') {
      const { capa_id, submitted_by, approver_ids } = req.body;
      if (!capa_id || !submitted_by || !Array.isArray(approver_ids) || approver_ids.length < 1) {
        return res.status(400).json({ error: 'capa_id, submitted_by, approver_ids (min 1) are required' });
      }
      const db = getDb();
      const capa = await db.prepare('SELECT * FROM capas WHERE id = ?').get(capa_id);
      if (!capa) { db.close(); return res.status(404).json({ error: 'CAPA record not found' }); }
      const existingActive = await db.prepare(`SELECT id FROM capa_workflows WHERE capa_id = ? AND status = 'In Progress'`).get(capa_id);
      if (existingActive) { db.close(); return res.status(400).json({ error: 'This record already has an approval in progress' }); }
      for (const aid of approver_ids) {
        const user = await db.prepare('SELECT id FROM users WHERE id = ?').get(aid);
        if (!user) { db.close(); return res.status(400).json({ error: `User ID ${aid} not found` }); }
      }

      let newWorkflowId;
      await db.transaction(async () => {
        await db.prepare(`UPDATE capas SET approval_status='Under Review', updated_at=datetime('now') WHERE id=?`).run(capa_id);
        const wfResult = await db.prepare(`INSERT INTO capa_workflows (capa_id, submitted_by, status) VALUES (?, ?, 'In Progress')`).run(capa_id, submitted_by);
        newWorkflowId = wfResult.lastInsertRowid;
        for (const [idx, aid] of approver_ids.entries()) {
          const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(aid);
          const stepStatus = idx === 0 ? 'Awaiting' : 'Pending';
          await db.prepare(`INSERT INTO capa_approval_steps (workflow_id, step_order, approver_id, approver_name, status) VALUES (?, ?, ?, ?, ?)`).run(newWorkflowId, idx + 1, aid, user.name, stepStatus);
        }
      });

      const workflow = await db.prepare('SELECT * FROM capa_workflows WHERE id = ?').get(newWorkflowId);
      workflow.steps = await db.prepare('SELECT * FROM capa_approval_steps WHERE workflow_id = ? ORDER BY step_order').all(workflow.id);
      createNotification(db, { userId: approver_ids[0], type: 'capa_approval_requested', title: `Approval requested — ${capa_id}`, message: capa.title, link: '/capas', createdBy: submitted_by });
      db.close();
      return res.status(201).json(workflow);
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
