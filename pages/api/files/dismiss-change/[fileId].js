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
    await ensureDb();
    const db = getDb();
    const file = db.prepare('SELECT * FROM document_files WHERE id=?').get(fileId);
    if (!file) { db.close(); return res.status(404).json({ error: 'File not found' }); }
    if (req.file) {
      const filePath = path.join(UPLOAD_DIR, file.filename);
      fs.writeFileSync(filePath, req.file.buffer);
      const newHash = hashBuffer(req.file.buffer);
      db.prepare('UPDATE document_files SET file_hash=?,size=?,uploaded_at=datetime("now") WHERE id=?').run(newHash, req.file.buffer.length, file.id);
    }
    db.close();
    res.json({ message: 'File updated, no version change recorded' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
