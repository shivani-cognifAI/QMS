import { ensureDb, getDb } from '../../../lib/db';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  try {
    await ensureDb();
    const db = getDb();
    const docs    = await db.prepare('SELECT * FROM documents ORDER BY id').all();
    const history = await db.prepare('SELECT * FROM version_history ORDER BY doc_id, changed_at DESC').all();
    const capas   = await db.prepare('SELECT * FROM capas ORDER BY raised_at DESC').all();
    db.close();
    res.json({
      generated: new Date().toLocaleDateString('en-IN'),
      documents: docs.map(d => ({ ...d, evidence: JSON.parse(d.evidence || '[]') })),
      history,
      capas,
      stats: {
        totalDocs: docs.length,
        approved: docs.filter(d => d.status === 'Approved').length,
        openCapas: capas.filter(c => c.status === 'In Progress' || c.status === 'Waiting for Approval').length,
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
