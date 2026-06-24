import React, { useState, useEffect } from 'react';
import { X, CheckCircle, XCircle, Paperclip, Download, Eye } from 'lucide-react';
import toast from 'react-hot-toast';
import { getCapa, getCapaFiles, downloadFile, fetchFileBytes } from '../api';
import { capaStatusPill, approvalStatusPill, fmtDate, fmtDateTime, Spinner, SectionHead } from './UI';

function formatBytes(b) {
  if (b < 1024) return `${b} B`;
  if (b < 1048576) return `${(b/1024).toFixed(1)} KB`;
  return `${(b/1048576).toFixed(1)} MB`;
}

function isPreviewableFile(mimetype = '', originalname = '') {
  const ext = (originalname || '').toLowerCase();
  const isPdf = mimetype === 'application/pdf' || ext.endsWith('.pdf');
  const isImage = mimetype.startsWith('image/') || /\.(png|jpe?g|gif|webp|svg)$/.test(ext);
  return isPdf || isImage;
}
function isImageFile(mimetype = '', originalname = '') {
  const ext = (originalname || '').toLowerCase();
  return mimetype.startsWith('image/') || /\.(png|jpe?g|gif|webp|svg)$/.test(ext);
}

function shouldShowApprovalPill(c) {
  if (!c.approval_status || c.approval_status === 'Not Submitted') return false;
  if (c.approval_status === 'Approved' && c.status === 'Approved & Closed') return false;
  return true;
}

export default function CapaPreviewModal({ capaId, step, onClose, onApprove, onReject }) {
  const [capa, setCapa]       = useState(null);
  const [files, setFiles]     = useState([]);
  const [loading, setLoading] = useState(true);
  const [viewCreatedDoc, setViewCreatedDoc] = useState(null);
  const [viewUploadedFile, setViewUploadedFile] = useState(null);
  const [viewFileBlobUrl, setViewFileBlobUrl] = useState(null);
  const [viewFileLoading, setViewFileLoading] = useState(false);

  useEffect(() => {
    if (!viewUploadedFile) { setViewFileBlobUrl(null); return; }
    let cancelled = false;
    setViewFileLoading(true);
    setViewFileBlobUrl(null);
    fetchFileBytes(viewUploadedFile.id).then(bytes => {
      if (cancelled) return;
      const blob = new Blob([bytes], { type: viewUploadedFile.mimetype || 'application/octet-stream' });
      setViewFileBlobUrl(URL.createObjectURL(blob));
    }).catch(() => {
      if (!cancelled) toast.error('Failed to load file preview');
    }).finally(() => {
      if (!cancelled) setViewFileLoading(false);
    });
    return () => { cancelled = true; };
  }, [viewUploadedFile]);

  useEffect(() => {
    return () => { if (viewFileBlobUrl) URL.revokeObjectURL(viewFileBlobUrl); };
  }, [viewFileBlobUrl]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const [capaData, fileData] = await Promise.all([
          getCapa(capaId),
          getCapaFiles(capaId).catch(() => []),
        ]);
        if (cancelled) return;
        setCapa(capaData);
        setFiles(fileData);
      } catch (err) {
        toast.error('Failed to load record for preview');
        onClose?.();
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [capaId]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-lg" onClick={e=>e.stopPropagation()} style={{ maxWidth:680 }}>
        <div className="flex-between mb-12">
          <div style={{ fontWeight:600, fontSize:16 }}>NCR / CAPA Record Preview</div>
          <button className="btn btn-ghost btn-icon" onClick={onClose}><X size={16}/></button>
        </div>

        {loading || !capa ? <Spinner/> : (
          <>
            <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:6, flexWrap:'wrap' }}>
              <span className="pill pill-gray" style={{ fontSize:10 }}>{capa.type}</span>
              {capaStatusPill(capa.status)}
              {shouldShowApprovalPill(capa) && approvalStatusPill(capa.approval_status)}
              <span style={{ fontFamily:'var(--mono)', fontSize:11, color:'var(--text-2)' }}>{capa.id}</span>
            </div>
            <div style={{ fontWeight:600, fontSize:15, marginBottom:6 }}>{capa.title}</div>
            <div style={{ fontSize:12, color:'var(--text-2)', marginBottom:14, display:'flex', gap:12, flexWrap:'wrap' }}>
              <span>Owner: {capa.owner || '—'}</span>
              <span>Due {fmtDate(capa.due_date)}</span>
              <span>{capa.clause || '—'}</span>
              <span>{capa.source || '—'}</span>
              <span>Raised {fmtDate(capa.raised_at)}</span>
            </div>

            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:20, marginBottom:14 }}>
              <div>
                <SectionHead>Nonconformity Detail</SectionHead>
                <p style={{ fontSize:13, color:'var(--text-2)' }}>{capa.detail || 'No detail provided.'}</p>
                <SectionHead style={{ marginTop:12 }}>Root Cause</SectionHead>
                <p style={{ fontSize:13, color:'var(--text-2)' }}>{capa.root_cause || 'Pending investigation.'}</p>
              </div>
              <div>
                <SectionHead>Corrective Action</SectionHead>
                <p style={{ fontSize:13, color:'var(--text-2)' }}>{capa.action || 'No action recorded yet.'}</p>
                {capa.closed_at && (
                  <>
                    <SectionHead style={{ marginTop:12 }}>Closed On</SectionHead>
                    <p style={{ fontSize:13 }}>{fmtDateTime(capa.closed_at)}</p>
                  </>
                )}
              </div>
            </div>

            <SectionHead>Supporting Evidence</SectionHead>
            <div style={{ marginBottom:14 }}>
              {files.length === 0 ? (
                <div style={{ fontSize:13, color:'var(--text-2)', padding:'8px 0' }}>No evidence attached.</div>
              ) : files.map(file => {
                const isCreated = file.mimetype === 'application/x-qms-document';
                return (
                  <div key={file.id} style={{ display:'flex', alignItems:'center', gap:10, padding:'8px 12px', background:'var(--green-bg)', border:'1px solid #B8E0A0', borderRadius:'var(--radius-md)', marginBottom:6 }}>
                    <Paperclip size={14}/>
                    <div style={{ flex:1 }}>
                      <div style={{ fontSize:13, fontWeight:500 }}>
                        {file.originalname}
                        {isCreated && <span className="pill" style={{ fontSize:9, marginLeft:6, background:'#EFE6FB', color:'#6940A5' }}>CREATED</span>}
                      </div>
                      <div style={{ fontSize:11, color:'var(--text-2)' }}>{isCreated ? `${file.size} chars` : formatBytes(file.size)} · {file.uploaded_by} · {fmtDateTime(file.uploaded_at)}</div>
                    </div>
                    {isCreated ? (
                      <button className="btn btn-sm" onClick={()=>setViewCreatedDoc(file)}><Eye size={13}/> View</button>
                    ) : isPreviewableFile(file.mimetype, file.originalname) ? (
                      <button className="btn btn-sm" onClick={()=>setViewUploadedFile(file)}><Eye size={13}/> View</button>
                    ) : (
                      <button className="btn btn-sm btn-green" onClick={()=>downloadFile(file.id, file.originalname)}><Download size={13}/> Download</button>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="modal-footer" style={{ paddingTop:0, border:'none', marginTop:0 }}>
              <button className="btn" onClick={onClose}>Close</button>
              {step && (
                <>
                  <button className="btn btn-green" onClick={() => onApprove?.(step)}>
                    <CheckCircle size={14}/> Approve
                  </button>
                  <button className="btn btn-red" onClick={() => onReject?.(step)}>
                    <XCircle size={14}/> Reject
                  </button>
                </>
              )}
            </div>
          </>
        )}
      </div>

      {viewCreatedDoc && (
        <div className="modal-overlay" onClick={(e)=>{ e.stopPropagation(); setViewCreatedDoc(null); }}>
          <div className="modal modal-lg" onClick={e=>e.stopPropagation()} style={{ maxWidth:680 }}>
            <div className="flex-between mb-12">
              <div style={{ fontWeight:600, fontSize:16, display:'flex', alignItems:'center', gap:8 }}>
                {viewCreatedDoc.originalname}
                <span className="pill" style={{ fontSize:9, background:'#EFE6FB', color:'#6940A5' }}>CREATED</span>
                <span className="pill pill-green" style={{ fontSize:9 }}>EVIDENCE</span>
              </div>
              <button className="btn btn-ghost btn-icon" onClick={()=>setViewCreatedDoc(null)}><X size={16}/></button>
            </div>
            <div className="quill-render" style={{ fontSize:13, maxHeight:'60vh', overflowY:'auto', padding:'4px 2px' }}
              dangerouslySetInnerHTML={{ __html: viewCreatedDoc.content_html || '<p>No content.</p>' }}/>
            <div className="modal-footer">
              <button className="btn" onClick={()=>setViewCreatedDoc(null)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {viewUploadedFile && (
        <div className="modal-overlay" onClick={(e)=>{ e.stopPropagation(); setViewUploadedFile(null); }}>
          <div className="modal modal-lg" onClick={e=>e.stopPropagation()} style={{ maxWidth:800, width:'90vw' }}>
            <div className="flex-between mb-12">
              <div style={{ fontWeight:600, fontSize:16, display:'flex', alignItems:'center', gap:8 }}>
                {viewUploadedFile.originalname}
                <span className="pill pill-green" style={{ fontSize:9 }}>EVIDENCE</span>
              </div>
              <div style={{ display:'flex', gap:8 }}>
                <button className="btn btn-sm" onClick={()=>downloadFile(viewUploadedFile.id, viewUploadedFile.originalname)}>
                  <Download size={13}/> Download
                </button>
                <button className="btn btn-ghost btn-icon" onClick={()=>setViewUploadedFile(null)}><X size={16}/></button>
              </div>
            </div>

            {viewFileLoading || !viewFileBlobUrl ? (
              <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'70vh', background:'var(--bg-hover)', borderRadius:'var(--radius-md)' }}>
                <Spinner/>
              </div>
            ) : isImageFile(viewUploadedFile.mimetype, viewUploadedFile.originalname) ? (
              <div style={{ textAlign:'center', maxHeight:'70vh', overflow:'auto', background:'var(--bg-hover)', borderRadius:'var(--radius-md)', padding:8 }}>
                <img src={viewFileBlobUrl} alt={viewUploadedFile.originalname} style={{ maxWidth:'100%', height:'auto' }}/>
              </div>
            ) : (
              <iframe
                src={viewFileBlobUrl}
                title={viewUploadedFile.originalname}
                style={{ width:'100%', height:'70vh', border:'1px solid var(--border)', borderRadius:'var(--radius-md)' }}
              />
            )}

            <div className="modal-footer">
              <button className="btn" onClick={()=>setViewUploadedFile(null)}>Close</button>
              {step && (
                <>
                  <button className="btn btn-green" onClick={() => { setViewUploadedFile(null); onApprove?.(step); }}>
                    <CheckCircle size={14}/> Approve
                  </button>
                  <button className="btn btn-red" onClick={() => { setViewUploadedFile(null); onReject?.(step); }}>
                    <XCircle size={14}/> Reject
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
