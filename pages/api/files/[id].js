import { ensureDb, getDb } from '../../../lib/db';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import multer from 'multer';
const { runMiddleware } = require('../../../lib/multer-helper');

export const config = { api: { bodyParser: false } };

const UPLOAD_DIR = process.env.VERCEL ? '/tmp/uploads' : path.join(process.cwd(), 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

function hashBuffer(buffer) { return crypto.createHash('sha256').update(buffer).digest('hex'); }
function hashFile(filePath)  { return hashBuffer(fs.readFileSync(filePath)); }
function isWordFile(mimetype = '', originalname = '') {
  const ext = (originalname || '').toLowerCase();
  return ext.endsWith('.doc') || ext.endsWith('.docx') || mimetype.includes('word') || mimetype.includes('msword');
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename:    (req, file, cb) => {
    const safe = file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, '_');
    cb(null, `${req.query.id || 'file'}_${Date.now()}_${safe}`);
  },
});
const uploadDisk = multer({ storage, limits: { fileSize: 20 * 1024 * 1024 } });

export default async function handler(req, res) {
  const { id } = req.query; // id = docId (GET/POST) or fileId (DELETE)
  try {
    await ensureDb();

    if (req.method === 'DELETE') {
      const db = getDb();
      const file = db.prepare('SELECT * FROM document_files WHERE id=?').get(id);
      if (!file) { db.close(); return res.status(404).json({ error: 'File not found' }); }
      if (file.filename) {
        const filePath = path.join(UPLOAD_DIR, file.filename);
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      }
      db.prepare('DELETE FROM document_files WHERE id=?').run(id);
      db.close();
      return res.json({ message: 'File deleted' });
    }

    if (req.method === 'GET') {
      const db = getDb();
      const files = db.prepare('SELECT * FROM document_files WHERE doc_id=? ORDER BY is_primary DESC, uploaded_at DESC').all(id);
      db.close();
      return res.json(files);
    }

    if (req.method === 'POST') {
      await runMiddleware(req, res, uploadDisk.single('file'));
      if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
      const db = getDb();
      const doc = db.prepare('SELECT id FROM documents WHERE id=?').get(id);
      if (!doc) { fs.unlinkSync(req.file.path); db.close(); return res.status(404).json({ error: 'Document not found' }); }
      const fileHash  = hashFile(req.file.path);
      const isPrimary = isWordFile(req.file.mimetype, req.file.originalname);
      let fileCategory = req.body.file_category || 'supporting';
      if (isPrimary) fileCategory = 'primary';
      if (isPrimary) db.prepare('UPDATE document_files SET is_primary=0 WHERE doc_id=? AND is_primary=1').run(id);
      db.prepare(`INSERT INTO document_files (doc_id,filename,originalname,mimetype,size,file_hash,is_primary,file_category,uploaded_by) VALUES (@doc_id,@filename,@originalname,@mimetype,@size,@file_hash,@is_primary,@file_category,@uploaded_by)`).run({ doc_id: id, filename: req.file.filename, originalname: req.file.originalname, mimetype: req.file.mimetype, size: req.file.size, file_hash: fileHash, is_primary: isPrimary ? 1 : 0, file_category: fileCategory, uploaded_by: req.body.uploaded_by || 'System' });
      const record = db.prepare('SELECT * FROM document_files WHERE filename=?').get(req.file.filename);
      db.close();
      return res.status(201).json(record);
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
