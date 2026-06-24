import { ensureDb, getDb } from '../../../../lib/db';
import crypto from 'crypto';
import multer from 'multer';
const { runMiddleware } = require('../../../../lib/multer-helper');

export const config = { api: { bodyParser: false } };

function hashBuffer(buffer) { return crypto.createHash('sha256').update(buffer).digest('hex'); }

const uploadMem = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { fileId } = req.query;
  try {
    await runMiddleware(req, res, uploadMem.single('file'));
    if (!req.file) return res.status(400).json({ error: 'No file provided' });
    await ensureDb();
    const db = getDb();
    const file = db.prepare('SELECT * FROM document_files WHERE id=?').get(fileId);
    db.close();
    if (!file) return res.status(404).json({ error: 'File record not found' });
    const incomingHash = hashBuffer(req.file.buffer);
    const changed = incomingHash !== file.file_hash;
    res.json({ fileId: file.id, docId: file.doc_id, originalname: file.originalname, changed, incomingHash: changed ? incomingHash : null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
