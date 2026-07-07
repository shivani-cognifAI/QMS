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
    const file = await db.prepare('SELECT * FROM document_files WHERE id=?').get(fileId);
    db.close();
    if (!file) return res.status(404).json({ error: 'File not found' });
    if (!file.filename && !file.file_data) return res.status(400).json({ error: 'This is a created document — use the preview/view option instead of download' });
    res.setHeader('Content-Disposition', `attachment; filename="${file.originalname}"`);
    res.setHeader('Content-Type', file.mimetype);
    if (file.file_data) {
      return res.send(Buffer.from(file.file_data, 'base64'));
    }
    const filePath = path.join(UPLOAD_DIR, file.filename);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File missing from disk' });
    fs.createReadStream(filePath).pipe(res);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
