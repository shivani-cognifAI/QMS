import React, { useState, useEffect } from 'react';
import { X, AlertCircle, FileDown, Download, Eye } from 'lucide-react';
import toast from 'react-hot-toast';
import {
  getDocument, getDocFiles, getDocHistory, getWordContent, getSettings, downloadFile, fetchFileBytes,
} from '../api';
import { Spinner, fmtDate, fmtDateTime } from './UI';
import { exportSingleDocumentPDF, filterVersionHistory, mergeUploadedPdfsIntoPdf, downloadPdfBytes } from '../utils/pdfExport';

function formatBytes(b) {
  if (b < 1024) return `${b} B`;
  if (b < 1048576) return `${(b/1024).toFixed(1)} KB`;
  return `${(b/1048576).toFixed(1)} MB`;
}

function isWordFile(mimetype = '', originalname = '') {
  const ext = (originalname || '').toLowerCase();
  return mimetype.includes('word') || mimetype.includes('msword') ||
    (mimetype === 'application/octet-stream' && (ext.endsWith('.doc') || ext.endsWith('.docx'))) ||
    ext.endsWith('.doc') || ext.endsWith('.docx');
}

function isPdfFile(mimetype = '', originalname = '') {
  const ext = (originalname || '').toLowerCase();
  return mimetype === 'application/pdf' || ext.endsWith('.pdf');
}

function isImageFile(mimetype = '', originalname = '') {
  const ext = (originalname || '').toLowerCase();
  return mimetype.startsWith('image/') || /\.(png|jpe?g|gif|webp|svg)$/.test(ext);
}
function isPreviewableFile(mimetype, originalname) {
  return isPdfFile(mimetype, originalname) || isImageFile(mimetype, originalname);
}

export default function DocumentPreviewModal({ docId, onClose }) {
  const [doc, setDoc]             = useState(null);
  const [files, setFiles]         = useState([]);
  const [history, setHistory]     = useState([]);
  const [wordText, setWordText]   = useState(null);
  const [wordHtml, setWordHtml]   = useState(null);
  const [wordHint, setWordHint]   = useState(null);
  const [settings, setSettings]   = useState({});
  const [attachments, setAttachments] = useState([]);
  const [loading, setLoading]     = useState(true);
  const [viewFile, setViewFile]   = useState(null);
  const [viewFileBlobUrl, setViewFileBlobUrl] = useState(null);
  const [viewFileLoading, setViewFileLoading] = useState(false);

  useEffect(() => {
    if (!viewFile) { setViewFileBlobUrl(null); return; }
    let cancelled = false;
    setViewFileLoading(true);
    setViewFileBlobUrl(null);
    fetchFileBytes(viewFile.id).then(bytes => {
      if (cancelled) return;
      const blob = new Blob([bytes], { type: viewFile.mimetype || 'application/octet-stream' });
      setViewFileBlobUrl(URL.createObjectURL(blob));
    }).catch(() => {
      if (!cancelled) toast.error('Failed to load file preview');
    }).finally(() => {
      if (!cancelled) setViewFileLoading(false);
    });
    return () => { cancelled = true; };
  }, [viewFile]);

  useEffect(() => {
    return () => { if (viewFileBlobUrl) URL.revokeObjectURL(viewFileBlobUrl); };
  }, [viewFileBlobUrl]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const [docData, fileData, historyData, settingsData] = await Promise.all([
          getDocument(docId),
          getDocFiles(docId).catch(() => []),
          getDocHistory(docId).catch(() => []),
          getSettings().catch(() => ({})),
        ]);
        if (cancelled) return;
        setDoc(docData);
        setFiles(fileData);
        setHistory(historyData);
        setSettings(settingsData);

        const primaryFile = fileData.find(f => f.is_primary === 1 && isWordFile(f.mimetype, f.originalname));
        if (primaryFile) {
          try {
            const content = await getWordContent(primaryFile.id);
            if (cancelled) return;
            setWordText(content?.text || null);
            setWordHtml(content?.html || null);
            setWordHint(content?.hint || null);
          } catch (err) {
            if (cancelled) return;
            setWordText(null);
            setWordHtml(null);
            setWordHint(err.response?.data?.hint || null);
          }
        }

        const supportingFiles = fileData.filter(f => f.is_primary !== 1);
        const attachmentResults = [];
        for (const f of supportingFiles) {
          if (f.mimetype === 'application/x-qms-document') {
            if ((f.content_html || '').trim()) {
              attachmentResults.push({ title: f.originalname, html: f.content_html, category: f.file_category });
            }
          } else if (isWordFile(f.mimetype, f.originalname)) {
            try {
              const content = await getWordContent(f.id);
              if (content?.html?.trim()) {
                attachmentResults.push({ title: f.originalname, html: content.html, category: f.file_category });
              } else if (content?.text?.trim()) {
                attachmentResults.push({ title: f.originalname, text: content.text, category: f.file_category });
              }
            } catch (_) {}
          }
        }
        if (!cancelled) setAttachments(attachmentResults);
      } catch (err) {
        toast.error('Failed to load document for preview');
        onClose?.();
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [docId]);

  async function handleDownloadPDF() {
    if (!doc) return;

    const mergePdfs = [];
    const primaryFile = files.find(f => f.is_primary === 1);
    if (primaryFile && isPdfFile(primaryFile.mimetype, primaryFile.originalname)) {
      mergePdfs.push({ role: 'primary', fileId: primaryFile.id, filename: primaryFile.originalname });
    }
    for (const f of files.filter(f => f.is_primary !== 1)) {
      if (isPdfFile(f.mimetype, f.originalname)) {
        mergePdfs.push({ role: 'attachment', fileId: f.id, filename: f.originalname, category: f.file_category });
      }
    }

    const buildResult = exportSingleDocumentPDF(doc, files, false, wordText, history, settings, attachments, wordHtml, mergePdfs);
    const wm = doc.status === 'Approved' ? '"UNCONTROLLED COPY"' : '"DRAFT — NOT FOR USE"';

    if (!buildResult || !buildResult.needsMerge) {
      toast.success(`PDF downloaded — watermarked ${wm}`);
      return;
    }

    const mergeToast = toast.loading('Merging uploaded PDF pages…');
    try {
      const { bytes, filename, failedMerges } = await mergeUploadedPdfsIntoPdf(buildResult, fetchFileBytes);
      downloadPdfBytes(bytes, filename);
      toast.dismiss(mergeToast);
      if (failedMerges.length > 0) {
        toast.error(`PDF downloaded, but ${failedMerges.length} file(s) couldn't be merged: ${failedMerges.map(f => f.filename).join(', ')}`, { duration: 7000 });
      } else {
        toast.success(`PDF downloaded — watermarked ${wm}`);
      }
    } catch (err) {
      toast.dismiss(mergeToast);
      toast.error('Failed to merge uploaded PDF pages — try downloading again.');
    }
  }

  const filteredHistory = filterVersionHistory(history);
  const primaryFile = files.find(f => f.is_primary === 1);
  const supportingFiles = files.filter(f => f.is_primary !== 1);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-lg" onClick={e=>e.stopPropagation()} style={{ maxWidth:720 }}>
        <div className="flex-between mb-12">
          <div style={{ fontWeight:600, fontSize:16 }}>Document Preview</div>
          <button className="btn btn-ghost btn-icon" onClick={onClose}><X size={16}/></button>
        </div>

        {loading || !doc ? <Spinner/> : (
          <>
            <div style={{ fontSize:11, color:'var(--text-3)', marginBottom:10, background:'var(--accent-bg)', border:'1px solid var(--accent-bdr)', borderRadius:'var(--radius-sm)', padding:'6px 10px' }}>
              The exported PDF will include: <strong>Page 1</strong> - branded cover page (shown below) - <strong>Page 2</strong> - document details - additional pages for document content - final page - Version History table (shown below).
            </div>

            <div style={{ fontSize:11, fontWeight:600, textTransform:'uppercase', letterSpacing:'.06em', color:'var(--text-3)', marginBottom:6 }}>Page 1 — Cover Page</div>
            <div style={{ border:'1px solid var(--border)', borderRadius:'var(--radius-md)', marginBottom:12, overflow:'hidden', position:'relative', background:'#fff' }}>
              <div style={{ background: settings.cover_brand_color || '#1A56DB', padding:'18px 16px', textAlign:'center' }}>
                <div style={{ width:40, height:40, borderRadius:'50%', background: settings.company_logo ? 'transparent' : '#fff', margin:'0 auto 8px', overflow:'hidden', display:'flex', alignItems:'center', justifyContent:'center' }}>
                  {settings.company_logo ? (
                    <img src={settings.company_logo} alt="logo" style={{ width:'100%', height:'100%', objectFit:'contain' }}/>
                  ) : (
                    <span style={{ color: settings.cover_brand_color || '#1A56DB', fontWeight:700, fontSize:20 }}>C</span>
                  )}
                </div>
                <div style={{ color:'#fff', fontWeight:700, fontSize:16 }}>{settings.company_name?.trim() || 'CognifAI'}</div>
                {settings.cover_tagline?.trim() && (
                  <div style={{ color:'#fff', fontSize:11, opacity:0.85, marginTop:2 }}>{settings.cover_tagline}</div>
                )}
              </div>
              <div style={{ padding:'40px 24px', textAlign: settings.cover_title_align || 'center', minHeight:160, position:'relative' }}>
                <div style={{ position:'absolute', inset:0, display:'flex', alignItems:'center', justifyContent:'center', pointerEvents:'none', opacity:0.06, transform:'rotate(-45deg)', fontSize:32, fontWeight:900, color: doc.status==='Approved'?'#1A56DB':'#F0AD4E', whiteSpace:'nowrap' }}>
                  {doc.status==='Approved' ? 'UNCONTROLLED COPY' : 'DRAFT — NOT FOR USE'}
                </div>
                <div style={{ fontSize: Number(settings.cover_title_size) ? Math.max(Number(settings.cover_title_size)*0.6,12) : 20, fontWeight:700, color:'#1C1B18', marginBottom:6 }}>{doc.title}</div>
                <div style={{ fontSize:12, color:'var(--text-2)', marginBottom:14 }}>{doc.id}</div>
                <div style={{ display:'inline-block', background:'var(--accent-bg)', borderRadius:6, padding:'6px 18px' }}>
                  <span style={{ fontSize:14, fontWeight:700, color: settings.cover_brand_color || '#1A56DB' }}>Version {doc.version}</span>
                </div>
                <div style={{ fontSize:11, color:'var(--text-2)', marginTop:10 }}>{doc.type} · {doc.standard}</div>
              </div>
              <div style={{ borderTop:'1px solid var(--border)', padding:'10px 16px', textAlign:'center', fontSize:10, color:'var(--text-2)' }}>
                <div>Status: {doc.status} · Version date: {fmtDateTime(doc.version_date)} · Owner: {doc.owner||'—'}</div>
                <div style={{ marginTop:4, color:'var(--text-3)' }}>
                  {settings.cover_footer_text?.trim() || `${settings.company_name?.trim() || 'CognifAI'} · QMS DocControl · ISO 9001 & ISO 27001`}
                </div>
              </div>
            </div>

            <div style={{ fontSize:11, fontWeight:600, textTransform:'uppercase', letterSpacing:'.06em', color:'var(--text-3)', marginBottom:6 }}>Page 2 — Document Details</div>
            <div style={{ background:'var(--bg)', border:'1px solid var(--border)', borderRadius:'var(--radius-md)', padding:'1.25rem', marginBottom:12, position:'relative', overflow:'hidden' }}>
              <div style={{ position:'absolute', inset:0, display:'flex', alignItems:'center', justifyContent:'center', pointerEvents:'none', opacity:0.07, transform:'rotate(-45deg)', fontSize:36, fontWeight:900, color: doc.status==='Approved'?'#1A56DB':'#F0AD4E', whiteSpace:'nowrap', letterSpacing:2 }}>
                {doc.status==='Approved' ? 'UNCONTROLLED COPY' : 'DRAFT — NOT FOR USE'}
              </div>
              <div style={{ background:'#1A56DB', borderRadius:4, padding:'4px 10px', marginBottom:10, display:'inline-block' }}>
                <span style={{ color:'#fff', fontSize:10, fontWeight:600 }}>QMS DocControl · ISO 9001 & ISO 27001</span>
              </div>
              <div style={{ background:'var(--bg-hover)', borderRadius:4, padding:'8px 12px', marginBottom:10 }}>
                <div style={{ fontSize:16, fontWeight:700 }}>{doc.title}</div>
                <div style={{ fontSize:11, color:'var(--text-2)', marginTop:2 }}>{doc.id} · v{doc.version} · {doc.standard}</div>
              </div>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'4px 0', fontSize:12, marginBottom:10 }}>
                {[['Document ID',doc.id],['Type',doc.type],['Standard',doc.standard],['Clause',doc.clause||'—'],['Version',`v${doc.version}`],['Version Date',fmtDateTime(doc.version_date)],['Status',doc.status],['Owner',doc.owner||'—'],['Next Review',fmtDate(doc.review_date)]].map(([l,v])=>(
                  <div key={l} style={{ display:'flex', gap:6 }}><span style={{ color:'var(--text-2)', width:90, flexShrink:0 }}>{l}:</span><span style={{ fontWeight:500 }}>{v}</span></div>
                ))}
              </div>
              <div style={{ borderTop:'1px solid var(--border)', paddingTop:8, marginBottom:8 }}>
                <div style={{ fontSize:10, fontWeight:600, color:'var(--text-2)', marginBottom:3 }}>SCOPE</div>
                <div className="quill-render" style={{ fontSize:12, color:'var(--text-2)' }}
                  dangerouslySetInnerHTML={{ __html: doc.scope || '—' }}/>
              </div>
              {primaryFile && (
                <div style={{ borderTop:'1px solid var(--border)', paddingTop:8, marginBottom:6 }}>
                  <div style={{ fontSize:10, fontWeight:600, color:'var(--text-2)', marginBottom:3 }}>PRIMARY DOCUMENT</div>
                  <div style={{ fontSize:12, display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
                    <span>{primaryFile.originalname} <span style={{ color:'var(--text-2)' }}>(see page 2)</span></span>
                    {isPreviewableFile(primaryFile.mimetype, primaryFile.originalname) && (
                      <button className="btn btn-sm btn-ghost" style={{ padding:'2px 8px' }} onClick={()=>setViewFile(primaryFile)}>
                        <Eye size={12}/> View
                      </button>
                    )}
                    <button className="btn btn-sm btn-ghost" style={{ padding:'2px 8px' }} onClick={()=>downloadFile(primaryFile.id, primaryFile.originalname)}>
                      <Download size={12}/> Download
                    </button>
                  </div>
                </div>
              )}
              {supportingFiles.length > 0 && (
                <div style={{ borderTop:'1px solid var(--border)', paddingTop:8 }}>
                  <div style={{ fontSize:10, fontWeight:600, color:'var(--text-2)', marginBottom:3 }}>SUPPORTING ATTACHMENTS</div>
                  {supportingFiles.map(f=>{
                    const isCreated = f.mimetype === 'application/x-qms-document';
                    const hasContent = attachments.some(a => a.title === f.originalname);
                    return (
                    <div key={f.id} style={{ fontSize:12, color:'var(--text-2)', display:'flex', alignItems:'center', gap:8, padding:'2px 0', flexWrap:'wrap' }}>
                      <span>
                        {f.file_category === 'evidence' ? '[Evidence] ' : ''}{f.originalname}
                        {' '}({isCreated ? 'Created document' : formatBytes(f.size)})
                        {hasContent && <span style={{ color:'var(--accent)' }}> · included in PDF</span>}
                      </span>
                      {!isCreated && isPreviewableFile(f.mimetype, f.originalname) && (
                        <button className="btn btn-sm btn-ghost" style={{ padding:'2px 8px' }} onClick={()=>setViewFile(f)}>
                          <Eye size={12}/> View
                        </button>
                      )}
                      {!isCreated && (
                        <button className="btn btn-sm btn-ghost" style={{ padding:'2px 8px' }} onClick={()=>downloadFile(f.id, f.originalname)}>
                          <Download size={12}/> Download
                        </button>
                      )}
                    </div>
                    );
                  })}
                </div>
              )}
            </div>

            {wordText ? (
              <>
                <div style={{ fontSize:11, fontWeight:600, textTransform:'uppercase', letterSpacing:'.06em', color:'var(--text-3)', marginBottom:6 }}>Document Content</div>
                <div style={{ background:'var(--bg)', border:'1px solid var(--border)', borderRadius:'var(--radius-md)', padding:'1rem 1.25rem', marginBottom:12, maxHeight:220, overflowY:'auto', position:'relative' }}>
                  <div style={{ position:'absolute', inset:0, display:'flex', alignItems:'center', justifyContent:'center', pointerEvents:'none', opacity:0.06, transform:'rotate(-45deg)', fontSize:32, fontWeight:900, color: doc.status==='Approved'?'#1A56DB':'#F0AD4E', whiteSpace:'nowrap' }}>
                    {doc.status==='Approved' ? 'UNCONTROLLED COPY' : 'DRAFT — NOT FOR USE'}
                  </div>
                  <pre style={{ fontSize:11, lineHeight:1.6, whiteSpace:'pre-wrap', fontFamily:'var(--font)', color:'var(--text-2)' }}>
                    {wordText.slice(0, 1500)}{wordText.length > 1500 ? '\n\n... (content continues in PDF)' : ''}
                  </pre>
                </div>
              </>
            ) : wordHint === 'save_as_docx' ? (
              <div style={{ background:'#FFF3CD', border:'1px solid #EFC97A', borderRadius:'var(--radius-md)', padding:'14px 16px', marginBottom:12 }}>
                <div style={{ fontWeight:600, fontSize:13, color:'#7D4E00', marginBottom:6 }}>Old .doc format detected</div>
                <div style={{ fontSize:13, color:'#7D4E00', lineHeight:1.6 }}>
                  This file is in the old Word 97-2003 (.doc) format which cannot be read for PDF content extraction.
                  The PDF will include the cover page only until a .docx version is uploaded.
                </div>
              </div>
            ) : primaryFile ? (
              <div style={{ fontSize:12, color:'var(--text-2)', marginBottom:12, padding:'8px 12px', background:'var(--amber-bg)', borderRadius:'var(--radius-sm)', border:'1px solid #EFC97A' }}>
                Primary document is not a Word file — content preview not available. The PDF will include the cover page only.
              </div>
            ) : null}

            {attachments.length > 0 && (
              <>
                <div style={{ fontSize:11, fontWeight:600, textTransform:'uppercase', letterSpacing:'.06em', color:'var(--text-3)', marginBottom:6 }}>
                  Attachment Content ({attachments.length})
                </div>
                {attachments.map((a, i) => (
                  <div key={i} style={{ background:'var(--bg)', border:'1px solid var(--border)', borderRadius:'var(--radius-md)', padding:'0.75rem 1rem', marginBottom:8 }}>
                    <div style={{ fontSize:12, fontWeight:600, marginBottom:4, display:'flex', alignItems:'center', gap:6 }}>
                      {a.title}
                      <span className={`pill ${a.category==='evidence' ? 'pill-green' : ''}`} style={{ fontSize:9 }}>
                        {a.category === 'evidence' ? 'EVIDENCE' : 'SUPPORTING'}
                      </span>
                    </div>
                    {a.html ? (
                      <div className="quill-render" style={{ fontSize:11, color:'var(--text-2)', maxHeight:140, overflowY:'auto', lineHeight:1.5 }}
                        dangerouslySetInnerHTML={{ __html: a.html }}/>
                    ) : (
                      <div style={{ fontSize:11, color:'var(--text-2)', maxHeight:80, overflow:'hidden', lineHeight:1.5 }}>
                        {a.text.slice(0, 300)}{a.text.length > 300 ? '…' : ''}
                      </div>
                    )}
                  </div>
                ))}
                <div style={{ fontSize:11, color:'var(--text-3)', marginBottom:12 }}>
                  These will appear as additional pages in the PDF, after the primary document content and before the Version History page.
                </div>
              </>
            )}

            <div style={{ fontSize:11, fontWeight:600, textTransform:'uppercase', letterSpacing:'.06em', color:'var(--text-3)', marginTop:14, marginBottom:6 }}>Final Page — Version History</div>
            <div style={{ background:'var(--bg)', border:'1px solid var(--border)', borderRadius:'var(--radius-md)', padding:'0.75rem', marginBottom:12, maxHeight:140, overflowY:'auto' }}>
              {filteredHistory.length === 0 ? (
                <div style={{ fontSize:12, color:'var(--text-2)', padding:'4px 6px' }}>No version history recorded yet.</div>
              ) : (
                <table style={{ width:'100%', fontSize:11, borderCollapse:'collapse' }}>
                  <thead>
                    <tr style={{ textAlign:'left', color:'var(--text-2)', borderBottom:'1px solid var(--border)' }}>
                      <th style={{ padding:'4px 6px' }}>Version</th>
                      <th style={{ padding:'4px 6px' }}>Date</th>
                      <th style={{ padding:'4px 6px' }}>Description</th>
                      <th style={{ padding:'4px 6px' }}>Created By</th>
                      <th style={{ padding:'4px 6px' }}>Approved By</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredHistory.map(h => (
                      <tr key={h.id} style={{ borderBottom:'1px solid var(--border)' }}>
                        <td style={{ padding:'4px 6px', fontFamily:'var(--mono)' }}>v{h.version}</td>
                        <td style={{ padding:'4px 6px', color:'var(--text-2)' }}>{h.changed_at ? h.changed_at.slice(0,16).replace('T',' ') : '—'}</td>
                        <td style={{ padding:'4px 6px', color:'var(--text-2)' }}>{h.change_note || '—'}</td>
                        <td style={{ padding:'4px 6px' }}>{h.author || '—'}</td>
                        <td style={{ padding:'4px 6px' }}>{h.approved_by || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div style={{ fontSize:12, color:'var(--text-2)', marginBottom:12, display:'flex', alignItems:'center', gap:6 }}>
              <AlertCircle size={14}/>
              PDF watermark: <strong style={{ color: doc.status==='Approved'?'var(--accent)':'var(--amber)' }}>
                {doc.status==='Approved' ? '"UNCONTROLLED COPY"' : '"DRAFT — NOT FOR USE"'}
              </strong>
              <span style={{ color:'var(--text-3)' }}> · Page numbers shown as "Page X of Y" on every page</span>
            </div>

            <div className="modal-footer" style={{ paddingTop:0, border:'none', marginTop:0 }}>
              <button className="btn" onClick={onClose}>Close</button>
              <button className="btn btn-primary" onClick={handleDownloadPDF}>
                <FileDown size={14}/> Download PDF
              </button>
            </div>
          </>
        )}
      </div>

      {viewFile && (
        <div className="modal-overlay" onClick={(e)=>{ e.stopPropagation(); setViewFile(null); }}>
          <div className="modal modal-lg" onClick={e=>e.stopPropagation()} style={{ maxWidth:800, width:'90vw' }}>
            <div className="flex-between mb-12">
              <div style={{ fontWeight:600, fontSize:16 }}>{viewFile.originalname}</div>
              <div style={{ display:'flex', gap:8 }}>
                <button className="btn btn-sm" onClick={()=>downloadFile(viewFile.id, viewFile.originalname)}>
                  <Download size={13}/> Download
                </button>
                <button className="btn btn-ghost btn-icon" onClick={()=>setViewFile(null)}><X size={16}/></button>
              </div>
            </div>

            {viewFileLoading || !viewFileBlobUrl ? (
              <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'70vh', background:'var(--bg-hover)', borderRadius:'var(--radius-md)' }}>
                <Spinner/>
              </div>
            ) : isImageFile(viewFile.mimetype, viewFile.originalname) ? (
              <div style={{ textAlign:'center', maxHeight:'70vh', overflow:'auto', background:'var(--bg-hover)', borderRadius:'var(--radius-md)', padding:8 }}>
                <img src={viewFileBlobUrl} alt={viewFile.originalname} style={{ maxWidth:'100%', height:'auto' }}/>
              </div>
            ) : (
              <iframe
                src={viewFileBlobUrl}
                title={viewFile.originalname}
                style={{ width:'100%', height:'70vh', border:'1px solid var(--border)', borderRadius:'var(--radius-md)' }}
              />
            )}

            <div className="modal-footer">
              <button className="btn" onClick={()=>setViewFile(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
