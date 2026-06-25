import React, { useState, useRef, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import dynamic from 'next/dynamic';
const RichTextEditor = dynamic(() => import('../components/RichTextEditor'), { ssr: false });
import {
  Plus, Search, Edit2, Trash2, History, Send,
  Upload, Download, FileText, File, Paperclip, X,
  FileDown, BookOpen, Shield, Eye, AlertCircle,
  CheckCircle, RefreshCw, Lock, FilePlus, FileUp, PenLine, Archive
} from 'lucide-react';
import toast from 'react-hot-toast';
import {
  getDocuments, createDocument, updateDocument, deleteDocument,
  getDocHistory, getUsers, submitWorkflow,
  getDocFiles, uploadFile, downloadFile, deleteFile,
  checkFileChanged, confirmFileChange, dismissFileChange,
  getDocAccess, grantAccess, revokeAccess, updateSystemRole,
  getPdfData, fixPrimary, getSettings,
  createDocAttachment, updateDocAttachment,
} from '../api';
import {
  statusPill, standardPill, typePill, reviewPill,
  fmtDateTime, Spinner, EmptyState, Modal,
  ConfirmDialog, SectionHead,
} from '../components/UI';
import { CURRENT_USER } from '../components/AppShell';
import DocumentPreviewModal from '../components/DocumentPreviewModal';
import { exportSingleDocumentPDF, exportDocumentsPDF } from '../utils/pdfExport';

const DEFAULT_TYPES = ['SOP','Policy','Evidence','Work Instruction','Form/Template','Record'];
const STATUSES  = ['Draft','Under Review','Approved','Retired'];
const EDITABLE_STATUSES = ['Draft','Under Review','Approved'];
const STANDARDS = ['ISO 9001','ISO 27001','Both'];
const EMPTY_DOC = {
  id:'', title:'', type:'SOP', standard:'ISO 9001', clause:'', version:'1.0',
  status:'Draft', owner:'', owner_id:'', review_date:'', scope:'', evidence:[], change_note:'',
};

function fileIcon(mimetype = '') {
  if (mimetype === 'application/x-qms-document') return <FileText size={14} color="#6940A5"/>;
  if (mimetype.includes('word'))  return <FileText size={14} color="#1A56DB"/>;
  if (mimetype.includes('pdf'))   return <FileText size={14} color="#CC0000"/>;
  if (mimetype.includes('excel') || mimetype.includes('spreadsheet')) return <FileText size={14} color="#1A7F37"/>;
  if (mimetype.includes('image')) return <FileText size={14} color="#9A5700"/>;
  return <File size={14}/>;
}
function formatBytes(b) {
  if (b < 1024) return `${b} B`;
  if (b < 1048576) return `${(b/1024).toFixed(1)} KB`;
  return `${(b/1048576).toFixed(1)} MB`;
}
function isWordFile(mimetype = '', originalname = '') {
  const ext = originalname.toLowerCase();
  return mimetype.includes('word') || mimetype.includes('msword') ||
    mimetype === 'application/octet-stream' && (ext.endsWith('.doc') || ext.endsWith('.docx')) ||
    ext.endsWith('.doc') || ext.endsWith('.docx');
}

function bumpVersion(current) {
  const parts = String(current).split('.');
  if (parts.length >= 3) {
    parts[parts.length - 1] = String(Number(parts[parts.length - 1]) + 1);
    return parts.join('.');
  }
  if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
    return `${parts[0]}.${Number(parts[1]) + 1}`;
  }
  return `${current}.1`;
}

function hasAnyChange(original, edited, evidenceArr) {
  if (original.title !== edited.title) return true;
  if (original.type !== edited.type) return true;
  if (original.standard !== edited.standard) return true;
  if ((original.clause || '') !== (edited.clause || '')) return true;
  if ((original.scope || '') !== (edited.scope || '')) return true;
  if ((original.owner || '') !== (edited.owner || '')) return true;
  if ((original.review_date || '') !== (edited.review_date || '')) return true;
  if ((original.status || '') !== (edited.status || '')) return true;
  const origEvidence = JSON.stringify(original.evidence || []);
  const newEvidence  = JSON.stringify(evidenceArr || []);
  if (origEvidence !== newEvidence) return true;
  return false;
}

export default function Documents() {
  const qc = useQueryClient();
  const uploadDocRef  = useRef(null);
  const evidenceInputRef = useRef(null);

  const [search, setSearch]     = useState('');
  const [filterType, setType]   = useState('');
  const [filterStatus, setSt]   = useState('');
  const [filterStd, setStd]     = useState('');

  const [docModal, setDocModal]       = useState(false);
  const [editDoc, setEditDoc]         = useState(null);
  const [form, setForm]               = useState(EMPTY_DOC);
  const [evidenceInput, setEvidInput] = useState('');
  const [pendingFile, setPendingFile] = useState(null);
  const [pendingEvidence, setPendingEvidence] = useState([]);

  const [detailId, setDetail]   = useState(null);
  const [historyId, setHistory] = useState(null);
  const [filesId, setFilesId]   = useState(null);
  const [accessId, setAccessId] = useState(null);

  const [changeDetected, setChangeDetected] = useState(null);
  const [changeNote, setChangeNote]         = useState('');
  const [checking, setChecking]             = useState(null);

  const [previewDocId, setPreviewDocId] = useState(null);

  const [accessDocId, setAccessDocId] = useState(null);
  const [grantUserId, setGrantUserId] = useState('');
  const [grantPerm, setGrantPerm]     = useState('view');

  const [delTarget, setDel]     = useState(null);
  const [delFile, setDelFile]   = useState(null);
  const [uploading, setUploading] = useState(false);
  const [exportingPDF, setExporting] = useState(false);

  const [attachModal, setAttachModal]   = useState(null);
  const [attachType, setAttachType]     = useState('supporting');
  const [attachMethod, setAttachMethod] = useState('upload');
  const [attachFile, setAttachFile]     = useState(null);
  const [attachTitle, setAttachTitle]   = useState('');
  const [attachContent, setAttachContent] = useState('');
  const attachFileRef = useRef(null);

  const [viewCreatedDoc, setViewCreatedDoc] = useState(null);

  const { data: docs = [], isLoading } = useQuery({
    queryKey: ['documents', search, filterType, filterStatus, filterStd],
    queryFn:  () => getDocuments({ search, type: filterType, status: filterStatus, standard: filterStd }),
  });
  const { data: users = [] } = useQuery({ queryKey:['users'], queryFn: getUsers });
  const { data: pdfSettings = {} } = useQuery({ queryKey:['settings'], queryFn: getSettings });

  const TYPES = useMemo(() => {
    if (pdfSettings.document_types) {
      try {
        const parsed = JSON.parse(pdfSettings.document_types);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      } catch (_) {}
    }
    return DEFAULT_TYPES;
  }, [pdfSettings.document_types]);

  const { data: history = [], isLoading: histLoading } = useQuery({
    queryKey: ['docHistory', historyId],
    queryFn:  () => getDocHistory(historyId),
    enabled:  !!historyId,
  });
  const { data: docFiles = [], isLoading: filesLoading } = useQuery({
    queryKey: ['docFiles', filesId],
    queryFn:  () => getDocFiles(filesId),
    enabled:  !!filesId,
  });
  const { data: accessList = [] } = useQuery({
    queryKey: ['access', accessDocId],
    queryFn:  () => getDocAccess(accessDocId),
    enabled:  !!accessDocId,
  });

  const saveMut = useMutation({
    mutationFn: data => editDoc ? updateDocument(editDoc.id, data) : createDocument(data),
    onSuccess: async (saved, variables) => {
      qc.invalidateQueries(['documents']); qc.invalidateQueries(['stats']);
      const assigneeChanged = !editDoc
        ? !!variables.owner_id
        : String(variables.owner_id || '') !== String(editDoc.owner_id || '');
      const assigneeName = users.find(u => u.id === variables.owner_id)?.name;
      if (assigneeChanged && assigneeName) {
        toast.success(`${editDoc ? 'Document updated' : 'Document created'} — ${assigneeName} notified`);
      } else {
        toast.success(editDoc ? 'Document updated' : 'Document created');
      }
      if (!editDoc && pendingFile) {
        await doUpload(saved.id, pendingFile, 'primary', true);
        setPendingFile(null);
      }
      if (!editDoc && pendingEvidence.length > 0) {
        for (const file of pendingEvidence) {
          await doUpload(saved.id, file, 'evidence', true);
        }
        toast.success(`${pendingEvidence.length} evidence file${pendingEvidence.length>1?'s':''} uploaded`);
        setPendingEvidence([]);
      }
      setDocModal(false);
    },
    onError: e => toast.error(e.response?.data?.error || 'Save failed'),
  });

  const delMut = useMutation({
    mutationFn: id => deleteDocument(id),
    onSuccess: () => { qc.invalidateQueries(['documents']); qc.invalidateQueries(['stats']); toast.success('Deleted'); },
    onError: e => toast.error(e.response?.data?.error || 'Delete failed'),
  });

  const submitMut = useMutation({
    mutationFn: data => submitWorkflow(data),
    onSuccess: (_, variables) => {
      qc.invalidateQueries(['documents']); qc.invalidateQueries(['stats']);
      toast.success(variables.purpose === 'retirement' ? 'Submitted for retirement approval' : 'Submitted for approval');
      setSubmitModal(null); setApproverIds([]);
    },
    onError: e => toast.error(e.response?.data?.error || 'Submit failed'),
  });

  const delFileMut = useMutation({
    mutationFn: id => deleteFile(id),
    onSuccess: () => { qc.invalidateQueries(['docFiles']); toast.success('File deleted'); },
    onError: e => toast.error(e.response?.data?.error || 'Delete failed'),
  });

  const fixPrimaryMut = useMutation({
    mutationFn: docId => fixPrimary(docId),
    onSuccess: (data) => {
      qc.invalidateQueries(['docFiles']);
      if (data.fixed) toast.success('Primary document detected and set automatically');
      else toast.error('No Word file found to set as primary');
    },
    onError: e => toast.error(e.response?.data?.error || 'Failed'),
  });

  const createAttachmentMut = useMutation({
    mutationFn: ({ docId, data }) => createDocAttachment(docId, data),
    onSuccess: () => {
      qc.invalidateQueries(['docFiles']);
      toast.success('Document created and attached');
      closeAttachModal();
    },
    onError: e => toast.error(e.response?.data?.error || 'Failed to create document'),
  });

  const updateAttachmentMut = useMutation({
    mutationFn: ({ fileId, data }) => updateDocAttachment(fileId, data),
    onSuccess: () => {
      qc.invalidateQueries(['docFiles']);
      toast.success('Document updated');
      closeAttachModal();
    },
    onError: e => toast.error(e.response?.data?.error || 'Failed to update document'),
  });

  const confirmChangeMut = useMutation({
    mutationFn: ({ fileId, change_note, selectedFile }) => {
      const fd = new FormData();
      fd.append('change_note', change_note);
      fd.append('confirmed_by', CURRENT_USER.name);
      if (selectedFile) fd.append('file', selectedFile);
      return confirmFileChange(fileId, fd);
    },
    onSuccess: (data) => {
      qc.invalidateQueries(['documents']); qc.invalidateQueries(['docFiles']);
      qc.invalidateQueries(['docHistory', changeDetected?.docId]);
      toast.success(`Version bumped to ${data.newVersion} — document returned to Draft for re-approval`);
      setChangeDetected(null); setChangeNote('');
    },
    onError: e => toast.error(e.response?.data?.error || 'Failed to record change'),
  });

  const dismissChangeMut = useMutation({
    mutationFn: ({ fileId, selectedFile }) => {
      const fd = new FormData();
      if (selectedFile) fd.append('file', selectedFile);
      return dismissFileChange(fileId, fd);
    },
    onSuccess: () => {
      qc.invalidateQueries(['docFiles']);
      toast.success('No version change recorded — file saved');
      setChangeDetected(null);
    },
    onError: e => toast.error(e.response?.data?.error || 'Failed'),
  });

  const grantMut = useMutation({
    mutationFn: () => grantAccess(accessDocId, { user_id: parseInt(grantUserId), permission: grantPerm, granted_by: CURRENT_USER.name }),
    onSuccess: () => { qc.invalidateQueries(['access', accessDocId]); toast.success('Access granted'); setGrantUserId(''); },
    onError: e => toast.error(e.response?.data?.error || 'Failed'),
  });

  const revokeMut = useMutation({
    mutationFn: (userId) => revokeAccess(accessDocId, userId),
    onSuccess: () => { qc.invalidateQueries(['access', accessDocId]); toast.success('Access revoked'); },
    onError: e => toast.error(e.response?.data?.error || 'Failed'),
  });

  const roleUpdateMut = useMutation({
    mutationFn: ({ userId, role }) => updateSystemRole(userId, role),
    onSuccess: () => { qc.invalidateQueries(['users']); toast.success('Role updated'); },
    onError: e => toast.error(e.response?.data?.error || 'Failed'),
  });

  const [submitModal, setSubmitModal] = useState(null);
  const [submitPurpose, setSubmitPurpose] = useState('approval');
  const [approverIds, setApproverIds] = useState([]);

  async function doUpload(docId, file, category = 'supporting', quiet = false) {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('uploaded_by', CURRENT_USER.name);
      fd.append('file_category', category);
      await uploadFile(docId, fd);
      qc.invalidateQueries(['docFiles', docId]);
      if (!quiet) toast.success(`"${file.name}" uploaded`);
    } catch (err) {
      toast.error(err.response?.data?.error || `Failed to upload "${file.name}"`);
    } finally { setUploading(false); }
  }

  function handleFileSelect(e, docId) {
    const file = e.target.files[0];
    if (!file) return;
    e.target.value = '';
    if (docId) {
      doUpload(docId, file);
    } else {
      setPendingFile(file);
    }
  }

  function openAttachModal(docId) {
    setAttachModal({ docId, editFile: null });
    setAttachType('supporting');
    setAttachMethod('upload');
    setAttachFile(null);
    setAttachTitle('');
    setAttachContent('');
  }

  function openEditAttachment(docId, file) {
    setAttachModal({ docId, editFile: file });
    setAttachType(file.file_category === 'evidence' ? 'evidence' : 'supporting');
    setAttachMethod('create');
    setAttachFile(null);
    setAttachTitle(file.originalname);
    setAttachContent(file.content_html || '');
  }

  function closeAttachModal() {
    setAttachModal(null);
    setAttachFile(null);
    setAttachTitle('');
    setAttachContent('');
  }

  function handleAttachSubmit() {
    if (!attachModal) return;
    const { docId, editFile } = attachModal;

    if (editFile) {
      if (!attachTitle.trim()) { toast.error('Please enter a title'); return; }
      updateAttachmentMut.mutate({ fileId: editFile.id, data: { title: attachTitle.trim(), content_html: attachContent } });
      return;
    }

    if (attachMethod === 'upload') {
      if (!attachFile) { toast.error('Please choose a file'); return; }
      doUpload(docId, attachFile, attachType);
      closeAttachModal();
    } else {
      if (!attachTitle.trim()) { toast.error('Please enter a title'); return; }
      createAttachmentMut.mutate({
        docId,
        data: {
          title: attachTitle.trim(),
          content_html: attachContent,
          file_category: attachType,
          uploaded_by: CURRENT_USER.name,
        },
      });
    }
  }

  const checkFileRef = useRef(null);
  const [checkingFor, setCheckingFor] = useState(null);

  function handleCheckChanges(file, doc) {
    setCheckingFor({ file, doc });
    setTimeout(() => checkFileRef.current?.click(), 50);
  }

  async function handleCheckFileSelected(e) {
    const selected = e.target.files[0];
    e.target.value = '';
    if (!selected || !checkingFor) return;

    setChecking(checkingFor.file.id);
    try {
      const fd = new FormData();
      fd.append('file', selected);
      const result = await checkFileChanged(checkingFor.file.id, fd);
      setChecking(null);

      if (result.changed) {
        setChangeDetected({
          fileId:       checkingFor.file.id,
          docId:        checkingFor.file.doc_id,
          originalname: checkingFor.file.originalname,
          doc:          checkingFor.doc,
          selectedFile: selected,
        });
        setChangeNote('');
      } else {
        toast.success('No changes detected — file is identical to the stored version');
      }
    } catch (err) {
      setChecking(null);
      toast.error('Change check failed: ' + (err.response?.data?.error || err.message));
    } finally {
      setCheckingFor(null);
    }
  }

  async function handleFullPDF() {
    setExporting(true);
    try {
      const data = await getPdfData();
      exportDocumentsPDF(data, pdfSettings);
      toast.success('Full register PDF downloaded');
    } catch { toast.error('PDF generation failed'); }
    finally { setExporting(false); }
  }

  function toggleSection(id, setter, current) { setter(current === id ? null : id); }
  function openNew()  { setEditDoc(null); setForm(EMPTY_DOC); setEvidInput(''); setPendingFile(null); setPendingEvidence([]); setVersionBumpPrompt(null); setDocModal(true); }
  function openEdit(doc) {
    setEditDoc(doc);
    setForm({ ...doc, evidence: doc.evidence || [], change_note: '' });
    setEvidInput((doc.evidence || []).join(', '));
    setVersionBumpPrompt(null);
    setDocModal(true);
  }
  function handleSave() {
    const evidenceArr = evidenceInput.split(',').map(s=>s.trim()).filter(Boolean);

    if (editDoc) {
      const anyChange = hasAnyChange(editDoc, form, evidenceArr);
      const versionManuallyChanged = String(form.version) !== String(editDoc.version);

      const onlyStatusChanged =
        editDoc.title === form.title &&
        editDoc.type === form.type &&
        editDoc.standard === form.standard &&
        (editDoc.clause || '') === (form.clause || '') &&
        (editDoc.scope || '') === (form.scope || '') &&
        (editDoc.owner || '') === (form.owner || '') &&
        (editDoc.review_date || '') === (form.review_date || '') &&
        JSON.stringify(editDoc.evidence || []) === JSON.stringify(evidenceArr || []) &&
        (editDoc.status || '') !== (form.status || '');

      if (anyChange && !versionManuallyChanged && !onlyStatusChanged) {
        const newVersion = bumpVersion(editDoc.version);
        setVersionBumpPrompt({
          oldVersion: editDoc.version,
          newVersion,
          pendingData: { ...form, evidence: evidenceArr },
        });
        return;
      }
    }

    saveMut.mutate({ ...form, evidence: evidenceArr, created_by: CURRENT_USER.name, updated_by: CURRENT_USER.name });
  }

  const [versionBumpPrompt, setVersionBumpPrompt] = useState(null);

  function acceptVersionBump() {
    if (!versionBumpPrompt) return;
    const { newVersion, pendingData, changeNote } = versionBumpPrompt;
    saveMut.mutate({
      ...pendingData,
      version: newVersion,
      change_note: changeNote?.trim() || `Content updated — version bumped to ${newVersion}`,
      created_by: CURRENT_USER.name,
      updated_by: CURRENT_USER.name,
    });
    setVersionBumpPrompt(null);
  }

  function rejectVersionBump() {
    setVersionBumpPrompt(null);
    setDocModal(false);
    toast('Changes discarded — document remains at the current version');
  }
  function toggleApprover(id) {
    setApproverIds(prev => prev.includes(id) ? prev.filter(x=>x!==id) : [...prev, id]);
  }

  const permColor = { edit:'var(--green)', view:'var(--accent)' };

  return (
    <div className="page">
      <div className="flex-between mb-16">
        <div>
          <div className="page-title">Documents</div>
          <div className="page-sub">SOPs, Policies, Evidence and all controlled documents</div>
        </div>
        <div style={{ display:'flex', gap:8 }}>
          <button className="btn" onClick={handleFullPDF} disabled={exportingPDF}>
            <BookOpen size={15}/>{exportingPDF ? 'Generating…' : 'Export Full Register PDF'}
          </button>
          <button className="btn btn-primary" onClick={openNew}><Plus size={15}/> New Document</button>
        </div>
      </div>

      <div className="toolbar mb-12">
        <div style={{ position:'relative', flex:1, minWidth:180 }}>
          <Search size={14} style={{ position:'absolute', left:9, top:'50%', transform:'translateY(-50%)', color:'var(--text-3)' }}/>
          <input style={{ paddingLeft:30 }} placeholder="Search title or ID…" value={search} onChange={e=>setSearch(e.target.value)}/>
        </div>
        <select value={filterType}   onChange={e=>setType(e.target.value)}>   <option value="">All types</option>    {TYPES.map(t=><option key={t}>{t}</option>)}</select>
        <select value={filterStatus} onChange={e=>setSt(e.target.value)}>     <option value="">All statuses</option> {STATUSES.map(s=><option key={s}>{s}</option>)}</select>
        <select value={filterStd}    onChange={e=>setStd(e.target.value)}>    <option value="">All standards</option>{STANDARDS.map(s=><option key={s}>{s}</option>)}</select>
      </div>

      {isLoading ? <Spinner/> : (
        <div className="card">
          <div className="table-wrap">
            <table>
              <thead><tr>
                <th>Document</th><th>ID</th><th>Type</th><th>Standard</th>
                <th>Version</th><th>Version Date</th><th>Status</th>
                <th>Next Review</th><th>Owner</th><th></th>
              </tr></thead>
              <tbody>
                {docs.length === 0 && (
                  <tr><td colSpan={10}><EmptyState title="No documents found" sub="Add a new document using the button above"/></td></tr>
                )}
                {docs.map(doc => (
                  <React.Fragment key={doc.id}>
                    <tr onClick={() => toggleSection(doc.id, setDetail, detailId)}>
                      <td style={{ fontWeight:500 }}>{doc.title}</td>
                      <td><span className="text-mono text-sm text-2">{doc.id}</span></td>
                      <td>{typePill(doc.type)}</td>
                      <td>{standardPill(doc.standard)}</td>
                      <td><span className="text-mono text-sm">v{doc.version}</span></td>
                      <td style={{ fontSize:12, color:'var(--text-2)' }}>{fmtDateTime(doc.version_date)}</td>
                      <td>{statusPill(doc.status)}</td>
                      <td>{reviewPill(doc.review_date)}</td>
                      <td style={{ fontSize:12, color:'var(--text-2)' }}>{doc.owner||'—'}</td>
                      <td onClick={e=>e.stopPropagation()}>
                        <div className="flex-center gap-6">
                          <button className="btn btn-ghost btn-icon btn-sm" title="Preview & Download PDF" onClick={()=>setPreviewDocId(doc.id)}><FileDown size={14}/></button>
                          <button className="btn btn-ghost btn-icon btn-sm" title="Files" onClick={()=>toggleSection(doc.id,setFilesId,filesId)}><Paperclip size={14}/></button>
                          <button className="btn btn-ghost btn-icon btn-sm" title="Version history" onClick={()=>toggleSection(doc.id,setHistory,historyId)}><History size={14}/></button>
                          <button className="btn btn-ghost btn-icon btn-sm" title="Access control" onClick={()=>{ setAccessDocId(doc.id); toggleSection(doc.id,setAccessId,accessId); }}><Shield size={14}/></button>
                          {doc.status==='Draft' && <button className="btn btn-ghost btn-icon btn-sm" title="Submit for approval" onClick={()=>{ setSubmitModal(doc); setSubmitPurpose('approval'); }}><Send size={14}/></button>}
                          {doc.status==='Approved' && <button className="btn btn-ghost btn-icon btn-sm" title="Submit for retirement approval" onClick={()=>{ setSubmitModal(doc); setSubmitPurpose('retirement'); }}><Archive size={14}/></button>}
                          {doc.status==='Retired'
                            ? <button className="btn btn-ghost btn-icon btn-sm" title="Retired — locked" disabled><Lock size={14}/></button>
                            : <button className="btn btn-ghost btn-icon btn-sm" title="Edit" onClick={()=>openEdit(doc)}><Edit2 size={14}/></button>}
                          <button className="btn btn-ghost btn-icon btn-sm" title={doc.status==='Retired' ? 'Cannot delete retired documents' : 'Delete'} onClick={()=>setDel(doc)} disabled={doc.status==='Retired'}><Trash2 size={14}/></button>
                        </div>
                      </td>
                    </tr>

                    {detailId===doc.id && (
                      <tr><td colSpan={10} style={{ background:'var(--bg)', padding:'1rem 1.25rem' }}>
                        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:20 }}>
                          <div>
                            <SectionHead>Scope</SectionHead>
                            <div className="quill-render" style={{ fontSize:13, color:'var(--text-2)' }}
                              dangerouslySetInnerHTML={{ __html: doc.scope || '<p>No description.</p>' }}/>
                            <SectionHead style={{ marginTop:12 }}>Clause / Control</SectionHead>
                            <p style={{ fontSize:13 }}>{doc.clause||'—'}</p>
                            <SectionHead style={{ marginTop:12 }}>Linked Evidence</SectionHead>
                            {(doc.evidence||[]).length ? doc.evidence.map((e,i)=>(
                              <div key={i} style={{ fontSize:13, padding:'4px 0', borderBottom:'1px solid var(--border)' }}>{e}</div>
                            )) : <p style={{ fontSize:13, color:'var(--text-2)' }}>None</p>}
                          </div>
                          <div>
                            <SectionHead>Version Info</SectionHead>
                            <div style={{ fontSize:13, display:'grid', gridTemplateColumns:'auto 1fr', gap:'5px 14px' }}>
                              <span style={{ color:'var(--text-2)' }}>Version:</span>     <span className="text-mono">v{doc.version}</span>
                              <span style={{ color:'var(--text-2)' }}>Version date:</span><span>{fmtDateTime(doc.version_date)}</span>
                              <span style={{ color:'var(--text-2)' }}>Status:</span>      {statusPill(doc.status)}
                              <span style={{ color:'var(--text-2)' }}>Owner:</span>       <span>{doc.owner||'—'}</span>
                              <span style={{ color:'var(--text-2)' }}>Created:</span>     <span>{doc.created_by ? `${doc.created_by} · ` : ''}{fmtDateTime(doc.created_at)}</span>
                              <span style={{ color:'var(--text-2)' }}>Updated:</span>     <span>{doc.updated_by ? `${doc.updated_by} · ` : ''}{fmtDateTime(doc.updated_at)}</span>
                            </div>
                            <div style={{ marginTop:12, display:'flex', gap:8 }}>
                              <button className="btn btn-sm" onClick={()=>setPreviewDocId(doc.id)}><FileDown size={13}/> Preview PDF</button>
                              <button className="btn btn-sm" onClick={()=>openEdit(doc)}><Edit2 size={13}/> Edit</button>
                            </div>
                          </div>
                        </div>
                      </td></tr>
                    )}

                    {filesId===doc.id && (
                      <tr><td colSpan={10} style={{ background:'var(--bg)', padding:'1rem 1.25rem' }}>
                        <div className="flex-between mb-8">
                          <SectionHead>Attached Files</SectionHead>
                          <div style={{ display:'flex', gap:8, alignItems:'center' }}>
                            {uploading && <span style={{ fontSize:12, color:'var(--text-2)' }}>Uploading…</span>}
                            <button className="btn btn-sm" title="Auto-detect primary Word file"
                              onClick={()=>fixPrimaryMut.mutate(doc.id)} disabled={fixPrimaryMut.isPending}>
                              <RefreshCw size={13}/> Fix Primary
                            </button>
                            <button className="btn btn-sm btn-primary" onClick={()=>openAttachModal(doc.id)} disabled={uploading}>
                              <Paperclip size={13}/> Attach
                            </button>
                          </div>
                        </div>
                        <div style={{ fontSize:11, color:'var(--text-3)', marginBottom:8, background:'var(--accent-bg)', border:'1px solid var(--accent-bdr)', borderRadius:'var(--radius-sm)', padding:'6px 10px' }}>
                          To check for changes: Download the Word file, edit and save it locally, then click "Check for Changes" and select your edited file.
                        </div>
                        <input type="file" ref={checkFileRef} style={{ display:'none' }}
                          accept=".doc,.docx"
                          onChange={handleCheckFileSelected}/>

                        {filesLoading ? <Spinner/> : docFiles.length===0 ? (
                          <div style={{ fontSize:13, color:'var(--text-2)', padding:'8px 0' }}>No files attached yet.</div>
                        ) : (
                          <>
                            {docFiles.filter(f=>f.is_primary===1).map(f=>(
                              <div key={f.id}>
                                <div style={{ fontSize:11, fontWeight:600, color:'var(--text-2)', textTransform:'uppercase', letterSpacing:'.05em', marginBottom:6 }}>Primary SOP/Policy Document</div>
                                <div style={{ display:'flex', alignItems:'center', gap:10, padding:'8px 12px', background:'var(--accent-bg)', border:'1px solid var(--accent-bdr)', borderRadius:'var(--radius-md)', marginBottom:12 }}>
                                  {fileIcon(f.mimetype)}
                                  <div style={{ flex:1 }}>
                                    <div style={{ fontSize:13, fontWeight:500 }}>{f.originalname} <span className="pill pill-blue" style={{ fontSize:9 }}>PRIMARY</span></div>
                                    <div style={{ fontSize:11, color:'var(--text-2)' }}>{formatBytes(f.size)} · {f.uploaded_by} · {fmtDateTime(f.uploaded_at)}</div>
                                  </div>
                                  {checking===f.id && <RefreshCw size={14} style={{ animation:'spin 1s linear infinite', color:'var(--text-2)' }}/>}
                                  <button className="btn btn-sm btn-green" onClick={()=>downloadFile(f.id, f.originalname)}><Download size={13}/> Download</button>
                                  {isWordFile(f.mimetype, f.originalname) && (
                                    <button className="btn btn-sm" onClick={()=>handleCheckChanges(f, doc)} disabled={checking===f.id}>
                                      <RefreshCw size={13}/> Check for Changes
                                    </button>
                                  )}
                                  <button className="btn btn-ghost btn-sm" style={{ color:'var(--red)' }} onClick={()=>setDelFile(f)}><X size={13}/></button>
                                </div>
                              </div>
                            ))}

                            {docFiles.filter(f=>f.is_primary!==1 && f.file_category==='evidence').length > 0 && (
                              <div>
                                <div style={{ fontSize:11, fontWeight:600, color:'var(--text-2)', textTransform:'uppercase', letterSpacing:'.05em', marginBottom:6 }}>Evidence</div>
                                {docFiles.filter(f=>f.is_primary!==1 && f.file_category==='evidence').map(f=>{
                                  const isCreated = f.mimetype === 'application/x-qms-document';
                                  return (
                                  <div key={f.id} style={{ display:'flex', alignItems:'center', gap:10, padding:'8px 12px', background:'var(--green-bg)', border:'1px solid #B8E0A0', borderRadius:'var(--radius-md)', marginBottom:6 }}>
                                    {fileIcon(f.mimetype)}
                                    <div style={{ flex:1 }}>
                                      <div style={{ fontSize:13, fontWeight:500 }}>{f.originalname} <span className="pill pill-green" style={{ fontSize:9 }}>EVIDENCE</span>{isCreated && <span className="pill" style={{ fontSize:9, background:'#EFE6FB', color:'#6940A5' }}>CREATED</span>}</div>
                                      <div style={{ fontSize:11, color:'var(--text-2)' }}>{isCreated ? `${f.size} chars` : formatBytes(f.size)} · {f.uploaded_by} · {fmtDateTime(f.uploaded_at)}</div>
                                    </div>
                                    {checking===f.id && <RefreshCw size={14} style={{ animation:'spin 1s linear infinite', color:'var(--text-2)' }}/>}
                                    {isCreated ? (
                                      <>
                                        <button className="btn btn-sm" onClick={()=>setViewCreatedDoc(f)}><Eye size={13}/> View</button>
                                        <button className="btn btn-sm" onClick={()=>openEditAttachment(doc.id, f)}><PenLine size={13}/> Edit</button>
                                      </>
                                    ) : (
                                      <>
                                        <button className="btn btn-sm btn-green" onClick={()=>downloadFile(f.id, f.originalname)}><Download size={13}/> Download</button>
                                        {isWordFile(f.mimetype, f.originalname) && (
                                          <button className="btn btn-sm" onClick={()=>handleCheckChanges(f, doc)} disabled={checking===f.id}>
                                            <RefreshCw size={13}/> Check for Changes
                                          </button>
                                        )}
                                      </>
                                    )}
                                    <button className="btn btn-ghost btn-sm" style={{ color:'var(--red)' }} onClick={()=>setDelFile(f)}><X size={13}/></button>
                                  </div>
                                  );
                                })}
                              </div>
                            )}

                            {docFiles.filter(f=>f.is_primary!==1 && f.file_category!=='evidence').length > 0 && (
                              <div>
                                <div style={{ fontSize:11, fontWeight:600, color:'var(--text-2)', textTransform:'uppercase', letterSpacing:'.05em', marginBottom:6 }}>Supporting Documents</div>
                                {docFiles.filter(f=>f.is_primary!==1 && f.file_category!=='evidence').map(f=>{
                                  const isCreated = f.mimetype === 'application/x-qms-document';
                                  return (
                                  <div key={f.id} style={{ display:'flex', alignItems:'center', gap:10, padding:'8px 12px', background:'var(--bg-card)', border:'1px solid var(--border)', borderRadius:'var(--radius-md)', marginBottom:6 }}>
                                    {fileIcon(f.mimetype)}
                                    <div style={{ flex:1 }}>
                                      <div style={{ fontSize:13, fontWeight:500 }}>{f.originalname}{isCreated && <span className="pill" style={{ fontSize:9, marginLeft:6, background:'#EFE6FB', color:'#6940A5' }}>CREATED</span>}</div>
                                      <div style={{ fontSize:11, color:'var(--text-2)' }}>{isCreated ? `${f.size} chars` : formatBytes(f.size)} · {f.uploaded_by} · {fmtDateTime(f.uploaded_at)}</div>
                                    </div>
                                    {checking===f.id && <RefreshCw size={14} style={{ animation:'spin 1s linear infinite', color:'var(--text-2)' }}/>}
                                    {isCreated ? (
                                      <>
                                        <button className="btn btn-sm" onClick={()=>setViewCreatedDoc(f)}><Eye size={13}/> View</button>
                                        <button className="btn btn-sm" onClick={()=>openEditAttachment(doc.id, f)}><PenLine size={13}/> Edit</button>
                                      </>
                                    ) : (
                                      <>
                                        <button className="btn btn-sm btn-green" onClick={()=>downloadFile(f.id, f.originalname)}><Download size={13}/> Download</button>
                                        {isWordFile(f.mimetype, f.originalname) && (
                                          <button className="btn btn-sm" onClick={()=>handleCheckChanges(f, doc)} disabled={checking===f.id}>
                                            <RefreshCw size={13}/> Check for Changes
                                          </button>
                                        )}
                                      </>
                                    )}
                                    <button className="btn btn-ghost btn-sm" style={{ color:'var(--red)' }} onClick={()=>setDelFile(f)}><X size={13}/></button>
                                  </div>
                                  );
                                })}
                              </div>
                            )}
                          </>
                        )}
                      </td></tr>
                    )}

                    {historyId===doc.id && (
                      <tr><td colSpan={10} style={{ background:'var(--bg)', padding:'1rem 1.25rem' }}>
                        <SectionHead>Version History — {doc.title}</SectionHead>
                        {histLoading ? <Spinner/> : history.length===0 ? (
                          <p style={{ fontSize:13, color:'var(--text-2)' }}>No history yet.</p>
                        ) : history.map(h=>(
                          <div key={h.id} style={{ display:'flex', gap:12, padding:'8px 0', borderBottom:'1px solid var(--border)' }}>
                            <span style={{ fontFamily:'var(--mono)', fontSize:11, background:'var(--bg-hover)', padding:'2px 8px', borderRadius:4, whiteSpace:'nowrap', alignSelf:'flex-start' }}>v{h.version}</span>
                            <div style={{ flex:1 }}>
                              <div style={{ fontSize:13 }}>{h.change_note}</div>
                              <div style={{ fontSize:11, color:'var(--text-2)', marginTop:2 }}>
                                {fmtDateTime(h.changed_at)} · {h.author}
                                {h.approved_by && <span> · approved by <strong>{h.approved_by}</strong></span>}
                              </div>
                            </div>
                          </div>
                        ))}
                      </td></tr>
                    )}

                    {accessId===doc.id && (
                      <tr><td colSpan={10} style={{ background:'var(--bg)', padding:'1rem 1.25rem' }}>
                        <div className="flex-between mb-12">
                          <div>
                            <SectionHead>Access Control — {doc.title}</SectionHead>
                            <p style={{ fontSize:12, color:'var(--text-2)', marginTop:4 }}>
                              Everyone can view. Grant <strong>edit</strong> permission to specific users for this document.
                              Admins always have full access.
                            </p>
                          </div>
                        </div>

                        <div style={{ display:'flex', gap:8, marginBottom:14, flexWrap:'wrap' }}>
                          <select style={{ width:'auto', flex:1 }} value={grantUserId} onChange={e=>setGrantUserId(e.target.value)}>
                            <option value="">Select user…</option>
                            {users.map(u=><option key={u.id} value={u.id}>{u.name} ({u.role})</option>)}
                          </select>
                          <select style={{ width:'auto' }} value={grantPerm} onChange={e=>setGrantPerm(e.target.value)}>
                            <option value="view">View only</option>
                            <option value="edit">Can edit</option>
                          </select>
                          <button className="btn btn-primary btn-sm" disabled={!grantUserId || grantMut.isPending} onClick={()=>grantMut.mutate()}>
                            Grant Access
                          </button>
                        </div>

                        {accessList.length===0 ? (
                          <p style={{ fontSize:13, color:'var(--text-2)' }}>No specific permissions set. All users can view.</p>
                        ) : accessList.map(p=>(
                          <div key={p.id} style={{ display:'flex', alignItems:'center', gap:10, padding:'8px 12px', background:'var(--bg-card)', border:'1px solid var(--border)', borderRadius:'var(--radius-md)', marginBottom:6 }}>
                            <div style={{ width:28, height:28, borderRadius:'50%', background:'var(--accent-bg)', color:'var(--accent)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:11, fontWeight:700, flexShrink:0 }}>
                              {p.user_name?.split(' ').map(n=>n[0]).join('').slice(0,2)}
                            </div>
                            <div style={{ flex:1 }}>
                              <div style={{ fontSize:13, fontWeight:500 }}>{p.user_name}</div>
                              <div style={{ fontSize:11, color:'var(--text-2)' }}>{p.email} · Granted by {p.granted_by}</div>
                            </div>
                            <span style={{ fontSize:11, fontWeight:600, color: permColor[p.permission], background: p.permission==='edit'?'var(--green-bg)':'var(--accent-bg)', padding:'2px 10px', borderRadius:20 }}>
                              {p.permission==='edit' ? 'Edit' : 'View'}
                            </span>
                            <button className="btn btn-ghost btn-sm" style={{ color:'var(--red)' }} onClick={()=>revokeMut.mutate(p.user_id)}>Revoke</button>
                          </div>
                        ))}

                        <div style={{ marginTop:16 }}>
                          <SectionHead>System-wide Roles</SectionHead>
                          <p style={{ fontSize:12, color:'var(--text-2)', margin:'6px 0 10px' }}>
                            Admin — full access everywhere · Editor — can edit if granted · Viewer — read only
                          </p>
                          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(220px,1fr))', gap:8 }}>
                            {users.map(u=>(
                              <div key={u.id} style={{ display:'flex', alignItems:'center', gap:8, padding:'8px 10px', background:'var(--bg-card)', border:'1px solid var(--border)', borderRadius:'var(--radius-md)' }}>
                                <div style={{ flex:1 }}>
                                  <div style={{ fontSize:12, fontWeight:500 }}>{u.name}</div>
                                  <div style={{ fontSize:10, color:'var(--text-2)' }}>{u.role}</div>
                                </div>
                                <select style={{ width:'auto', fontSize:11, padding:'3px 6px' }}
                                  value={u.system_role||'viewer'}
                                  onChange={e=>roleUpdateMut.mutate({ userId:u.id, role:e.target.value })}>
                                  <option value="admin">Admin</option>
                                  <option value="editor">Editor</option>
                                  <option value="viewer">Viewer</option>
                                </select>
                              </div>
                            ))}
                          </div>
                        </div>
                      </td></tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {previewDocId && (
        <DocumentPreviewModal docId={previewDocId} onClose={()=>setPreviewDocId(null)}/>
      )}

      {changeDetected && (
        <div className="modal-overlay">
          <div className="modal" style={{ maxWidth:480 }}>
            <div style={{ display:'flex', gap:10, alignItems:'flex-start', marginBottom:16 }}>
              <AlertCircle size={22} color="var(--amber)" style={{ flexShrink:0, marginTop:2 }}/>
              <div>
                <div style={{ fontWeight:600, fontSize:15, marginBottom:4 }}>Changes Detected in File</div>
                <div style={{ fontSize:13, color:'var(--text-2)' }}>
                  <strong>"{changeDetected.originalname}"</strong> has been modified since it was last uploaded.
                </div>
              </div>
            </div>

            <div style={{ background:'var(--amber-bg)', border:'1px solid #EFC97A', borderRadius:'var(--radius-md)', padding:'10px 14px', fontSize:12, color:'var(--amber)', marginBottom:16 }}>
              Does this change require a new version number?
            </div>

            <div className="form-row">
              <label>Describe what changed <span style={{ fontWeight:400, color:'var(--text-3)' }}>(required for Yes)</span></label>
              <textarea value={changeNote} onChange={e=>setChangeNote(e.target.value)}
                placeholder="e.g. Updated section 3.2 with new approval thresholds…"
                style={{ minHeight:80 }}/>
            </div>

            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginTop:8 }}>
              <button className="btn btn-green"
                disabled={!changeNote.trim() || confirmChangeMut.isPending}
                onClick={()=>confirmChangeMut.mutate({ fileId:changeDetected.fileId, change_note:changeNote, selectedFile:changeDetected.selectedFile })}>
                <CheckCircle size={14}/>
                {confirmChangeMut.isPending ? 'Processing…' : 'Yes — New Version'}
              </button>
              <button className="btn"
                disabled={dismissChangeMut.isPending}
                onClick={()=>dismissChangeMut.mutate({ fileId:changeDetected.fileId, selectedFile:changeDetected.selectedFile })}>
                {dismissChangeMut.isPending ? 'Saving…' : 'No — Minor Edit Only'}
              </button>
            </div>
            <p style={{ fontSize:11, color:'var(--text-3)', marginTop:10 }}>
              "Yes" bumps the version, resets status to Draft, and starts a new approval workflow.<br/>
              "No" records no version change — the file opens normally.
            </p>
          </div>
        </div>
      )}

      {attachModal && (
        <div className="modal-overlay" onClick={closeAttachModal}>
          <div className="modal modal-lg" onClick={e=>e.stopPropagation()} style={{ maxWidth: attachMethod==='create' || attachModal.editFile ? 720 : 480 }}>
            <div className="flex-between mb-12">
              <div style={{ fontWeight:600, fontSize:16 }}>
                {attachModal.editFile ? 'Edit Document' : 'Attach to Document'}
              </div>
              <button className="btn btn-ghost btn-icon" onClick={closeAttachModal}><X size={16}/></button>
            </div>

            {!attachModal.editFile && (
              <>
                <div className="form-row">
                  <label>Attachment Type</label>
                  <div style={{ display:'flex', gap:8 }}>
                    {[
                      { value:'supporting', label:'Supporting Document', desc:'Referenced procedures, related policies, templates' },
                      { value:'evidence',   label:'Evidence',            desc:'Records, logs, audit trails, proof of compliance' },
                    ].map(opt => (
                      <button key={opt.value} onClick={()=>setAttachType(opt.value)}
                        style={{
                          flex:1, textAlign:'left', padding:'10px 12px', borderRadius:'var(--radius-md)', cursor:'pointer',
                          border:`1px solid ${attachType===opt.value ? 'var(--accent)' : 'var(--border-md)'}`,
                          background: attachType===opt.value ? 'var(--accent-bg)' : 'transparent',
                        }}>
                        <div style={{ fontSize:13, fontWeight:600, color: attachType===opt.value ? 'var(--accent)' : 'var(--text-1)' }}>{opt.label}</div>
                        <div style={{ fontSize:11, color:'var(--text-2)', marginTop:2 }}>{opt.desc}</div>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="form-row">
                  <label>How would you like to add it?</label>
                  <div style={{ display:'flex', gap:8 }}>
                    <button onClick={()=>setAttachMethod('upload')}
                      style={{
                        flex:1, display:'flex', alignItems:'center', justifyContent:'center', gap:8, padding:'10px 12px', borderRadius:'var(--radius-md)', cursor:'pointer',
                        border:`1px solid ${attachMethod==='upload' ? 'var(--accent)' : 'var(--border-md)'}`,
                        background: attachMethod==='upload' ? 'var(--accent-bg)' : 'transparent',
                        color: attachMethod==='upload' ? 'var(--accent)' : 'var(--text-1)', fontSize:13, fontWeight:500,
                      }}>
                      <FileUp size={15}/> Upload a File
                    </button>
                    <button onClick={()=>setAttachMethod('create')}
                      style={{
                        flex:1, display:'flex', alignItems:'center', justifyContent:'center', gap:8, padding:'10px 12px', borderRadius:'var(--radius-md)', cursor:'pointer',
                        border:`1px solid ${attachMethod==='create' ? 'var(--accent)' : 'var(--border-md)'}`,
                        background: attachMethod==='create' ? 'var(--accent-bg)' : 'transparent',
                        color: attachMethod==='create' ? 'var(--accent)' : 'var(--text-1)', fontSize:13, fontWeight:500,
                      }}>
                      <FilePlus size={15}/> Create a Document
                    </button>
                  </div>
                </div>
              </>
            )}

            {!attachModal.editFile && attachMethod === 'upload' && (
              <div className="form-row">
                <label>File</label>
                <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                  <input type="file" ref={attachFileRef} style={{ display:'none' }}
                    accept=".doc,.docx,.pdf,.xls,.xlsx,.png,.jpg,.jpeg,.csv,.txt"
                    onChange={e=>{ setAttachFile(e.target.files[0]||null); e.target.value=''; }}/>
                  <button type="button" className="btn btn-sm" onClick={()=>attachFileRef.current?.click()}>
                    <Upload size={13}/> Choose File
                  </button>
                  {attachFile ? (
                    <div style={{ display:'flex', alignItems:'center', gap:6, fontSize:13 }}>
                      <FileText size={14} color="var(--accent)"/>
                      <span>{attachFile.name}</span>
                      <button className="btn btn-ghost btn-icon" style={{ padding:2 }} onClick={()=>setAttachFile(null)}><X size={12}/></button>
                    </div>
                  ) : <span style={{ fontSize:12, color:'var(--text-3)' }}>No file chosen</span>}
                </div>
                <div className="input-hint">Word files (.doc/.docx) will be extracted and included as additional pages in the PDF.</div>
              </div>
            )}

            {(attachModal.editFile || attachMethod === 'create') && (
              <>
                <div className="form-row">
                  <label>Document Title</label>
                  <input value={attachTitle} onChange={e=>setAttachTitle(e.target.value)} placeholder="e.g. Risk Assessment Worksheet"/>
                </div>
                <div className="form-row">
                  <label>Content</label>
                  <RichTextEditor
                    value={attachContent}
                    onChange={setAttachContent}
                    placeholder="Write the document content here…"
                  />
                  <div className="input-hint">This content will appear as additional page(s) in the PDF.</div>
                </div>
              </>
            )}

            <div className="modal-footer">
              <button className="btn" onClick={closeAttachModal}>Cancel</button>
              <button className="btn btn-primary" onClick={handleAttachSubmit} disabled={createAttachmentMut.isPending || updateAttachmentMut.isPending || uploading}>
                {attachModal.editFile
                  ? (updateAttachmentMut.isPending ? 'Saving…' : 'Save Changes')
                  : attachMethod === 'upload'
                    ? (uploading ? 'Uploading…' : 'Upload & Attach')
                    : (createAttachmentMut.isPending ? 'Creating…' : 'Create & Attach')}
              </button>
            </div>
          </div>
        </div>
      )}

      {viewCreatedDoc && (
        <div className="modal-overlay" onClick={()=>setViewCreatedDoc(null)}>
          <div className="modal modal-lg" onClick={e=>e.stopPropagation()} style={{ maxWidth:680 }}>
            <div className="flex-between mb-12">
              <div style={{ fontWeight:600, fontSize:16, display:'flex', alignItems:'center', gap:8 }}>
                {viewCreatedDoc.originalname}
                <span className="pill" style={{ fontSize:9, background:'#EFE6FB', color:'#6940A5' }}>CREATED</span>
                <span className={`pill ${viewCreatedDoc.file_category==='evidence' ? 'pill-green' : ''}`} style={{ fontSize:9 }}>
                  {viewCreatedDoc.file_category === 'evidence' ? 'EVIDENCE' : 'SUPPORTING'}
                </span>
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

      {versionBumpPrompt && (
        <div className="modal-overlay" style={{ zIndex: 300 }}>
          <div className="modal" style={{ maxWidth:460 }}>
            <div style={{ display:'flex', gap:10, alignItems:'flex-start', marginBottom:16 }}>
              <RefreshCw size={22} color="var(--accent)" style={{ flexShrink:0, marginTop:2 }}/>
              <div>
                <div style={{ fontWeight:600, fontSize:15, marginBottom:4 }}>Version Will Be Updated</div>
                <div style={{ fontSize:13, color:'var(--text-2)' }}>
                  You've made changes to this document. The version will be updated from{' '}
                  <strong className="text-mono">v{versionBumpPrompt.oldVersion}</strong> to{' '}
                  <strong className="text-mono" style={{ color:'var(--accent)' }}>v{versionBumpPrompt.newVersion}</strong>.
                </div>
              </div>
            </div>

            <div style={{ background:'var(--accent-bg)', border:'1px solid var(--accent-bdr)', borderRadius:'var(--radius-md)', padding:'10px 14px', fontSize:12, color:'var(--accent)', marginBottom:16 }}>
              Accepting will save your changes with the new version number and reset the document to Draft.
              Rejecting will discard all changes.
            </div>

            <div className="form-row">
              <label>Description of Changes <span style={{ fontWeight:400, color:'var(--text-3)' }}>(recorded in version history)</span></label>
              <input
                value={versionBumpPrompt.changeNote || ''}
                onChange={e=>setVersionBumpPrompt(p=>({ ...p, changeNote:e.target.value }))}
                placeholder="e.g. Updated scope to include remote workers"
              />
            </div>

            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginTop:8 }}>
              <button className="btn btn-green" onClick={acceptVersionBump} disabled={saveMut.isPending}>
                <CheckCircle size={14}/> {saveMut.isPending ? 'Saving…' : `Accept — Update to v${versionBumpPrompt.newVersion}`}
              </button>
              <button className="btn" onClick={rejectVersionBump}>
                Reject — Discard Changes
              </button>
            </div>
          </div>
        </div>
      )}

      <Modal open={docModal} onClose={()=>setDocModal(false)} title={editDoc?`Edit — ${editDoc.id}`:'New Document'} size="modal-lg">
        <div className="form-2col">
          <div className="form-row"><label>Document ID <span style={{color:'var(--red)'}}>*</span></label><input value={form.id} onChange={e=>setForm(f=>({...f,id:e.target.value}))} placeholder="e.g. SOP-001" disabled={!!editDoc}/></div>
          <div className="form-row">
            <label>Type <span style={{color:'var(--red)'}}>*</span></label>
            <select value={form.type} onChange={e=>setForm(f=>({...f,type:e.target.value}))}>
              {form.type && !TYPES.includes(form.type) && <option key={form.type} value={form.type}>{form.type} (no longer in list)</option>}
              {TYPES.map(t=><option key={t}>{t}</option>)}
            </select>
          </div>
        </div>
        <div className="form-row"><label>Title <span style={{color:'var(--red)'}}>*</span></label><input value={form.title} onChange={e=>setForm(f=>({...f,title:e.target.value}))} placeholder="Document title"/></div>
        <div className="form-2col">
          <div className="form-row"><label>Standard <span style={{color:'var(--red)'}}>*</span></label><select value={form.standard} onChange={e=>setForm(f=>({...f,standard:e.target.value}))}>{STANDARDS.map(s=><option key={s}>{s}</option>)}</select></div>
          <div className="form-row"><label>Clause / Control</label><input value={form.clause} onChange={e=>setForm(f=>({...f,clause:e.target.value}))} placeholder="e.g. 7.5 or A.8.2"/></div>
        </div>
        <div className="form-2col">
          <div className="form-row"><label>Version</label><input value={form.version} onChange={e=>setForm(f=>({...f,version:e.target.value}))} placeholder="1.0"/></div>
          <div className="form-row"><label>Status <span style={{color:'var(--red)'}}>*</span></label><select value={form.status} onChange={e=>setForm(f=>({...f,status:e.target.value}))}>{EDITABLE_STATUSES.map(s=><option key={s}>{s}</option>)}</select></div>
        </div>
        <div className="form-2col">
          <div className="form-row">
            <label>Owner</label>
            <select
              value={form.owner_id || ''}
              onChange={e => {
                const uid = e.target.value ? parseInt(e.target.value, 10) : '';
                const user = users.find(u => u.id === uid);
                setForm(f => ({ ...f, owner_id: uid, owner: user ? user.name : '' }));
              }}
            >
              <option value="">— Unassigned —</option>
              {users.map(u => <option key={u.id} value={u.id}>{u.name} ({u.role})</option>)}
            </select>
            <div className="input-hint">The selected person will be notified when this document is saved.</div>
          </div>
          <div className="form-row"><label>Next Review Date</label><input type="date" value={form.review_date} onChange={e=>setForm(f=>({...f,review_date:e.target.value}))}/></div>
        </div>
        <div className="form-row">
          <label>Scope / Description</label>
          <RichTextEditor
            value={form.scope || ''}
            onChange={val => setForm(f => ({ ...f, scope: val }))}
            placeholder="Brief description of scope and purpose…"
          />
        </div>
        <div className="form-row">
          <label>Linked Evidence <span style={{ fontWeight:400, color:'var(--text-3)' }}>(optional — text references)</span></label>
          <input value={evidenceInput} onChange={e=>setEvidInput(e.target.value)} placeholder="Training record, Audit report"/>
          <div className="input-hint">For text-only references. To attach actual files, use the Files panel after saving.</div>
        </div>
        {!editDoc && (
          <div className="form-row">
            <label>Attach Evidence Files <span style={{ fontWeight:400, color:'var(--text-3)' }}>(optional — you can also upload later)</span></label>
            <div style={{ display:'flex', alignItems:'center', gap:10, flexWrap:'wrap' }}>
              <input type="file" ref={evidenceInputRef} style={{ display:'none' }} multiple
                accept=".pdf,.xls,.xlsx,.doc,.docx,.png,.jpg,.jpeg,.csv,.txt"
                onChange={e=>{
                  const files = Array.from(e.target.files || []);
                  setPendingEvidence(prev => [...prev, ...files]);
                  e.target.value = '';
                }}/>
              <button type="button" className="btn btn-sm" onClick={()=>evidenceInputRef.current?.click()}>
                <Upload size={13}/> Add Evidence File(s)
              </button>
              {pendingEvidence.length === 0 && <span style={{ fontSize:12, color:'var(--text-3)' }}>No files chosen</span>}
            </div>
            {pendingEvidence.length > 0 && (
              <div style={{ display:'flex', flexDirection:'column', gap:4, marginTop:8 }}>
                {pendingEvidence.map((file, i) => (
                  <div key={i} style={{ display:'flex', alignItems:'center', gap:6, fontSize:13, background:'var(--bg-card)', border:'1px solid var(--border)', borderRadius:'var(--radius-sm)', padding:'4px 10px' }}>
                    <FileText size={13} color="var(--accent)"/>
                    <span style={{ flex:1 }}>{file.name}</span>
                    <span style={{ fontSize:11, color:'var(--text-3)' }}>{formatBytes(file.size)}</span>
                    <button className="btn btn-ghost btn-icon" style={{ padding:2 }} onClick={()=>setPendingEvidence(prev => prev.filter((_,idx)=>idx!==i))}><X size={12}/></button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        {!editDoc && (
          <div className="form-row">
            <label>Attach the Primary SOP/Policy Word Document <span style={{ fontWeight:400, color:'var(--text-3)' }}>(optional — you can also upload later)</span></label>
            <div style={{ display:'flex', alignItems:'center', gap:10 }}>
              <input type="file" ref={uploadDocRef} style={{ display:'none' }}
                accept=".doc,.docx" onChange={e=>{ setPendingFile(e.target.files[0]||null); e.target.value=''; }}/>
              <button type="button" className="btn btn-sm" onClick={()=>uploadDocRef.current?.click()}>
                <Upload size={13}/> Choose File
              </button>
              {pendingFile ? (
                <div style={{ display:'flex', alignItems:'center', gap:6, fontSize:13 }}>
                  <FileText size={14} color="var(--accent)"/>
                  <span>{pendingFile.name}</span>
                  <button className="btn btn-ghost btn-icon" style={{ padding:2 }} onClick={()=>setPendingFile(null)}><X size={12}/></button>
                </div>
              ) : <span style={{ fontSize:12, color:'var(--text-3)' }}>No file chosen</span>}
            </div>
            <div className="input-hint">This is the main controlled document. Word files support automatic change detection.</div>
          </div>
        )}
        {editDoc && (
          <div className="form-row">
            <label>Change Note <span style={{ fontWeight:400, color:'var(--text-3)' }}>(logged in version history)</span></label>
            <input value={form.change_note} onChange={e=>setForm(f=>({...f,change_note:e.target.value}))} placeholder="What changed in this version?"/>
          </div>
        )}
        <div className="modal-footer">
          <button className="btn" onClick={()=>setDocModal(false)}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saveMut.isPending}>
            {saveMut.isPending ? 'Saving…' : 'Save Document'}
          </button>
        </div>
      </Modal>

      <Modal
        open={!!submitModal}
        onClose={()=>{ setSubmitModal(null); setApproverIds([]); }}
        title={submitPurpose==='retirement' ? `Submit for Retirement Approval — ${submitModal?.id}` : `Submit for Approval — ${submitModal?.id}`}
      >
        {submitPurpose==='retirement' ? (
          <div style={{ display:'flex', gap:10, padding:'10px 12px', background:'var(--amber-bg)', border:'1px solid #F0C36D', borderRadius:'var(--radius-md)', marginBottom:14 }}>
            <AlertCircle size={16} style={{ color:'var(--amber)', flexShrink:0, marginTop:1 }}/>
            <div style={{ fontSize:13, color:'#7A5B12' }}>
              <strong>This cannot be undone.</strong> Once every approver signs off, this document becomes <strong>Retired</strong> and is permanently locked.
            </div>
          </div>
        ) : (
          <p style={{ fontSize:13, color:'var(--text-2)', marginBottom:12 }}>Select approvers <strong>in order</strong>. Each must sign off before the next is notified.</p>
        )}
        <SectionHead>Choose Approvers (sequential order)</SectionHead>
        <div style={{ maxHeight:260, overflowY:'auto', border:'1px solid var(--border)', borderRadius:'var(--radius-md)' }}>
          {users.map(u=>{ const idx=approverIds.indexOf(u.id); const sel=idx!==-1; return (
            <div key={u.id} onClick={()=>toggleApprover(u.id)} style={{ display:'flex', alignItems:'center', gap:10, padding:'10px 14px', borderBottom:'1px solid var(--border)', cursor:'pointer', background:sel?'var(--accent-bg)':'transparent' }}>
              <div style={{ width:22, height:22, borderRadius:4, border:`2px solid ${sel?'var(--accent)':'var(--border-md)'}`, background:sel?'var(--accent)':'transparent', display:'flex', alignItems:'center', justifyContent:'center', color:'#fff', fontSize:11, fontWeight:700, flexShrink:0 }}>{sel?idx+1:''}</div>
              <div><div style={{ fontSize:13, fontWeight:500 }}>{u.name}</div><div style={{ fontSize:11, color:'var(--text-2)' }}>{u.role}</div></div>
            </div>
          );})}
        </div>
        {approverIds.length>0 && <div style={{ marginTop:10, fontSize:12, color:'var(--text-2)' }}>Order: {approverIds.map(id=>users.find(u=>u.id===id)?.name).join(' → ')}</div>}
        <div className="modal-footer">
          <button className="btn" onClick={()=>{ setSubmitModal(null); setApproverIds([]); }}>Cancel</button>
          <button className={submitPurpose==='retirement' ? 'btn btn-red' : 'btn btn-primary'} disabled={approverIds.length===0||submitMut.isPending}
            onClick={()=>submitMut.mutate({ doc_id:submitModal.id, submitted_by:CURRENT_USER.name, approver_ids:approverIds, purpose:submitPurpose })}>
            {submitMut.isPending?'Submitting…':`Submit to ${approverIds.length} Approver${approverIds.length>1?'s':''}`}
          </button>
        </div>
      </Modal>

      <ConfirmDialog open={!!delTarget} onClose={()=>setDel(null)} danger title="Delete Document"
        message={`Permanently delete "${delTarget?.title}"? All attached files will also be deleted.`}
        onConfirm={()=>delMut.mutate(delTarget.id)}/>
      <ConfirmDialog open={!!delFile} onClose={()=>setDelFile(null)} danger title="Delete File"
        message={`Permanently delete "${delFile?.originalname}"?`}
        onConfirm={()=>delFileMut.mutate(delFile.id)}/>
    </div>
  );
}
