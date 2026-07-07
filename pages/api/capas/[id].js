import { ensureDb, getDb } from '../../../lib/db';
const { createNotification } = require('../../../lib/notify');

export default async function handler(req, res) {
  const { id } = req.query;
  try {
    await ensureDb();

    if (req.method === 'GET') {
      const db = getDb();
      const capa = await db.prepare('SELECT * FROM capas WHERE id = ?').get(id);
      db.close();
      if (!capa) return res.status(404).json({ error: 'CAPA not found' });
      return res.json(capa);
    }

    if (req.method === 'PUT') {
      const { id: newId, type, title, detail, clause, source, owner_id, due_date, root_cause, action, status, pct_complete, updated_by } = req.body;
      if (!newId || !title || !type || !status) return res.status(400).json({ error: 'id, title, type, status are required' });
      if (!['NCR','CAPA','Observation','Opportunity for Improvement'].includes(type)) return res.status(400).json({ error: 'Invalid type' });

      const db = getDb();
      const existing = await db.prepare('SELECT * FROM capas WHERE id = ?').get(id);
      if (!existing) { db.close(); return res.status(404).json({ error: 'CAPA not found' }); }
      if (existing.status === 'Approved & Closed' && existing.approval_status === 'Approved') { db.close(); return res.status(400).json({ error: 'This record is Approved & Closed — its status and content can no longer be changed.' }); }
      if (status === 'Approved & Closed' && existing.status !== 'Approved & Closed') { db.close(); return res.status(400).json({ error: "A record can't be marked Approved & Closed directly." }); }

      const closed_at = status === 'Approved & Closed' ? new Date().toISOString().slice(0,10) : null;
      let owner = null;
      if (owner_id) { const user = await db.prepare('SELECT name FROM users WHERE id = ?').get(owner_id); if (user) owner = user.name; }

      await db.prepare(`UPDATE capas SET id=@id, type=@type, title=@title, detail=@detail, clause=@clause, source=@source, owner=@owner, owner_id=@owner_id, due_date=@due_date, root_cause=@root_cause, action=@action, status=@status, pct_complete=@pct_complete, closed_at=@closed_at, updated_by=@updated_by, updated_at=datetime('now') WHERE id=@oldId`)
        .run({ id: newId || id, type, title, detail: detail || null, clause: clause || null, source: source || null, owner, owner_id: owner_id || null, due_date: due_date || null, root_cause: root_cause || null, action: action || null, status, pct_complete: pct_complete || 0, closed_at, updated_by: updated_by || existing.created_by || 'Unknown', oldId: id });

      const assigneeChanged = owner_id && String(owner_id) !== String(existing.owner_id || '');
      if (assigneeChanged) createNotification(db, { userId: owner_id, type: 'capa_assigned', title: `${type} assigned to you — ${newId || id}`, message: title, link: '/capas', createdBy: updated_by || 'System' });

      const capa = await db.prepare('SELECT * FROM capas WHERE id = ?').get(newId || id);
      db.close();
      return res.json(capa);
    }

    if (req.method === 'DELETE') {
      const db = getDb();
      const capa = await db.prepare('SELECT id, status, approval_status FROM capas WHERE id = ?').get(id);
      if (!capa) { db.close(); return res.status(404).json({ error: 'CAPA not found' }); }
      if (capa.status === 'Approved & Closed' && capa.approval_status === 'Approved') { db.close(); return res.status(400).json({ error: 'Approved & Closed records are locked and cannot be deleted.' }); }
      await db.prepare('DELETE FROM capas WHERE id = ?').run(id);
      db.close();
      return res.json({ message: 'CAPA deleted' });
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
