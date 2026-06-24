import { ensureDb, getDb } from '../../../../lib/db';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import multer from 'multer';
const { runMiddleware } = require('../../../../lib/multer-helper');

export const config = { api: { bodyParser: false } };

const UPLOAD_DIR = process.env.VERCEL ? '/tmp/uploads' : path.join(process.cwd(), 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
function hashFile(filePath) { return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex'); }

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename:    (req, file, cb) => {
    const safe = file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, '_');
    cb(null, `capa_${req.query.capaId || 'file'}_${Date.now()}_${safe}`);
  },
});
const uploadDisk = multer({ storage, limits: { fileSize: 20 * 1024 * 1024 } });

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { capaId } = req.query;
  try {
    await runMiddleware(req, res, uploadDisk.single('file'));
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    await ensureDb();
    const db = getDb();
    const capa = db.prepare('SELECT id FROM capas WHERE id=?').get(capaId);
    if (!capa) { fs.unlinkSync(req.file.path); db.close(); return res.status(404).json({ error: 'CAPA record not found' }); }
    const fileHash = hashFile(req.file.path);
    const fileCategory = req.body.file_category || 'evidence';
    db.prepare(`INSERT INTO document_files (doc_id,filename,originalname,mimetype,size,file_hash,is_primary,file_category,uploaded_by,entity_type,entity_id) VALUES ('',@filename,@originalname,@mimetype,@size,@file_hash,0,@file_category,@uploaded_by,'capa',@entity_id)`).run({ filename: req.file.filename, originalname: req.file.originalname, mimetype: req.file.mimetype, size: req.file.size, file_hash: fileHash, file_category: fileCategory, uploaded_by: req.body.uploaded_by || 'System', entity_id: capaId });
    const record = db.prepare(`SELECT * FROM document_files WHERE filename=? AND entity_type='capa'`).get(req.file.filename);
    db.close();
    res.status(201).json(record);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
