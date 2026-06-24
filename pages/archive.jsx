import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Search, Download, Trash2, Archive, ChevronDown, FileX } from 'lucide-react';
import toast from 'react-hot-toast';
import { getArchive, getDocuments, deleteArchived, getDocHistory, getSettings } from '../api/index';
import { standardPill, typePill, statusPill, fmtDate, fmtDateTime, Spinner, EmptyState, ConfirmDialog, SectionHead } from '../components/UI';
import { exportArchivedVersionPDF } from '../utils/pdfExport';

export default function ArchivePage() {
  const qc = useQueryClient();
  const [search, setSearch]     = useState('');
  const [filterType, setFType]  = useState('');
  const [filterStd, setFStd]    = useState('');
  const [tab, setTab]           = useState('superseded');
  const [expanded, setExpanded] = useState(null);
  const [delTarget, setDel]     = useState(null);

  const { data: archived = [], isLoading } = useQuery({
    queryKey: ['archive', search, filterType, filterStd],
    queryFn:  () => getArchive({ search, type: filterType, standard: filterStd }),
  });

  const { data: allDocs = [], isLoading: docsLoading } = useQuery({
    queryKey: ['documents-retired'],
    queryFn:  () => getDocuments({ status: 'Retired' }),
  });

  const { data: pdfSettings = {} } = useQuery({ queryKey:['settings'], queryFn: getSettings });

  const delMut = useMutation({
    mutationFn: id => deleteArchived(id),
    onSuccess: () => { qc.invalidateQueries(['archive']); toast.success('Archived version deleted'); },
    onError:   e  => toast.error(e.response?.data?.error || 'Delete failed'),
  });

  async function handlePDF(doc) {
    try {
      const docId = doc.doc_id || doc.id;
      const history = await getDocHistory(docId).catch(() => []);
      exportArchivedVersionPDF({ ...doc, id: docId }, history, pdfSettings);
      toast.success('PDF downloaded — watermarked "OBSOLETE VERSION"');
    } catch { toast.error('PDF generation failed'); }
  }

  const filteredArchived = archived.filter(item => {
    const q = search.toLowerCase();
    return (
      (!q || item.doc_title.toLowerCase().includes(q) || item.doc_id.toLowerCase().includes(q)) &&
      (!filterType || item.type === filterType) &&
      (!filterStd  || item.standard === filterStd)
    );
  });

  const grouped = filteredArchived.reduce((acc, item) => {
    if (!acc[item.doc_id]) acc[item.doc_id] = { title: item.doc_title, type: item.type, standard: item.standard, versions: [] };
    acc[item.doc_id].versions.push(item);
    return acc;
  }, {});

  const retiredDocs = allDocs.filter(d => {
    const q = search.toLowerCase();
    return (
      (!q || d.title.toLowerCase().includes(q) || d.id.toLowerCase().includes(q)) &&
      (!filterType || d.type === filterType) &&
      (!filterStd  || d.standard === filterStd)
    );
  });

  const supersededCount = filteredArchived.length;
  const retiredCount    = retiredDocs.length;

  return (
    <div className="page">
      <div className="flex-between mb-16">
        <div>
          <div className="page-title">Document Archive</div>
          <div className="page-sub">Superseded versions and retired documents — all PDFs watermarked <strong>"OBSOLETE VERSION"</strong></div>
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
          <Archive size={16} color="var(--text-2)"/>
          <span style={{ fontSize:13, color:'var(--text-2)' }}>{supersededCount} superseded · {retiredCount} retired</span>
        </div>
      </div>

      <div style={{ background:'var(--amber-bg)', border:'1px solid #EFC97A', borderRadius:'var(--radius-md)', padding:'10px 14px', fontSize:13, color:'var(--amber)', marginBottom:16, display:'flex', alignItems:'center', gap:8 }}>
        <Archive size={15}/>
        Superseded versions are archived automatically when a document is approved through the workflow.
        Retired documents are moved here when their status is set to Retired.
        All PDFs are watermarked <strong>"OBSOLETE VERSION"</strong>.
      </div>

      <div style={{ display:'flex', gap:4, borderBottom:'1px solid var(--border)', marginBottom:16 }}>
        {[
          ['superseded', `Superseded Versions (${supersededCount})`],
          ['retired',    `Retired Documents (${retiredCount})`],
        ].map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)} style={{
            fontSize:13, padding:'7px 14px', cursor:'pointer', background:'transparent',
            border:'none', borderBottom: tab===key ? '2px solid var(--accent)' : '2px solid transparent',
            color: tab===key ? 'var(--accent)' : 'var(--text-2)',
            fontWeight: tab===key ? 500 : 400, marginBottom:-1, fontFamily:'var(--font)',
          }}>{label}</button>
        ))}
      </div>

      <div className="toolbar mb-12">
        <div style={{ position:'relative', flex:1, minWidth:180 }}>
          <Search size={14} style={{ position:'absolute', left:9, top:'50%', transform:'translateY(-50%)', color:'var(--text-3)' }}/>
          <input style={{ paddingLeft:30 }} placeholder="Search title or ID…" value={search} onChange={e => setSearch(e.target.value)}/>
        </div>
        <select value={filterType} onChange={e => setFType(e.target.value)}>
          <option value="">All types</option>
          {['SOP','Policy','Evidence','Work Instruction','Form/Template','Record'].map(t => <option key={t}>{t}</option>)}
        </select>
        <select value={filterStd} onChange={e => setFStd(e.target.value)}>
          <option value="">All standards</option>
          <option>ISO 9001</option><option>ISO 27001</option><option>Both</option>
        </select>
      </div>

      {tab === 'superseded' && (
        isLoading ? <Spinner/> : Object.keys(grouped).length === 0 ? (
          <EmptyState icon={Archive} title="No superseded versions yet"
            sub="Versions are archived automatically each time a document completes the approval workflow"/>
        ) : Object.entries(grouped).map(([docId, group]) => (
          <div key={docId} className="card" style={{ marginBottom:14 }}>
            <div className="card-head" style={{ cursor:'pointer' }} onClick={() => setExpanded(expanded===docId ? null : docId)}>
              <div style={{ flex:1 }}>
                <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:4 }}>
                  {typePill(group.type)}
                  {standardPill(group.standard)}
                  <span style={{ fontFamily:'var(--mono)', fontSize:11, color:'var(--text-2)' }}>{docId}</span>
                </div>
                <div style={{ fontWeight:500, fontSize:14 }}>{group.title}</div>
                <div style={{ fontSize:12, color:'var(--text-2)', marginTop:2 }}>
                  {group.versions.length} superseded version{group.versions.length !== 1 ? 's' : ''}
                </div>
              </div>
              <ChevronDown size={16} color="var(--text-2)" style={{ transform: expanded===docId ? 'rotate(0deg)':'rotate(-90deg)', transition:'transform .2s' }}/>
            </div>

            {expanded === docId && group.versions.map((v, i) => (
              <div key={v.id} style={{
                padding:'14px 1.25rem',
                borderTop: i===0 ? '1px solid var(--border)' : 'none',
                borderBottom:'1px solid var(--border)',
                display:'grid', gridTemplateColumns:'1fr auto',
                gap:16, alignItems:'start',
                background: i%2===0 ? 'var(--bg)' : 'var(--bg-card)',
              }}>
                <div>
                  <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:6 }}>
                    <span style={{ fontFamily:'var(--mono)', fontSize:12, fontWeight:600, background:'var(--bg-hover)', padding:'2px 8px', borderRadius:4 }}>v{v.version}</span>
                    <span className="pill pill-gray" style={{ fontSize:10 }}>OBSOLETE</span>
                    <span style={{ fontSize:11, color:'var(--text-2)' }}>Archived {fmtDateTime(v.archived_at)}</span>
                  </div>
                  <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(160px,1fr))', gap:'4px 16px', fontSize:12 }}>
                    <div><span style={{ color:'var(--text-2)' }}>Status at archive: </span>{v.status}</div>
                    <div><span style={{ color:'var(--text-2)' }}>Version date: </span>{fmtDateTime(v.version_date)}</div>
                    <div><span style={{ color:'var(--text-2)' }}>Owner: </span>{v.owner||'—'}</div>
                    <div><span style={{ color:'var(--text-2)' }}>Archived by: </span>{v.archived_by||'—'}</div>
                    <div><span style={{ color:'var(--text-2)' }}>Clause: </span>{v.clause||'—'}</div>
                    <div><span style={{ color:'var(--text-2)' }}>Review date: </span>{fmtDate(v.review_date)}</div>
                  </div>
                  {v.change_note && (
                    <div style={{ marginTop:8, fontSize:12, background:'var(--bg-card)', border:'1px solid var(--border)', borderRadius:'var(--radius-sm)', padding:'6px 10px', color:'var(--text-2)' }}>
                      📝 {v.change_note}
                    </div>
                  )}
                  {v.evidence && Array.isArray(v.evidence) && v.evidence.length > 0 && (
                    <div style={{ marginTop:8 }}>
                      <div style={{ fontSize:11, color:'var(--text-3)', textTransform:'uppercase', letterSpacing:'.05em', marginBottom:4 }}>Linked Evidence</div>
                      {v.evidence.map((e, ei) => (
                        <span key={ei} style={{ fontSize:11, background:'var(--bg-hover)', padding:'2px 8px', borderRadius:20, marginRight:6, display:'inline-block', marginBottom:4 }}>📎 {e}</span>
                      ))}
                    </div>
                  )}
                </div>
                <div style={{ display:'flex', flexDirection:'column', gap:6, alignItems:'flex-end', flexShrink:0 }}>
                  <button className="btn btn-sm" onClick={() => handlePDF(v)}><Download size={13}/> PDF</button>
                  <button className="btn btn-ghost btn-sm" style={{ color:'var(--red)' }} onClick={() => setDel(v)}><Trash2 size={13}/></button>
                </div>
              </div>
            ))}
          </div>
        ))
      )}

      {tab === 'retired' && (
        docsLoading ? <Spinner/> : retiredDocs.length === 0 ? (
          <EmptyState icon={FileX} title="No retired documents"
            sub="Documents appear here when their status is set to Retired"/>
        ) : (
          <div className="card">
            <div className="table-wrap">
              <table>
                <thead><tr>
                  <th>Document</th><th>ID</th><th>Type</th><th>Standard</th>
                  <th>Version</th><th>Owner</th><th>Last Updated</th><th>Actions</th>
                </tr></thead>
                <tbody>
                  {retiredDocs.map(doc => (
                    <tr key={doc.id}>
                      <td style={{ fontWeight:500 }}>{doc.title}</td>
                      <td><span style={{ fontFamily:'var(--mono)', fontSize:12, color:'var(--text-2)' }}>{doc.id}</span></td>
                      <td>{typePill(doc.type)}</td>
                      <td>{standardPill(doc.standard)}</td>
                      <td><span style={{ fontFamily:'var(--mono)', fontSize:12 }}>v{doc.version}</span></td>
                      <td style={{ fontSize:12, color:'var(--text-2)' }}>{doc.owner||'—'}</td>
                      <td style={{ fontSize:12, color:'var(--text-2)' }}>{fmtDateTime(doc.updated_at)}</td>
                      <td>
                        <button className="btn btn-sm" onClick={() => handlePDF({
                          id: doc.id, doc_id: doc.id, doc_title: doc.title,
                          version: doc.version, version_date: doc.version_date,
                          status: 'Retired', type: doc.type, standard: doc.standard,
                          clause: doc.clause, owner: doc.owner, review_date: doc.review_date,
                          scope: doc.scope, evidence: doc.evidence || [],
                          archived_at: doc.updated_at, archived_by: doc.owner,
                          change_note: 'Document retired',
                        })}>
                          <Download size={13}/> PDF
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )
      )}

      <ConfirmDialog open={!!delTarget} onClose={() => setDel(null)} danger
        title="Delete Archived Version"
        message={`Permanently delete archived v${delTarget?.version} of "${delTarget?.doc_title}"? This cannot be undone.`}
        onConfirm={() => delMut.mutate(delTarget.id)}/>
    </div>
  );
}
