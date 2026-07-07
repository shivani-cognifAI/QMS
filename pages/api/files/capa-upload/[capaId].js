import { ensureDb, getDb } from '../../../../lib/db';
import crypto from 'crypto';
import multer from 'multer';
const { runMiddleware } = require('../../../../lib/multer-helper');

export const config = { api: { bodyParser: false } };

function hashBuffer(buffer) { return crypto.createHash('sha256').update(buffer).digest('hex'); }

const uploadMem = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

const LIST_COLS = 'id,doc_id,filename,originalname,mimetype,size,file_hash,is_primary,file_category,content_html,uploaded_by,uploaded_at,entity_type,entity_id';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { capaId } = req.query;
  try {
    await runMiddleware(req, res, uploadMem.single('file'));
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    await ensureDb();
    const db = getDb();
    const capa = await db.prepare('SELECT id FROM capas WHERE id=?').get(capaId);
    if (!capa) { db.close(); return res.status(404).json({ error: 'CAPA record not found' }); }
    const fileHash    = hashBuffer(req.file.buffer);
    const fileData    = req.file.buffer.toString('base64');
    const fileCategory = req.body.file_category || 'evidence';
    await db.prepare(`INSERT INTO document_files (doc_id,filename,originalname,mimetype,size,file_hash,is_primary,file_category,uploaded_by,entity_type,entity_id,file_data) VALUES ('',@filename,@originalname,@mimetype,@size,@file_hash,0,@file_category,@uploaded_by,'capa',@entity_id,@file_data)`).run({ filename: req.file.originalname, originalname: req.file.originalname, mimetype: req.file.mimetype, size: req.file.size, file_hash: fileHash, file_category: fileCategory, uploaded_by: req.body.uploaded_by || 'System', entity_id: capaId, file_data: fileData });
    const record = await db.prepare(`SELECT ${LIST_COLS} FROM document_files WHERE file_hash=? AND entity_type='capa' AND entity_id=? ORDER BY uploaded_at DESC LIMIT 1`).get(fileHash, capaId);
    db.close();
    res.status(201).json(record);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
