import { ensureDb, getDb } from '../../../lib/db';
import crypto from 'crypto';
import multer from 'multer';
const { runMiddleware } = require('../../../lib/multer-helper');

export const config = { api: { bodyParser: false } };

function hashBuffer(buffer) { return crypto.createHash('sha256').update(buffer).digest('hex'); }
function isWordFile(mimetype = '', originalname = '') {
  const ext = (originalname || '').toLowerCase();
  return ext.endsWith('.doc') || ext.endsWith('.docx') || mimetype.includes('word') || mimetype.includes('msword');
}

const uploadMem = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

// Columns to return in list responses — excludes file_data blob to keep payloads small
const LIST_COLS = 'id,doc_id,filename,originalname,mimetype,size,file_hash,is_primary,file_category,content_html,uploaded_by,uploaded_at';

export default async function handler(req, res) {
  const { id } = req.query; // id = docId (GET/POST) or fileId (DELETE)
  try {
    await ensureDb();

    if (req.method === 'DELETE') {
      const db = getDb();
      const file = await db.prepare('SELECT id FROM document_files WHERE id=?').get(id);
      if (!file) { db.close(); return res.status(404).json({ error: 'File not found' }); }
      await db.prepare('DELETE FROM document_files WHERE id=?').run(id);
      db.close();
      return res.json({ message: 'File deleted' });
    }

    if (req.method === 'GET') {
      const db = getDb();
      const files = await db.prepare(`SELECT ${LIST_COLS} FROM document_files WHERE doc_id=? ORDER BY is_primary DESC, uploaded_at DESC`).all(id);
      db.close();
      return res.json(files);
    }

    if (req.method === 'POST') {
      await runMiddleware(req, res, uploadMem.single('file'));
      if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
      const db = getDb();
      const doc = await db.prepare('SELECT id FROM documents WHERE id=?').get(id);
      if (!doc) { db.close(); return res.status(400).json({ error: 'Document not found' }); }
      const fileHash   = hashBuffer(req.file.buffer);
      const fileData   = req.file.buffer.toString('base64');
      const isPrimary  = isWordFile(req.file.mimetype, req.file.originalname);
      let fileCategory = req.body.file_category || 'supporting';
      if (isPrimary) fileCategory = 'primary';
      if (isPrimary) await db.prepare('UPDATE document_files SET is_primary=0 WHERE doc_id=? AND is_primary=1').run(id);
      await db.prepare(`INSERT INTO document_files (doc_id,filename,originalname,mimetype,size,file_hash,is_primary,file_category,uploaded_by,file_data) VALUES (@doc_id,@filename,@originalname,@mimetype,@size,@file_hash,@is_primary,@file_category,@uploaded_by,@file_data)`).run({ doc_id: id, filename: req.file.originalname, originalname: req.file.originalname, mimetype: req.file.mimetype, size: req.file.size, file_hash: fileHash, is_primary: isPrimary ? 1 : 0, file_category: fileCategory, uploaded_by: req.body.uploaded_by || 'System', file_data: fileData });
      const record = await db.prepare(`SELECT ${LIST_COLS} FROM document_files WHERE file_hash=? AND doc_id=? ORDER BY uploaded_at DESC LIMIT 1`).get(fileHash, id);
      db.close();
      return res.status(201).json(record);
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
