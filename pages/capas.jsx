import React, { useState, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Plus, Search, Edit2, Trash2, AlertTriangle, AlertCircle, CheckCircle, Clock,
  Send, Paperclip, Eye, PenLine, Upload, Download, FileText, File, X,
  FileUp, FilePlus, RefreshCw, XCircle, Lock, History, FileDown,
} from 'lucide-react';
import toast from 'react-hot-toast';
import {
  getCapas, createCapa, updateCapa, deleteCapa, getNextCapaId,
  getUsers, submitCapaWorkflow, getCapaRecordWorkflow, getCapaWorkflows, approveCapaStep, rejectCapaStep, cancelCapaWorkflow,
  getCapaFiles, uploadCapaFile, createCapaAttachment, updateDocAttachment, downloadFile, deleteFile,
} from '../api';
import {
  capaStatusPill, approvalStatusPill, fmtDate, fmtDateTime, Spinner,
  EmptyState, Modal, ConfirmDialog, ProgressBar, SectionHead
} from '../components/UI';
import { useAuth } from '../context/AuthContext';
import CapaPreviewModal from '../components/CapaPreviewModal';
import dynamic from 'next/dynamic';
const RichTextEditor = dynamic(() => import('../components/RichTextEditor'), { ssr: false });

const TYPES    = ['NCR', 'CAPA', 'Observation', 'Opportunity for Improvement'];
const STATUSES = ['In Progress', 'Waiting for Approval', 'Approved & Closed'];
const EDITABLE_STATUSES = ['In Progress', 'Waiting for Approval'];
const SOURCES  = ['Internal Audit', 'External Audit', 'Customer Complaint', 'Incident', 'Management Review', 'Process Review'];

const EMPTY = {
  id: '', type: 'NCR', title: '', detail: '', clause: '',
  source: 'Internal Audit', owner: '', owner_id: '', due_date: '',
  root_cause: '', action: '', status: 'In Progress', pct_complete: 0,
  corrective_due_date: '', corrective_completion_date: '',
  preventive_action: '', preventive_due_date: '', preventive_completion_date: '',
  verification_comments: '', verification_date: '',
};

function getIncompleteCapaActions(c) {
  const missing = [];
  if (!c.corrective_completion_date) missing.push('Corrective Action');
  if (!c.preventive_completion_date) missing.push('Preventive Action');
  if (!c.verification_date)          missing.push('Verification of Effectiveness');
  return missing;
}

function shouldShowApprovalPill(c) {
  if (!c.approval_status || c.approval_status === 'Not Submitted') return false;
  if (c.approval_status === 'Approved' && c.status === 'Approved & Closed') return false;
  return true;
}

function isCapaLocked(c) {
  return c.status === 'Approved & Closed' && c.approval_status === 'Approved';
}

function rootCauseOrActionNewlyFilled(before, after) {
  const wasEmpty = (v) => !v || !String(v).trim();
  const beforeRootCause = before ? before.root_cause : null;
  const beforeAction = before ? before.action : null;
  const rootCauseNewlyFilled = wasEmpty(beforeRootCause) && !wasEmpty(after.root_cause);
  const actionNewlyFilled = wasEmpty(beforeAction) && !wasEmpty(after.action);
  return rootCauseNewlyFilled || actionNewlyFilled;
}

function buildAuditTrail(capa, workflowHistory) {
  const entries = [];
  if (capa.created_at) {
    entries.push({ at: capa.created_at, label: 'Created', by: capa.created_by || 'Unknown', kind: 'create' });
  }
  if (capa.updated_at && capa.updated_by && capa.updated_at !== capa.created_at) {
    entries.push({ at: capa.updated_at, label: 'Last edited', by: capa.updated_by, kind: 'edit' });
  }
  if (capa.corrective_completion_date) {
    entries.push({ at: capa.corrective_completion_date, label: 'Corrective Action completed', by: capa.corrective_completed_by || 'Unknown', kind: 'edit' });
  }
  if (capa.preventive_completion_date) {
    entries.push({ at: capa.preventive_completion_date, label: 'Preventive Action completed', by: capa.preventive_completed_by || 'Unknown', kind: 'edit' });
  }
  if (capa.verification_date) {
    entries.push({ at: capa.verification_date, label: 'Effectiveness verified', by: capa.verified_by || 'Unknown', comment: capa.verification_comments, kind: 'edit' });
  }
  for (const wf of (workflowHistory || [])) {
    entries.push({ at: wf.created_at, label: 'Submitted for approval', by: wf.submitted_by, kind: 'submit' });
    for (const step of (wf.steps || [])) {
      if (step.status === 'Approved') {
        entries.push({ at: step.acted_at, label: `Approved (step ${step.step_order})`, by: step.approver_name, comment: step.comment, kind: 'approve' });
      } else if (step.status === 'Rejected') {
        entries.push({ at: step.acted_at, label: `Rejected (step ${step.step_order})`, by: step.approver_name, comment: step.comment, kind: 'reject' });
      }
    }
  }
  return entries
    .filter(e => e.at)
    .sort((a, b) => new Date(a.at) - new Date(b.at));
}

function fileIcon(mimetype = '') {
  if (mimetype === 'application/x-qms-document') return <FileText size={14} color="#6940A5"/>;
  if (mimetype.includes('word'))  return <FileText size={14} color="#1A56DB"/>;
  if (mimetype.includes('pdf'))   return <FileText size={14} color="#CC0000"/>;
  if (mimetype.includes('image')) return <FileText size={14} color="#9A5700"/>;
  return <File size={14}/>;
}
function formatBytes(b) {
  if (b < 1024) return `${b} B`;
  if (b < 1048576) return `${(b/1024).toFixed(1)} KB`;
  return `${(b/1048576).toFixed(1)} MB`;
}

export default function Capas() {
  const { user: CURRENT_USER } = useAuth();
  const qc = useQueryClient();
  const [search, setSearch]       = useState('');
  const [filterStatus, setFSt]    = useState('');
  const [filterType, setFType]    = useState('');
  const [modal, setModal]         = useState(false);
  const [editItem, setEditItem]   = useState(null);
  const [form, setForm]           = useState(EMPTY);
  const [delTarget, setDel]       = useState(null);
  const [expanded, setExpanded]   = useState(null);
  const [idManuallyEdited, setIdManuallyEdited] = useState(false);

  const [submitModal, setSubmitModal] = useState(null);
  const [approverIds, setApproverIds] = useState([]);
  const [confirmSendModal, setConfirmSendModal] = useState(null);
  const [evidencePromptBeforeSave, setEvidencePromptBeforeSave] = useState(false);

  const [attachModal, setAttachModal]     = useState(null);
  const [attachMethod, setAttachMethod]   = useState('upload');
  const [attachFile, setAttachFile]       = useState(null);
  const [attachTitle, setAttachTitle]     = useState('');
  const [attachContent, setAttachContent] = useState('');
  const attachFileRef = useRef(null);
  const [viewCreatedDoc, setViewCreatedDoc] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [filesId, setFilesId]     = useState(null);
  const [delFile, setDelFile]     = useState(null);
  const [previewCapaId, setPreviewCapaId] = useState(null);

  const { data: capas = [], isLoading } = useQuery({
    queryKey: ['capas', search, filterStatus, filterType],
    queryFn:  () => getCapas({ search, status: filterStatus, type: filterType }),
  });
  const { data: users = [] } = useQuery({ queryKey:['users'], queryFn: getUsers });
  const { data: capaFiles = [], isLoading: filesLoading } = useQuery({
    queryKey: ['capaFiles', filesId],
    queryFn:  () => getCapaFiles(filesId),
    enabled:  !!filesId,
  });
  const { data: capaWorkflow } = useQuery({
    queryKey: ['capaWorkflow', expanded],
    queryFn:  () => getCapaRecordWorkflow(expanded),
    enabled:  !!expanded,
  });
  const { data: capaWorkflowHistory = [] } = useQuery({
    queryKey: ['capaWorkflowHistory', expanded],
    queryFn:  () => getCapaWorkflows({ capa_id: expanded }),
    enabled:  !!expanded,
  });

  const saveMut = useMutation({
    mutationFn: data => editItem ? updateCapa(editItem.id, data) : createCapa(data),
    onSuccess: (saved, variables) => {
      qc.invalidateQueries(['capas']); qc.invalidateQueries(['stats']);
      const assigneeChanged = !editItem
        ? !!variables.owner_id
        : String(variables.owner_id || '') !== String(editItem.owner_id || '');
      const assigneeName = users.find(u => u.id === variables.owner_id)?.name;
      if (assigneeChanged && assigneeName) {
        toast.success(`${editItem ? 'Record updated' : 'Record created'} — ${assigneeName} notified`);
      } else {
        toast.success(editItem ? 'Record updated' : 'Record created');
      }
      setModal(false);
      if (variables.__sendForApprovalAfterSave) {
        setSubmitModal(saved);
      }
    },
    onError: e => toast.error(e.response?.data?.error || 'Save failed'),
  });

  const delMut = useMutation({
    mutationFn: id => deleteCapa(id),
    onSuccess: () => { qc.invalidateQueries(['capas']); qc.invalidateQueries(['stats']); toast.success('Deleted'); },
    onError: e => toast.error(e.response?.data?.error || 'Delete failed'),
  });

  const submitMut = useMutation({
    mutationFn: data => submitCapaWorkflow(data),
    onSuccess: () => {
      qc.invalidateQueries(['capas']); qc.invalidateQueries(['capaWorkflow']);
      toast.success('Submitted for approval');
      setSubmitModal(null); setApproverIds([]);
    },
    onError: e => toast.error(e.response?.data?.error || 'Submit failed'),
  });

  const approveMut = useMutation({
    mutationFn: ({ wfId, stepId, comment }) => approveCapaStep(wfId, stepId, { comment }),
    onSuccess: () => { qc.invalidateQueries(['capas']); qc.invalidateQueries(['capaWorkflow']); toast.success('Approved'); },
    onError: e => toast.error(e.response?.data?.error || 'Failed'),
  });

  const rejectMut = useMutation({
    mutationFn: ({ wfId, stepId, comment }) => rejectCapaStep(wfId, stepId, { comment }),
    onSuccess: () => { qc.invalidateQueries(['capas']); qc.invalidateQueries(['capaWorkflow']); toast.success('Rejected'); },
    onError: e => toast.error(e.response?.data?.error || 'Failed'),
  });

  const cancelWfMut = useMutation({
    mutationFn: id => cancelCapaWorkflow(id),
    onSuccess: () => { qc.invalidateQueries(['capas']); qc.invalidateQueries(['capaWorkflow']); toast.success('Approval withdrawn'); },
    onError: e => toast.error(e.response?.data?.error || 'Failed'),
  });

  const createAttachmentMut = useMutation({
    mutationFn: ({ capaId, data }) => createCapaAttachment(capaId, data),
    onSuccess: () => { qc.invalidateQueries(['capaFiles']); toast.success('Evidence created and attached'); closeAttachModal(); },
    onError: e => toast.error(e.response?.data?.error || 'Failed to create evidence document'),
  });

  const updateAttachmentMut = useMutation({
    mutationFn: ({ fileId, data }) => updateDocAttachment(fileId, data),
    onSuccess: () => { qc.invalidateQueries(['capaFiles']); toast.success('Evidence updated'); closeAttachModal(); },
    onError: e => toast.error(e.response?.data?.error || 'Failed to update evidence'),
  });

  const delFileMut = useMutation({
    mutationFn: id => deleteFile(id),
    onSuccess: () => { qc.invalidateQueries(['capaFiles']); toast.success('Evidence removed'); },
    onError: e => toast.error(e.response?.data?.error || 'Delete failed'),
  });

  const [numberingBlockedReason, setNumberingBlockedReason] = useState(null);
  useEffect(() => {
    if (editItem || idManuallyEdited || !modal) { setNumberingBlockedReason(null); return; }
    setNumberingBlockedReason(null);
    getNextCapaId(form.type).then(res => {
      setForm(f => ({ ...f, id: res.id }));
    }).catch((err) => {
      if (err.response?.data?.noRuleForDate) {
        setNumberingBlockedReason(err.response.data.error);
        setForm(f => ({ ...f, id: '' }));
      }
    });
  }, [form.type, modal, editItem, idManuallyEdited]);

  function openNew() {
    setEditItem(null);
    setIdManuallyEdited(false);
    setForm(EMPTY);
    setModal(true);
  }

  function openEdit(c) {
    setEditItem(c);
    setIdManuallyEdited(true);
    setForm({ ...c });
    setModal(true);
  }

  function handleSaveClick() {
    if (editItem && rootCauseOrActionNewlyFilled(editItem, form)) {
      setEvidencePromptBeforeSave(true);
      return;
    }
    proceedToSendForApprovalCheck();
  }

  function proceedToSendForApprovalCheck() {
    const movingToWaitingForApproval =
      editItem && editItem.status === 'In Progress' && form.status === 'Waiting for Approval';
    if (movingToWaitingForApproval) {
      const missing = getIncompleteCapaActions(form);
      if (missing.length > 0) {
        toast.error(`${missing.join(', ')} ${missing.length > 1 ? 'are' : 'is'} not completed yet — enter its completion date before changing status.`);
        return;
      }
      setConfirmSendModal(form);
    } else {
      saveMut.mutate({ ...form, created_by: CURRENT_USER.name, updated_by: CURRENT_USER.name });
    }
  }

  function f(field) {
    return e => setForm(prev => ({ ...prev, [field]: e.target.value }));
  }

  function handleIdChange(e) {
    setIdManuallyEdited(true);
    setForm(prev => ({ ...prev, id: e.target.value }));
  }

  function toggleApprover(id) {
    setApproverIds(prev => prev.includes(id) ? prev.filter(x=>x!==id) : [...prev, id]);
  }

  function dismissEvidencePrompt() {
    setEvidencePromptBeforeSave(false);
    proceedToSendForApprovalCheck();
  }

  function openAttachModalFromEvidencePrompt() {
    setEvidencePromptBeforeSave(false);
    openAttachModal(editItem.id, true);
  }

  async function doUploadEvidence(capaId, file) {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('uploaded_by', CURRENT_USER.name);
      fd.append('file_category', 'evidence');
      await uploadCapaFile(capaId, fd);
      qc.invalidateQueries(['capaFiles', capaId]);
      toast.success(`"${file.name}" uploaded`);
    } catch (err) {
      toast.error(err.response?.data?.error || `Failed to upload "${file.name}"`);
    } finally { setUploading(false); }
  }

  function openAttachModal(capaId, fromEvidencePrompt = false) {
    setAttachModal({ capaId, editFile: null, fromEvidencePrompt });
    setAttachMethod('upload');
    setAttachFile(null);
    setAttachTitle('');
    setAttachContent('');
  }

  function openEditAttachment(capaId, file) {
    setAttachModal({ capaId, editFile: file });
    setAttachMethod('create');
    setAttachFile(null);
    setAttachTitle(file.originalname);
    setAttachContent(file.content_html || '');
  }

  function closeAttachModal() {
    const wasFromEvidencePrompt = attachModal?.fromEvidencePrompt;
    setAttachModal(null);
    setAttachFile(null);
    setAttachTitle('');
    setAttachContent('');
    if (wasFromEvidencePrompt) {
      proceedToSendForApprovalCheck();
    }
  }

  function handleAttachSubmit() {
    if (!attachModal) return;
    const { capaId, editFile } = attachModal;

    if (editFile) {
      if (!attachTitle.trim()) { toast.error('Please enter a title'); return; }
      updateAttachmentMut.mutate({ fileId: editFile.id, data: { title: attachTitle.trim(), content_html: attachContent } });
      return;
    }

    if (attachMethod === 'upload') {
      if (!attachFile) { toast.error('Please choose a file'); return; }
      doUploadEvidence(capaId, attachFile);
      closeAttachModal();
    } else {
      if (!attachTitle.trim()) { toast.error('Please enter a title'); return; }
      createAttachmentMut.mutate({
        capaId,
        data: { title: attachTitle.trim(), content_html: attachContent, file_category: 'evidence', uploaded_by: CURRENT_USER.name },
      });
    }
  }

  const inProgress = capas.filter(c => c.status === 'In Progress').length;
  const waiting     = capas.filter(c => c.status === 'Waiting for Approval').length;
  const closed      = capas.filter(c => c.status === 'Approved & Closed').length;

  return (
    <div className="page">
      <div className="flex-between mb-16">
        <div>
          <div className="page-title">NCR / CAPA Register</div>
          <div className="page-sub">Nonconformities, corrective actions and observations</div>
        </div>
        <button className="btn btn-primary" onClick={openNew}><Plus size={15}/> New Record</button>
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:12, marginBottom:16 }}>
        {[
          { label:'In Progress',          value: inProgress, icon: AlertTriangle, color:'var(--red)'   },
          { label:'Waiting for Approval', value: waiting,     icon: Clock,         color:'var(--amber)' },
          { label:'Approved & Closed',    value: closed,      icon: CheckCircle,   color:'var(--green)' },
        ].map(({ label, value, icon: Icon, color }) => (
          <div className="stat-card" key={label} style={{ display:'flex', alignItems:'center', gap:14 }}>
            <Icon size={22} color={color}/>
            <div>
              <div className="stat-label">{label}</div>
              <div className="stat-value" style={{ fontSize:20 }}>{value}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="toolbar mb-12">
        <div style={{ position:'relative', flex:1, minWidth:180 }}>
          <Search size={14} style={{ position:'absolute', left:9, top:'50%', transform:'translateY(-50%)', color:'var(--text-3)' }}/>
          <input style={{ paddingLeft:30 }} placeholder="Search title or ID…" value={search} onChange={e => setSearch(e.target.value)}/>
        </div>
        <select value={filterStatus} onChange={e => setFSt(e.target.value)}>
          <option value="">All statuses</option>
          {STATUSES.map(s => <option key={s}>{s}</option>)}
        </select>
        <select value={filterType} onChange={e => setFType(e.target.value)}>
          <option value="">All types</option>
          {TYPES.map(t => <option key={t}>{t}</option>)}
        </select>
      </div>

      {isLoading ? <Spinner/> : capas.length === 0 ? (
        <EmptyState icon={AlertTriangle} title="No records found" sub="Add your first NCR or CAPA using the button above"/>
      ) : (
        <div>
          {capas.map(c => (
            <div key={c.id} className="card" style={{ marginBottom:12 }}>
              <div className="card-head" style={{ cursor:'pointer' }} onClick={() => { setExpanded(expanded === c.id ? null : c.id); setFilesId(null); }}>
                <div style={{ flex:1 }}>
                  <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:4, flexWrap:'wrap' }}>
                    <span className="pill pill-gray" style={{ fontSize:10 }}>{c.type}</span>
                    {capaStatusPill(c.status)}
                    {shouldShowApprovalPill(c) && approvalStatusPill(c.approval_status)}
                    <span style={{ fontFamily:'var(--mono)', fontSize:11, color:'var(--text-2)' }}>{c.id}</span>
                  </div>
                  <div style={{ fontWeight:500, fontSize:14 }}>{c.title}</div>
                  <div style={{ fontSize:12, color:'var(--text-2)', marginTop:3, display:'flex', gap:12, flexWrap:'wrap' }}>
                    <span>{c.owner || '—'}</span>
                    <span>Due {fmtDate(c.due_date)}</span>
                    <span>{c.clause || '—'}</span>
                    <span>{c.source || '—'}</span>
                    <span>Raised {fmtDate(c.raised_at)}</span>
                  </div>
                </div>
                <div style={{ display:'flex', alignItems:'center', gap:8, flexShrink:0 }}>
                  <div style={{ textAlign:'right' }}>
                    <div style={{ fontSize:12, color:'var(--text-2)', marginBottom:4 }}>{c.pct_complete}% complete</div>
                    <div style={{ width:100 }}>
                      <ProgressBar pct={c.pct_complete} amber={c.pct_complete < 100 && c.pct_complete > 0}/>
                    </div>
                  </div>
                  {(!c.approval_status || c.approval_status === 'Not Submitted' || c.approval_status === 'Rejected') && (
                    <button className="btn btn-ghost btn-icon btn-sm" title="Submit for approval" onClick={e=>{
                      e.stopPropagation();
                      const missing = getIncompleteCapaActions(c);
                      if (missing.length > 0) {
                        toast.error(`${missing.join(', ')} ${missing.length > 1 ? 'are' : 'is'} not completed yet — enter its completion date before submitting for approval.`);
                        return;
                      }
                      setSubmitModal(c);
                    }}><Send size={14}/></button>
                  )}
                  <button className="btn btn-ghost btn-icon btn-sm" title="Evidence" onClick={e=>{ e.stopPropagation(); setExpanded(c.id); setFilesId(filesId===c.id?null:c.id); }}><Paperclip size={14}/></button>
                  <button className="btn btn-ghost btn-icon btn-sm" title="Preview & Download PDF" onClick={e=>{ e.stopPropagation(); setPreviewCapaId(c.id); }}><FileDown size={14}/></button>
                  {isCapaLocked(c)
                    ? <button className="btn btn-ghost btn-icon btn-sm" title="Locked" disabled><Lock size={14}/></button>
                    : <button className="btn btn-ghost btn-icon btn-sm" title="Edit" onClick={e => { e.stopPropagation(); openEdit(c); }}><Edit2 size={14}/></button>}
                  <button className="btn btn-ghost btn-icon btn-sm" title={isCapaLocked(c) ? 'Cannot delete locked records' : 'Delete'} onClick={e => { e.stopPropagation(); setDel(c); }} disabled={isCapaLocked(c)}><Trash2 size={14}/></button>
                </div>
              </div>

              {expanded === c.id && (
                <div className="card-body" style={{ background:'var(--bg)' }}>
                  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:20 }}>
                    <div>
                      <SectionHead>Nonconformity Detail</SectionHead>
                      <p style={{ fontSize:13, color:'var(--text-2)' }}>{c.detail || 'No detail provided.'}</p>
                      <SectionHead style={{ marginTop:12 }}>Root Cause</SectionHead>
                      <p style={{ fontSize:13, color:'var(--text-2)' }}>{c.root_cause || 'Pending investigation.'}</p>
                    </div>
                    <div>
                      <SectionHead>Corrective Action</SectionHead>
                      <p style={{ fontSize:13, color:'var(--text-2)' }}>{c.action || 'No action recorded yet.'}</p>
                      <div style={{ fontSize:12, color:'var(--text-2)', marginTop:4, display:'flex', gap:14 }}>
                        <span>Due {fmtDate(c.corrective_due_date)}</span>
                        <span>Completed {c.corrective_completion_date ? `${fmtDate(c.corrective_completion_date)} by ${c.corrective_completed_by || 'Unknown'}` : '—'}</span>
                      </div>
                      {c.closed_at && (
                        <>
                          <SectionHead style={{ marginTop:12 }}>Closed On</SectionHead>
                          <p style={{ fontSize:13 }}>{fmtDateTime(c.closed_at)}</p>
                        </>
                      )}
                    </div>
                  </div>

                  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:20, marginTop:16 }}>
                    <div>
                      <SectionHead>Preventive Action</SectionHead>
                      <p style={{ fontSize:13, color:'var(--text-2)' }}>{c.preventive_action || 'No action recorded yet.'}</p>
                      <div style={{ fontSize:12, color:'var(--text-2)', marginTop:4, display:'flex', gap:14 }}>
                        <span>Due {fmtDate(c.preventive_due_date)}</span>
                        <span>Completed {c.preventive_completion_date ? `${fmtDate(c.preventive_completion_date)} by ${c.preventive_completed_by || 'Unknown'}` : '—'}</span>
                      </div>
                    </div>
                    <div>
                      <SectionHead>Verify Effectiveness of Implemented Action</SectionHead>
                      <p style={{ fontSize:13, color:'var(--text-2)' }}>{c.verification_comments || 'Not yet verified.'}</p>
                      <div style={{ fontSize:12, color:'var(--text-2)', marginTop:4 }}>
                        <span>Verified {c.verification_date ? `${fmtDate(c.verification_date)} by ${c.verified_by || 'Unknown'}` : '—'}</span>
                      </div>
                    </div>
                  </div>

                  {capaWorkflow && capaWorkflow.status === 'In Progress' && (
                    <div style={{ marginTop:16, paddingTop:16, borderTop:'1px solid var(--border)' }}>
                      <div className="flex-between" style={{ marginBottom:8 }}>
                        <SectionHead style={{ margin:0 }}>Approval In Progress</SectionHead>
                        <button className="btn btn-ghost btn-sm" onClick={()=>cancelWfMut.mutate(capaWorkflow.id)}>Withdraw</button>
                      </div>
                      <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
                        {capaWorkflow.steps.map(s => (
                          <div key={s.id} style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'8px 12px', background:'var(--bg-card)', border:'1px solid var(--border)', borderRadius:'var(--radius-md)' }}>
                            <div style={{ fontSize:13 }}>
                              <span style={{ fontWeight:500 }}>{s.step_order}. {s.approver_name}</span>
                              <span style={{ marginLeft:8, fontSize:11, color:'var(--text-2)' }}>{s.status}</span>
                            </div>
                            {s.status === 'Awaiting' && s.approver_id === CURRENT_USER.id && (
                              <div style={{ display:'flex', gap:6 }}>
                                <button className="btn btn-sm btn-green" onClick={()=>approveMut.mutate({ wfId:capaWorkflow.id, stepId:s.id })}>
                                  <CheckCircle size={12}/> Approve
                                </button>
                                <button className="btn btn-sm btn-red" onClick={()=>{
                                  const comment = window.prompt('Reason for rejection:');
                                  if (comment) rejectMut.mutate({ wfId:capaWorkflow.id, stepId:s.id, comment });
                                }}>
                                  <XCircle size={12}/> Reject
                                </button>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {filesId === c.id && (
                    <div style={{ marginTop:16, paddingTop:16, borderTop:'1px solid var(--border)' }}>
                      <div className="flex-between mb-8">
                        <SectionHead style={{ margin:0 }}>Supporting Evidence</SectionHead>
                        <button className="btn btn-sm btn-primary" onClick={()=>openAttachModal(c.id)} disabled={uploading}>
                          <Paperclip size={13}/> Attach
                        </button>
                      </div>
                      {filesLoading ? <Spinner/> : capaFiles.length === 0 ? (
                        <div style={{ fontSize:13, color:'var(--text-2)', padding:'8px 0' }}>No evidence attached yet.</div>
                      ) : capaFiles.map(file => {
                        const isCreated = file.mimetype === 'application/x-qms-document';
                        return (
                          <div key={file.id} style={{ display:'flex', alignItems:'center', gap:10, padding:'8px 12px', background:'var(--green-bg)', border:'1px solid #B8E0A0', borderRadius:'var(--radius-md)', marginBottom:6 }}>
                            {fileIcon(file.mimetype)}
                            <div style={{ flex:1 }}>
                              <div style={{ fontSize:13, fontWeight:500 }}>
                                {file.originalname}
                                {isCreated && <span className="pill" style={{ fontSize:9, marginLeft:6, background:'#EFE6FB', color:'#6940A5' }}>CREATED</span>}
                              </div>
                              <div style={{ fontSize:11, color:'var(--text-2)' }}>{isCreated ? `${file.size} chars` : formatBytes(file.size)} · {file.uploaded_by} · {fmtDateTime(file.uploaded_at)}</div>
                            </div>
                            {isCreated ? (
                              <>
                                <button className="btn btn-sm" onClick={()=>setViewCreatedDoc(file)}><Eye size={13}/> View</button>
                                <button className="btn btn-sm" onClick={()=>openEditAttachment(c.id, file)}><PenLine size={13}/> Edit</button>
                              </>
                            ) : (
                              <button className="btn btn-sm btn-green" onClick={()=>downloadFile(file.id, file.originalname)}><Download size={13}/> Download</button>
                            )}
                            <button className="btn btn-ghost btn-sm" style={{ color:'var(--red)' }} onClick={()=>setDelFile(file)}><X size={13}/></button>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  <div style={{ marginTop:16, paddingTop:16, borderTop:'1px solid var(--border)' }}>
                    <SectionHead style={{ marginBottom:8 }}>Audit Trail</SectionHead>
                    {(() => {
                      const trail = buildAuditTrail(c, capaWorkflowHistory);
                      if (trail.length === 0) {
                        return <div style={{ fontSize:13, color:'var(--text-2)', padding:'4px 0' }}>No history recorded yet.</div>;
                      }
                      return (
                        <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
                          {trail.map((e, i) => (
                            <div key={i} style={{ display:'flex', alignItems:'flex-start', gap:8, fontSize:12 }}>
                              <span style={{
                                flexShrink:0, marginTop:5, width:6, height:6, borderRadius:'50%',
                                background: e.kind==='approve' ? 'var(--green)' : e.kind==='reject' ? 'var(--red)' : e.kind==='submit' ? 'var(--accent)' : 'var(--text-3)',
                              }}/>
                              <div style={{ flex:1 }}>
                                <span style={{ fontWeight:500 }}>{e.label}</span>
                                <span style={{ color:'var(--text-2)' }}> by {e.by} · {fmtDateTime(e.at)}</span>
                                {e.comment && <div style={{ color:'var(--text-2)', marginTop:1, fontStyle:'italic' }}>"{e.comment}"</div>}
                              </div>
                            </div>
                          ))}
                        </div>
                      );
                    })()}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <Modal open={modal} onClose={() => setModal(false)} title={editItem ? `Edit — ${editItem.id}` : 'New NCR / CAPA'} size="modal-lg">
        <div className="form-2col">
          <div className="form-row">
            <label>Record ID {!editItem && <span style={{ fontWeight:400, color:'var(--text-3)' }}>(auto-generated — edit to override)</span>}</label>
            <input value={form.id} onChange={handleIdChange} placeholder="e.g. NCR-001" disabled={!!editItem}/>
          </div>
          <div className="form-row">
            <label>Type</label>
            <select value={form.type} onChange={e=>{ setIdManuallyEdited(false); f('type')(e); }}>{TYPES.map(t => <option key={t}>{t}</option>)}</select>
          </div>
        </div>
        {numberingBlockedReason && !idManuallyEdited && (
          <div style={{ display:'flex', gap:10, padding:'10px 12px', background:'var(--amber-bg)', border:'1px solid #F0C36D', borderRadius:'var(--radius-md)', marginBottom:14 }}>
            <AlertCircle size={16} style={{ color:'var(--amber)', flexShrink:0, marginTop:1 }}/>
            <div style={{ fontSize:13, color:'#7A5B12' }}>
              {numberingBlockedReason} You can also type a Record ID manually above to continue without fixing this now.
            </div>
          </div>
        )}
        <div className="form-row"><label>Title</label><input value={form.title} onChange={f('title')} placeholder="Brief title of the nonconformity"/></div>
        <div className="form-row"><label>Detail</label><textarea value={form.detail} onChange={f('detail')} placeholder="Describe the nonconformity or finding in detail…"/></div>
        <div className="form-2col">
          <div className="form-row"><label>Standard Clause</label><input value={form.clause} onChange={f('clause')} placeholder="e.g. 8.7 or A.5.10"/></div>
          <div className="form-row"><label>Source</label><select value={form.source} onChange={f('source')}>{SOURCES.map(s => <option key={s}>{s}</option>)}</select></div>
        </div>
        <div className="form-2col">
          <div className="form-row">
            <label>Assigned To</label>
            <select
              value={form.owner_id || ''}
              onChange={e => {
                const uid = e.target.value ? parseInt(e.target.value, 10) : '';
                const user = users.find(u => u.id === uid);
                setForm(prev => ({ ...prev, owner_id: uid, owner: user ? user.name : '' }));
              }}
            >
              <option value="">— Unassigned —</option>
              {users.map(u => <option key={u.id} value={u.id}>{u.name} ({u.role})</option>)}
            </select>
            <div className="input-hint">The selected person will be notified when this record is saved.</div>
          </div>
          <div className="form-row"><label>Due Date</label><input type="date" value={form.due_date} onChange={f('due_date')}/></div>
        </div>
        <div className="form-row"><label>Root Cause</label><textarea value={form.root_cause} onChange={f('root_cause')} placeholder="Root cause analysis…" style={{ minHeight:60 }}/></div>
        <div className="form-row"><label>Corrective Action</label><textarea value={form.action} onChange={f('action')} placeholder="Planned or completed corrective actions…" style={{ minHeight:60 }}/></div>
        <div className="form-2col">
          <div className="form-row"><label>Corrective Action — Due Date</label><input type="date" value={form.corrective_due_date || ''} onChange={f('corrective_due_date')}/></div>
          <div className="form-row"><label>Corrective Action — Completion Date</label><input type="date" value={form.corrective_completion_date || ''} onChange={f('corrective_completion_date')}/></div>
        </div>

        <div className="form-row"><label>Preventive Action</label><textarea value={form.preventive_action} onChange={f('preventive_action')} placeholder="Planned or completed preventive actions…" style={{ minHeight:60 }}/></div>
        <div className="form-2col">
          <div className="form-row"><label>Preventive Action — Due Date</label><input type="date" value={form.preventive_due_date || ''} onChange={f('preventive_due_date')}/></div>
          <div className="form-row"><label>Preventive Action — Completion Date</label><input type="date" value={form.preventive_completion_date || ''} onChange={f('preventive_completion_date')}/></div>
        </div>

        <div className="form-row"><label>Verify Effectiveness of Implemented Action</label><textarea value={form.verification_comments} onChange={f('verification_comments')} placeholder="Comments on the effectiveness of the corrective/preventive actions…" style={{ minHeight:60 }}/></div>
        <div className="form-row"><label>Verification Date</label><input type="date" value={form.verification_date || ''} onChange={f('verification_date')}/></div>

        <div className="form-2col">
          <div className="form-row">
            <label>Status</label>
            <select value={form.status} onChange={f('status')}>{EDITABLE_STATUSES.map(s => <option key={s}>{s}</option>)}</select>
          </div>
          <div className="form-row">
            <label>% Complete — {form.pct_complete}%</label>
            <input type="range" min={0} max={100} step={5} value={form.pct_complete}
              onChange={e => setForm(p => ({ ...p, pct_complete: parseInt(e.target.value) }))}
              style={{ padding:0, marginTop:8 }}/>
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn" onClick={() => setModal(false)}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSaveClick} disabled={saveMut.isPending || (!!numberingBlockedReason && !idManuallyEdited && !form.id)}>
            {saveMut.isPending ? 'Saving…' : 'Save Record'}
          </button>
        </div>
      </Modal>

      <Modal open={evidencePromptBeforeSave} onClose={dismissEvidencePrompt} title="Upload Supporting Evidence?">
        <div style={{ display:'flex', gap:10, padding:'10px 12px', background:'var(--accent-bg)', border:'1px solid var(--border)', borderRadius:'var(--radius-md)', marginBottom:16 }}>
          <Paperclip size={16} style={{ color:'var(--accent)', flexShrink:0, marginTop:1 }}/>
          <div style={{ fontSize:13, color:'var(--text-1)' }}>
            You've added a Root Cause or Corrective Action. Would you like to attach supporting evidence for it now?
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn" onClick={dismissEvidencePrompt}>No, Just Continue</button>
          <button className="btn btn-primary" onClick={openAttachModalFromEvidencePrompt}>
            <Paperclip size={13}/> Upload Evidence
          </button>
        </div>
      </Modal>

      <Modal open={!!confirmSendModal} onClose={() => setConfirmSendModal(null)} title="Send for Approval?">
        <p style={{ fontSize:13, color:'var(--text-2)', marginBottom:16 }}>
          You're changing this record's status to <strong>Waiting for Approval</strong>. Would you like to send it
          for approval now, or just save the status change and submit it later?
        </p>
        <div className="modal-footer">
          <button className="btn" onClick={() => setConfirmSendModal(null)}>Cancel</button>
          <button
            className="btn"
            disabled={saveMut.isPending}
            onClick={() => {
              const data = confirmSendModal;
              setConfirmSendModal(null);
              saveMut.mutate({ ...data, created_by: CURRENT_USER.name, updated_by: CURRENT_USER.name });
            }}
          >
            Just Save
          </button>
          <button
            className="btn btn-primary"
            disabled={saveMut.isPending}
            onClick={() => {
              const data = confirmSendModal;
              setConfirmSendModal(null);
              saveMut.mutate({
                ...data,
                created_by: CURRENT_USER.name,
                updated_by: CURRENT_USER.name,
                __sendForApprovalAfterSave: true,
              });
            }}
          >
            Save &amp; Send for Approval
          </button>
        </div>
      </Modal>

      <Modal open={!!submitModal} onClose={()=>{ setSubmitModal(null); setApproverIds([]); }} title={`Submit for Approval — ${submitModal?.id}`}>
        <div style={{ display:'flex', gap:10, padding:'10px 12px', background:'var(--amber-bg)', border:'1px solid #F0C36D', borderRadius:'var(--radius-md)', marginBottom:14 }}>
          <AlertCircle size={16} style={{ color:'var(--amber)', flexShrink:0, marginTop:1 }}/>
          <div style={{ fontSize:13, color:'#7A5B12' }}>
            <strong>This cannot be undone.</strong> Once every approver below signs off, this record becomes <strong>Approved &amp; Closed</strong> and is permanently locked.
          </div>
        </div>
        <p style={{ fontSize:13, color:'var(--text-2)', marginBottom:12 }}>Select reviewers/approvers <strong>in order</strong>.</p>
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
          <button className="btn btn-red" disabled={approverIds.length===0||submitMut.isPending}
            onClick={()=>submitMut.mutate({ capa_id:submitModal.id, submitted_by:CURRENT_USER.name, approver_ids:approverIds })}>
            {submitMut.isPending?'Submitting…':`Submit to ${approverIds.length} Approver${approverIds.length>1?'s':''}`}
          </button>
        </div>
      </Modal>

      {attachModal && (
        <div className="modal-overlay" onClick={closeAttachModal}>
          <div className="modal modal-lg" onClick={e=>e.stopPropagation()} style={{ maxWidth: attachMethod==='create' || attachModal.editFile ? 720 : 480 }}>
            <div className="flex-between mb-12">
              <div style={{ fontWeight:600, fontSize:16 }}>{attachModal.editFile ? 'Edit Evidence' : 'Attach Evidence'}</div>
              <button className="btn btn-ghost btn-icon" onClick={closeAttachModal}><X size={16}/></button>
            </div>

            {!attachModal.editFile && (
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
                    <FileUp size={15}/> Upload an Existing Document
                  </button>
                  <button onClick={()=>setAttachMethod('create')}
                    style={{
                      flex:1, display:'flex', alignItems:'center', justifyContent:'center', gap:8, padding:'10px 12px', borderRadius:'var(--radius-md)', cursor:'pointer',
                      border:`1px solid ${attachMethod==='create' ? 'var(--accent)' : 'var(--border-md)'}`,
                      background: attachMethod==='create' ? 'var(--accent-bg)' : 'transparent',
                      color: attachMethod==='create' ? 'var(--accent)' : 'var(--text-1)', fontSize:13, fontWeight:500,
                    }}>
                    <FilePlus size={15}/> Create Evidence Document
                  </button>
                </div>
              </div>
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
              </div>
            )}

            {(attachModal.editFile || attachMethod === 'create') && (
              <>
                <div className="form-row">
                  <label>Evidence Title</label>
                  <input value={attachTitle} onChange={e=>setAttachTitle(e.target.value)} placeholder="e.g. Root Cause Analysis Worksheet"/>
                </div>
                <div className="form-row">
                  <label>Content</label>
                  <RichTextEditor
                    value={attachContent}
                    onChange={setAttachContent}
                    placeholder="Write the evidence content here…"
                  />
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

      {previewCapaId && (
        <CapaPreviewModal capaId={previewCapaId} onClose={()=>setPreviewCapaId(null)}/>
      )}

      <ConfirmDialog open={!!delTarget} onClose={() => setDel(null)} danger
        title="Delete Record"
        message={`Permanently delete "${delTarget?.title}"? This cannot be undone.`}
        onConfirm={() => delMut.mutate(delTarget.id)}
      />

      <ConfirmDialog open={!!delFile} onClose={()=>setDelFile(null)} danger
        title="Remove Evidence"
        message={`Remove "${delFile?.originalname}" from this record?`}
        onConfirm={()=>{ delFileMut.mutate(delFile.id); setDelFile(null); }}
      />
    </div>
  );
}
