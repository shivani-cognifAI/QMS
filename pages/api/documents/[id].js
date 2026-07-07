import { ensureDb, getDb } from '../../../lib/db';
const { createNotification } = require('../../../lib/notify');
const { getDocumentTypes } = require('../../../lib/documentTypes');

export default async function handler(req, res) {
  const { id } = req.query;
  try {
    await ensureDb();

    if (req.method === 'GET') {
      const db = getDb();
      const doc = await db.prepare('SELECT * FROM documents WHERE id = ?').get(id);
      if (!doc) { db.close(); return res.status(404).json({ error: 'Document not found' }); }
      const history = await db.prepare('SELECT * FROM version_history WHERE doc_id = ? ORDER BY changed_at DESC').all(id);
      db.close();
      return res.json({ ...doc, evidence: JSON.parse(doc.evidence || '[]'), history });
    }

    if (req.method === 'PUT') {
      const db = getDb();
      const old = await db.prepare('SELECT * FROM documents WHERE id = ?').get(id);
      if (!old) { db.close(); return res.status(404).json({ error: 'Document not found' }); }
      if (old.status === 'Retired') { db.close(); return res.status(400).json({ error: 'This document is Retired and was approved as such — its status and content can no longer be changed.' }); }

      const { id: newId, title, type, standard, clause, version, status, owner_id, review_date, scope, evidence, change_note, updated_by } = req.body;

      const validTypes = getDocumentTypes(db);
      if (!validTypes.includes(type)) { db.close(); return res.status(400).json({ error: `Invalid type` }); }
      if (!['ISO 9001','ISO 27001','Both'].includes(standard)) { db.close(); return res.status(400).json({ error: 'Invalid standard' }); }
      if (!['Draft','Under Review','Approved','Retired'].includes(status)) { db.close(); return res.status(400).json({ error: 'Invalid status' }); }

      if (status === 'Retired' && old.status !== 'Retired') {
        db.close();
        return res.status(400).json({ error: "A document can't be marked Retired directly — submit it for retirement approval from the Documents tab instead." });
      }

      let owner = null;
      if (owner_id) {
        const user = await db.prepare('SELECT name FROM users WHERE id = ?').get(owner_id);
        if (user) owner = user.name;
      }
      const actorName = updated_by || owner || 'System';
      const versionBumped = version && String(version) !== String(old.version);
      let newStatus = status;
      let version_date = old.version_date;

      if (versionBumped && old.status === 'Approved') {
        await db.prepare(`
          INSERT INTO archived_versions
            (doc_id, doc_title, version, version_date, status, type, standard, clause,
             owner, review_date, scope, evidence, archived_at, archived_by, workflow_id, change_note)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'),?,?,?)
        `).run(old.id, old.title, old.version, old.version_date, old.status, old.type, old.standard, old.clause, old.owner, old.review_date, old.scope, old.evidence, actorName, null, `Superseded by v${version} — content updated by ${actorName}. ${change_note || 'No change description provided.'}`);
        newStatus = 'Draft';
        version_date = null;
      } else {
        if (status === 'Approved' && old.status !== 'Approved') {
          version_date = new Date().toISOString().replace('T', ' ').slice(0, 19);
        } else if (status !== 'Approved' && old.status === 'Approved') {
          version_date = null;
        }
      }

      await db.prepare(`
        UPDATE documents SET
          id=@id, title=@title, type=@type, standard=@standard, clause=@clause,
          version=@version, version_date=@version_date, status=@status,
          owner=@owner, owner_id=@owner_id, review_date=@review_date, scope=@scope,
          evidence=@evidence, updated_by=@updated_by, updated_at=datetime('now')
        WHERE id=@oldId
      `).run({ id: newId || id, title, type, standard, clause: clause || null, version: version || old.version, version_date, status: newStatus, owner, owner_id: owner_id || null, review_date: review_date || null, scope: scope || null, evidence: JSON.stringify(evidence || []), updated_by: actorName, oldId: id });

      const justRetired = newStatus === 'Retired' && old.status !== 'Retired';
      if (!justRetired && (version !== old.version || change_note)) {
        await db.prepare(`INSERT INTO version_history (doc_id, version, author, change_note) VALUES (?, ?, ?, ?)`)
          .run(newId || id, version || old.version, actorName, change_note || `Updated to v${version || old.version}`);
      }

      const assigneeChanged = owner_id && String(owner_id) !== String(old.owner_id || '');
      if (assigneeChanged) {
        createNotification(db, { userId: owner_id, type: 'document_assigned', title: `Document assigned to you — ${newId || id}`, message: title, link: '/documents', createdBy: actorName });
      }

      const doc = await db.prepare('SELECT * FROM documents WHERE id = ?').get(newId || id);
      db.close();
      return res.json({ ...doc, evidence: JSON.parse(doc.evidence || '[]') });
    }

    if (req.method === 'DELETE') {
      const db = getDb();
      const doc = await db.prepare('SELECT id, status FROM documents WHERE id = ?').get(id);
      if (!doc) { db.close(); return res.status(404).json({ error: 'Document not found' }); }
      if (doc.status === 'Retired') { db.close(); return res.status(400).json({ error: 'Retired documents are locked and cannot be deleted.' }); }
      await db.prepare('DELETE FROM documents WHERE id = ?').run(id);
      db.close();
      return res.json({ message: 'Document deleted' });
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
