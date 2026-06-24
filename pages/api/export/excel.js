import { ensureDb, getDb } from '../../../lib/db';
const XLSX = require('xlsx');

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  try {
    await ensureDb();
    const db = getDb();
    const docs    = db.prepare('SELECT * FROM documents ORDER BY id').all();
    const history = db.prepare('SELECT * FROM version_history ORDER BY doc_id, changed_at DESC').all();
    const capas   = db.prepare('SELECT * FROM capas ORDER BY raised_at DESC').all();
    db.close();

    const wb = XLSX.utils.book_new();

    function stripHtml(html) {
      if (!html) return '';
      return html.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li)>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\n{3,}/g, '\n\n').trim();
    }

    const docRows = [
      ['ID','Title','Type','Standard','Clause / Control','Version','Status','Owner','Next Review Date','Scope'],
      ...docs.map(d => [d.id, d.title, d.type, d.standard, d.clause||'', d.version, d.status, d.owner||'', d.review_date||'', stripHtml(d.scope)])
    ];
    const ws1 = XLSX.utils.aoa_to_sheet(docRows);
    ws1['!cols'] = [10,40,15,12,18,8,14,20,14,50].map(w => ({ wch: w }));
    XLSX.utils.book_append_sheet(wb, ws1, 'Document Register');

    const vhRows = [
      ['Doc ID','Version','Changed At','Author','Change Note'],
      ...history.map(v => [v.doc_id, v.version, v.changed_at, v.author||'', v.change_note||''])
    ];
    const ws2 = XLSX.utils.aoa_to_sheet(vhRows);
    ws2['!cols'] = [12,8,14,20,60].map(w => ({ wch: w }));
    XLSX.utils.book_append_sheet(wb, ws2, 'Version History');

    const capaRows = [
      ['ID','Type','Title','Detail','Clause','Source','Owner','Due Date','Root Cause','Corrective Action','Status','% Complete','Raised At','Closed At'],
      ...capas.map(c => [c.id, c.type, c.title, c.detail||'', c.clause||'', c.source||'', c.owner||'', c.due_date||'', c.root_cause||'', c.action||'', c.status, c.pct_complete, c.raised_at||'', c.closed_at||''])
    ];
    const ws3 = XLSX.utils.aoa_to_sheet(capaRows);
    ws3['!cols'] = [12,12,35,50,18,18,20,12,50,50,12,10,12,12].map(w => ({ wch: w }));
    XLSX.utils.book_append_sheet(wb, ws3, 'NCR-CAPA Register');

    const approved = docs.filter(d => d.status === 'Approved').length;
    const openCapas = capas.filter(c => c.status === 'In Progress' || c.status === 'Waiting for Approval').length;
    const statsRows = [
      ['QMS DocControl — Summary Report'],
      ['Generated', new Date().toLocaleDateString('en-IN')],
      [], ['Metric','Value'],
      ['Total documents', docs.length],
      ['Approved documents', approved],
      ['Approval rate (%)', docs.length ? Math.round(approved/docs.length*100) : 0],
      ['Draft / Under Review', docs.filter(d => d.status==='Draft'||d.status==='Under Review').length],
      ['Retired documents', docs.filter(d => d.status==='Retired').length],
      [], ['Total NCR/CAPA records', capas.length],
      ['Open / In Progress', openCapas],
      ['Approved & Closed records', capas.filter(c => c.status==='Approved & Closed').length],
      [], ['ISO 9001 documents', docs.filter(d => d.standard==='ISO 9001'||d.standard==='Both').length],
      ['ISO 27001 documents', docs.filter(d => d.standard==='ISO 27001'||d.standard==='Both').length],
    ];
    const ws4 = XLSX.utils.aoa_to_sheet(statsRows);
    ws4['!cols'] = [35, 20].map(w => ({ wch: w }));
    XLSX.utils.book_append_sheet(wb, ws4, 'Summary');

    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Disposition', 'attachment; filename="QMS_DocControl_Export.xlsx"');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buffer);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
