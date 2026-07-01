import { ensureDb, getDb } from '../../../../lib/db';
import path from 'path';
import fs from 'fs';
import mammoth from 'mammoth';

const UPLOAD_DIR = process.env.VERCEL ? '/tmp/uploads' : path.join(process.cwd(), 'uploads');

function isWordFile(mimetype = '', originalname = '') {
  const ext = (originalname || '').toLowerCase();
  return ext.endsWith('.doc') || ext.endsWith('.docx') || mimetype.includes('word') || mimetype.includes('msword');
}

function extractTextFromDocBinary(buffer) {
  const lines = [];
  let current = '';
  for (let i = 0; i < buffer.length - 1; i++) {
    const b1 = buffer[i], b2 = buffer[i + 1];
    if (b2 === 0x00 && b1 >= 0x20 && b1 <= 0x7E) { current += String.fromCharCode(b1); i++; }
    else if (b1 >= 0x20 && b1 <= 0x7E) { current += String.fromCharCode(b1); }
    else if (b1 === 0x0D || b1 === 0x0A || b1 === 0x07) { if (current.trim().length > 3) lines.push(current.trim()); current = ''; }
    else { if (current.trim().length > 3) lines.push(current.trim()); current = ''; }
  }
  if (current.trim().length > 3) lines.push(current.trim());
  return lines.filter(l => l.length > 4 && /[a-zA-Z]{2,}/.test(l)).join('\n');
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const { fileId } = req.query;
  try {
    await ensureDb();
    const db = getDb();
    const file = db.prepare('SELECT * FROM document_files WHERE id=?').get(fileId);
    db.close();
    if (!file) return res.status(404).json({ error: 'File not found' });
    if (!isWordFile(file.mimetype, file.originalname)) return res.status(400).json({ error: 'Not a Word document' });

    let fileBuffer;
    if (file.file_data) {
      fileBuffer = Buffer.from(file.file_data, 'base64');
    } else {
      const filePath = path.join(UPLOAD_DIR, file.filename);
      if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File missing from disk' });
      fileBuffer = fs.readFileSync(filePath);
    }

    const ext = (file.originalname || '').toLowerCase();
    if (ext.endsWith('.docx')) {
      const result      = await mammoth.convertToHtml({ buffer: fileBuffer }, { styleMap: ['u => u'] });
      const plainResult = await mammoth.extractRawText({ buffer: fileBuffer });
      return res.json({ html: result.value, text: plainResult.value });
    }
    if (ext.endsWith('.doc')) {
      const text = extractTextFromDocBinary(fileBuffer);
      if (text.length < 20) return res.status(400).json({ error: 'This is an old .doc file. Please save it as .docx in Word for full text extraction.', hint: 'save_as_docx' });
      return res.json({ text });
    }
    res.status(400).json({ error: 'Unsupported file format' });
  } catch (err) {
    if (err.message && err.message.includes('main document part')) {
      return res.status(400).json({ error: 'This is an old .doc file. Please open it in Word and save as .docx, then re-upload.', hint: 'save_as_docx' });
    }
    res.status(500).json({ error: err.message });
  }
}
