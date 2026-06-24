import { ensureDb, getDb } from '../../../../lib/db';
import path from 'path';
import fs from 'fs';

const UPLOAD_DIR = process.env.VERCEL ? '/tmp/uploads' : path.join(process.cwd(), 'uploads');

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const { fileId } = req.query;
  try {
    await ensureDb();
    const db = getDb();
    const file = db.prepare('SELECT * FROM document_files WHERE id=?').get(fileId);
    db.close();
    if (!file) return res.status(404).json({ error: 'File not found' });
    if (!file.filename) return res.status(400).json({ error: 'This is a created document — use the preview/view option instead of download' });
    const filePath = path.join(UPLOAD_DIR, file.filename);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File missing from disk' });
    res.removeHeader('X-Frame-Options');
    res.setHeader('Content-Security-Policy', 'frame-ancestors *');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.setHeader('Content-Disposition', `inline; filename="${file.originalname}"`);
    res.setHeader('Content-Type', file.mimetype);
    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
