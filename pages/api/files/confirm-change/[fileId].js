import { ensureDb, getDb } from '../../../../lib/db';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import multer from 'multer';
const { runMiddleware } = require('../../../../lib/multer-helper');

export const config = { api: { bodyParser: false } };

const UPLOAD_DIR = path.join(process.cwd(), 'uploads');
function hashBuffer(buffer) { return crypto.createHash('sha256').update(buffer).digest('hex'); }
const uploadMem = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { fileId } = req.query;
  try {
    await runMiddleware(req, res, uploadMem.single('file'));
    const { change_note, confirmed_by } = req.body;
    if (!change_note) return res.status(400).json({ error: 'change_note is required' });
    await ensureDb();
    const db = getDb();
    const file = db.prepare('SELECT * FROM document_files WHERE id=?').get(fileId);
    if (!file) { db.close(); return res.status(404).json({ error: 'File not found' }); }
    const doc = db.prepare('SELECT * FROM documents WHERE id=?').get(file.doc_id);
    if (!doc) { db.close(); return res.status(404).json({ error: 'Document not found' }); }

    let newHash = file.file_hash, newSize = file.size;
    if (req.file) {
      const filePath = path.join(UPLOAD_DIR, file.filename);
      fs.writeFileSync(filePath, req.file.buffer);
      newHash = hashBuffer(req.file.buffer);
      newSize = req.file.buffer.length;
    }

    const parts = String(doc.version).split('.');
    const newVersion = parts.length >= 2 ? `${parts[0]}.${Number(parts[1]) + 1}` : `${doc.version}.1`;

    db.transaction(() => {
      db.prepare('UPDATE document_files SET file_hash=?,size=?,uploaded_at=datetime("now") WHERE id=?').run(newHash, newSize, file.id);
      db.prepare(`UPDATE documents SET version=?,status='Draft',version_date=NULL,updated_at=datetime('now') WHERE id=?`).run(newVersion, file.doc_id);
      db.prepare(`INSERT INTO version_history (doc_id,version,author,change_note) VALUES (?,?,?,?)`).run(file.doc_id, newVersion, confirmed_by || 'System', `File change confirmed by ${confirmed_by}. ${change_note}. Document reset to Draft for re-approval.`);
    })();

    const updatedDoc = db.prepare('SELECT * FROM documents WHERE id=?').get(file.doc_id);
    db.close();
    res.json({ document: { ...updatedDoc, evidence: JSON.parse(updatedDoc.evidence || '[]') }, newVersion });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
