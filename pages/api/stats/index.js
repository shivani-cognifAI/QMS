import { ensureDb, getDb } from '../../../lib/db';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  try {
    await ensureDb();
    const db = getDb();
    const today = new Date().toISOString().slice(0, 10);

    const totalDocs   = await db.prepare("SELECT COUNT(*) as n FROM documents").get().n;
    const approved    = await db.prepare("SELECT COUNT(*) as n FROM documents WHERE status='Approved'").get().n;
    const draft       = await db.prepare("SELECT COUNT(*) as n FROM documents WHERE status IN ('Draft','Under Review')").get().n;
    const overdue     = await db.prepare("SELECT COUNT(*) as n FROM documents WHERE review_date < ? AND review_date IS NOT NULL").get(today).n;
    const iso9001     = await db.prepare("SELECT COUNT(*) as n FROM documents WHERE standard IN ('ISO 9001','Both')").get().n;
    const iso27001    = await db.prepare("SELECT COUNT(*) as n FROM documents WHERE standard IN ('ISO 27001','Both')").get().n;
    const openCapas   = await db.prepare("SELECT COUNT(*) as n FROM capas WHERE status IN ('In Progress','Waiting for Approval')").get().n;
    const closedCapas = await db.prepare("SELECT COUNT(*) as n FROM capas WHERE status='Approved & Closed'").get().n;
    const vhCount     = await db.prepare("SELECT COUNT(*) as n FROM version_history").get().n;
    const dueSoon     = await db.prepare("SELECT COUNT(*) as n FROM documents WHERE review_date BETWEEN ? AND date(?, '+30 days')").get(today, today).n;

    db.close();
    res.json({ totalDocs, approved, draft, overdue, iso9001, iso27001, openCapas, closedCapas, vhCount, dueSoon, approvalRate: totalDocs ? Math.round(approved / totalDocs * 100) : 0 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
