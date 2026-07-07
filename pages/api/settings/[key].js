import { ensureDb, getDb } from '../../../lib/db';

function findOverlappingRules(numberingConfig) {
  for (const [type, cfg] of Object.entries(numberingConfig || {})) {
    const rules = Array.isArray(cfg.rules) ? cfg.rules : [];
    for (let i = 0; i < rules.length; i++) {
      for (let j = i + 1; j < rules.length; j++) {
        const a = rules[i], b = rules[j];
        const aEndsBeforeB = a.end_date && b.start_date && a.end_date < b.start_date;
        const bEndsBeforeA = b.end_date && a.start_date && b.end_date < a.start_date;
        if (!aEndsBeforeB && !bEndsBeforeA) {
          return `${type}: suffix "${a.suffix}" (${a.start_date || '…'} to ${a.end_date || '…'}) overlaps with suffix "${b.suffix}" (${b.start_date || '…'} to ${b.end_date || '…'})`;
        }
      }
    }
  }
  return null;
}

export default async function handler(req, res) {
  const { key } = req.query;
  try {
    await ensureDb();

    if (req.method === 'GET') {
      const db = getDb();
      const row = await db.prepare('SELECT * FROM settings WHERE key=?').get(key);
      db.close();
      return res.json({ key, value: row ? row.value : null });
    }

    if (req.method === 'PUT') {
      const { value } = req.body;
      if (value === undefined) return res.status(400).json({ error: 'value is required' });
      if (key === 'capa_numbering') {
        let parsed;
        try { parsed = JSON.parse(value); } catch (_) { return res.status(400).json({ error: 'capa_numbering value must be valid JSON' }); }
        const conflict = findOverlappingRules(parsed);
        if (conflict) return res.status(400).json({ error: `Overlapping date ranges: ${conflict}` });
      }
      const db = getDb();
      const existing = await db.prepare('SELECT key FROM settings WHERE key=?').get(key);
      if (existing) await db.prepare('UPDATE settings SET value=? WHERE key=?').run(value, key);
      else          await db.prepare('INSERT INTO settings (key, value) VALUES (?,?)').run(key, value);
      db.close();
      return res.json({ key, value });
    }

    if (req.method === 'DELETE') {
      const db = getDb();
      await db.prepare('DELETE FROM settings WHERE key=?').run(key);
      db.close();
      return res.json({ message: 'Setting removed' });
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
