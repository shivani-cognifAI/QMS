import { ensureDb, getDb } from '../../../../lib/db';

async function getNumberingConfig(db, type) {
  const row = await db.prepare(`SELECT value FROM settings WHERE key='capa_numbering'`).get();
  let all = {};
  if (row && row.value) { try { all = JSON.parse(row.value); } catch (_) {} }
  const cfg = all[type] || { prefix: '', rules: [] };
  if (!Array.isArray(cfg.rules)) {
    return { prefix: cfg.prefix || '', rules: cfg.suffix ? [{ suffix: cfg.suffix, start_date: null, end_date: null }] : [] };
  }
  return { prefix: cfg.prefix || '', rules: cfg.rules };
}

function findMatchingRule(rules, dateStr) {
  for (const rule of rules) {
    const afterStart = !rule.start_date || dateStr >= rule.start_date;
    const beforeEnd  = !rule.end_date   || dateStr <= rule.end_date;
    if (afterStart && beforeEnd) return rule;
  }
  return null;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const { type } = req.query;
  try {
    await ensureDb();
    const db = getDb();
    const cfg   = await getNumberingConfig(db, type);
    const today = new Date().toISOString().slice(0, 10);

    if (cfg.rules.length > 0) {
      const rule = findMatchingRule(cfg.rules, today);
      if (!rule) { db.close(); return res.status(400).json({ error: `No record numbering rule covers today's date (${today}) for ${type}.`, noRuleForDate: true }); }
      const suffixKey = rule.suffix || '';
      const seqRow = await db.prepare('SELECT last_seq FROM capa_seq WHERE record_type=? AND suffix=?').get(type, suffixKey);
      const nextSeq = (seqRow ? seqRow.last_seq : 0) + 1;
      const numberPart = String(nextSeq).padStart(3, '0');
      const suffixPart = rule.suffix ? `-${rule.suffix}` : '';
      const id = `${cfg.prefix || ''}${numberPart}${suffixPart}`;
      db.close();
      return res.json({ id, seq: nextSeq, prefix: cfg.prefix || '', suffix: rule.suffix || '' });
    }

    const seqRow = await db.prepare('SELECT last_seq FROM capa_seq WHERE record_type=? AND suffix=?').get(type, '');
    const nextSeq = (seqRow ? seqRow.last_seq : 0) + 1;
    const numberPart = String(nextSeq).padStart(3, '0');
    const id = `${cfg.prefix || ''}${numberPart}`;
    db.close();
    res.json({ id, seq: nextSeq, prefix: cfg.prefix || '', suffix: '' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
