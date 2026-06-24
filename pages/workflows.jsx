import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle, XCircle, Clock, ChevronDown, Eye, FileText, AlertTriangle, AlertCircle, Archive } from 'lucide-react';
import toast from 'react-hot-toast';
import {
  getWorkflows, approveStep, rejectStep, cancelWorkflow, getPendingForUser,
  getCapaWorkflows, approveCapaStep, rejectCapaStep, cancelCapaWorkflow, getPendingCapasForUser,
} from '../api';
import { statusPill, standardPill, fmtDateTime, Spinner, EmptyState, Modal, WorkflowStepper, SectionHead } from '../components/UI';
import DocumentPreviewModal from '../components/DocumentPreviewModal';
import CapaPreviewModal from '../components/CapaPreviewModal';
import { CURRENT_USER } from '../components/AppShell';

export default function Workflows() {
  const qc = useQueryClient();
  const [tab, setTab]           = useState('pending');
  const [filterStatus, setFSt]  = useState('');
  const [expanded, setExpanded] = useState(null);
  const [actionModal, setAction]= useState(null);
  const [comment, setComment]   = useState('');
  const [previewDocId, setPreviewDocId] = useState(null);
  const [previewCapa, setPreviewCapa]   = useState(null);

  const { data: pendingDocs = [], isLoading: pendDocsLoading } = useQuery({
    queryKey: ['pending', CURRENT_USER.id],
    queryFn:  () => getPendingForUser(CURRENT_USER.id),
    refetchInterval: 30000,
  });

  const { data: pendingCapas = [], isLoading: pendCapasLoading } = useQuery({
    queryKey: ['pendingCapas', CURRENT_USER.id],
    queryFn:  () => getPendingCapasForUser(CURRENT_USER.id),
    refetchInterval: 30000,
  });

  const { data: allDocWf = [], isLoading: allDocLoading } = useQuery({
    queryKey: ['workflows', filterStatus],
    queryFn:  () => getWorkflows(filterStatus ? { status: filterStatus } : {}),
  });

  const { data: allCapaWf = [], isLoading: allCapaLoading } = useQuery({
    queryKey: ['capaWorkflows', filterStatus],
    queryFn:  () => getCapaWorkflows(filterStatus ? { status: filterStatus } : {}),
  });

  const pending = [
    ...pendingDocs.map(s => ({ ...s, kind: 'document', record_id: s.doc_id, record_title: s.doc_title, record_meta: `${s.doc_id} · v${s.doc_version} · ${s.doc_type} · ${s.doc_standard}` })),
    ...pendingCapas.map(s => ({ ...s, kind: 'capa', record_id: s.capa_id, record_title: s.capa_title, record_meta: `${s.capa_id} · ${s.capa_type}${s.capa_clause ? ' · ' + s.capa_clause : ''}` })),
  ].sort((a, b) => new Date(a.wf_created) - new Date(b.wf_created));

  const allWf = [
    ...allDocWf.map(wf => ({ ...wf, kind: 'document', record_id: wf.doc_id, record_version: wf.doc_version })),
    ...allCapaWf.map(wf => ({ ...wf, kind: 'capa', record_id: wf.capa_id, record_version: null })),
  ].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  const approveMut = useMutation({
    mutationFn: ({ wfId, stepId, comment, kind }) => kind === 'capa' ? approveCapaStep(wfId, stepId, { comment }) : approveStep(wfId, stepId, { comment }),
    onSuccess: () => {
      qc.invalidateQueries(['workflows']); qc.invalidateQueries(['pending']);
      qc.invalidateQueries(['capaWorkflows']); qc.invalidateQueries(['pendingCapas']);
      qc.invalidateQueries(['documents']); qc.invalidateQueries(['capas']); qc.invalidateQueries(['stats']);
      toast.success('Step approved'); setAction(null); setComment('');
    },
    onError: e => toast.error(e.response?.data?.error || 'Failed'),
  });

  const rejectMut = useMutation({
    mutationFn: ({ wfId, stepId, comment, kind }) => kind === 'capa' ? rejectCapaStep(wfId, stepId, { comment }) : rejectStep(wfId, stepId, { comment }),
    onSuccess: (_, variables) => {
      qc.invalidateQueries(['workflows']); qc.invalidateQueries(['pending']);
      qc.invalidateQueries(['capaWorkflows']); qc.invalidateQueries(['pendingCapas']);
      qc.invalidateQueries(['documents']); qc.invalidateQueries(['capas']); qc.invalidateQueries(['stats']);
      toast.success(variables.kind === 'capa' ? 'Step rejected' : 'Step rejected — document returned to Draft');
      setAction(null); setComment('');
    },
    onError: e => toast.error(e.response?.data?.error || 'Failed'),
  });

  const cancelMut = useMutation({
    mutationFn: ({ id, kind }) => kind === 'capa' ? cancelCapaWorkflow(id) : cancelWorkflow(id),
    onSuccess: () => {
      qc.invalidateQueries(['workflows']); qc.invalidateQueries(['capaWorkflows']);
      qc.invalidateQueries(['documents']); qc.invalidateQueries(['capas']);
      toast.success('Workflow cancelled');
    },
    onError: e => toast.error(e.response?.data?.error || 'Failed'),
  });

  function wfStatusPill(s) {
    const map = { 'In Progress':'pill-blue', Approved:'pill-green', Rejected:'pill-red', Cancelled:'pill-gray' };
    return <span className={`pill ${map[s]||'pill-gray'}`}>{s}</span>;
  }

  const isLoading = tab === 'pending' ? (pendDocsLoading || pendCapasLoading) : (allDocLoading || allCapaLoading);

  return (
    <div className="page">
      <div className="flex-between mb-16">
        <div>
          <div className="page-title">Approval Workflows</div>
          <div className="page-sub">Sequential approval for documents and NCR/CAPA records — sign off or reject</div>
        </div>
        {pending.length > 0 && (
          <div className="action-bar" style={{ marginBottom:0 }}>
            <span className="action-bar-text">{pending.length} item{pending.length>1?'s':''} awaiting your approval</span>
          </div>
        )}
      </div>

      <div style={{ display:'flex', gap:4, borderBottom:'1px solid var(--border)', marginBottom:16 }}>
        {[['pending',`My Queue (${pending.length})`],['all','All Workflows']].map(([key,label]) => (
          <button key={key} onClick={() => setTab(key)} style={{
            fontSize:13, padding:'7px 14px', cursor:'pointer', background:'transparent',
            border:'none', borderBottom: tab===key ? '2px solid var(--accent)' : '2px solid transparent',
            color: tab===key ? 'var(--accent)' : 'var(--text-2)', fontWeight: tab===key ? 500 : 400,
            marginBottom:-1, fontFamily:'var(--font)',
          }}>{label}</button>
        ))}
        {tab === 'all' && (
          <select style={{ marginLeft:'auto', width:'auto' }} value={filterStatus} onChange={e => setFSt(e.target.value)}>
            <option value="">All statuses</option>
            {['In Progress','Approved','Rejected','Cancelled'].map(s=><option key={s}>{s}</option>)}
          </select>
        )}
      </div>

      {isLoading ? <Spinner/> : (
        <>
          {tab === 'pending' && (
            pending.length === 0 ? (
              <EmptyState icon={CheckCircle} title="No pending approvals" sub="You're all caught up — nothing waiting for your signature"/>
            ) : pending.map(step => (
              <div key={`${step.kind}-${step.id}`} className="card" style={{ marginBottom:12 }}>
                <div className="card-body">
                  <div className="flex-between">
                    <div>
                      <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                        <span className="pill pill-gray" style={{ fontSize:9 }}>
                          {step.kind === 'capa' ? 'NCR/CAPA' : 'Document'}
                        </span>
                        {step.purpose === 'retirement' && (
                          <span className="pill pill-red" style={{ fontSize:9 }}>Retirement</span>
                        )}
                        <div style={{ fontSize:15, fontWeight:600 }}>{step.record_title}</div>
                      </div>
                      <div style={{ fontSize:12, color:'var(--text-2)', marginTop:3 }}>{step.record_meta}</div>
                      <div style={{ fontSize:12, color:'var(--text-2)', marginTop:2 }}>
                        Submitted by {step.submitted_by} · {fmtDateTime(step.wf_created)}
                      </div>
                      {step.purpose === 'retirement' && (
                        <div style={{ fontSize:12, color:'var(--red)', marginTop:4, display:'flex', alignItems:'center', gap:5 }}>
                          <AlertCircle size={12}/> Approving this permanently retires and locks the document — it cannot be undone.
                        </div>
                      )}
                    </div>
                    <div style={{ display:'flex', gap:8 }}>
                      <button className="btn" onClick={() => step.kind === 'capa' ? setPreviewCapa({ id: step.record_id, step }) : setPreviewDocId(step.record_id)}>
                        <Eye size={14}/> {step.kind === 'capa' ? 'View Record' : 'View Document'}
                      </button>
                      <button className="btn btn-green" onClick={() => { setAction({ wfId:step.workflow_id, stepId:step.id, type:'approve', kind:step.kind, purpose:step.purpose }); setComment(''); }}>
                        <CheckCircle size={14}/> Approve
                      </button>
                      <button className="btn btn-red" onClick={() => { setAction({ wfId:step.workflow_id, stepId:step.id, type:'reject', kind:step.kind, purpose:step.purpose }); setComment(''); }}>
                        <XCircle size={14}/> Reject
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ))
          )}

          {tab === 'all' && (
            allWf.length === 0 ? (
              <EmptyState icon={Clock} title="No workflows found" sub="Workflows are created when a document or NCR/CAPA record is submitted for approval"/>
            ) : allWf.map(wf => (
              <div key={`${wf.kind}-${wf.id}`} className="card" style={{ marginBottom:12 }}>
                <div className="card-head" style={{ cursor:'pointer' }} onClick={() => setExpanded(expanded===`${wf.kind}-${wf.id}` ? null : `${wf.kind}-${wf.id}`)}>
                  <div>
                    <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                      <span className="pill pill-gray" style={{ fontSize:9 }}>{wf.kind === 'capa' ? 'NCR/CAPA' : 'Document'}</span>
                      {wf.purpose === 'retirement' && <span className="pill pill-red" style={{ fontSize:9 }}>Retirement</span>}
                      <div style={{ fontWeight:500, fontSize:14 }}>{wf.record_id}{wf.record_version ? ` — v${wf.record_version}` : ''}</div>
                    </div>
                    <div style={{ fontSize:12, color:'var(--text-2)', marginTop:2 }}>
                      Submitted by {wf.submitted_by} · {fmtDateTime(wf.created_at)}
                    </div>
                  </div>
                  <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                    {wfStatusPill(wf.status)}
                    <button className="btn btn-ghost btn-sm" onClick={e => {
                      e.stopPropagation();
                      if (wf.kind === 'capa') {
                        const myStep = wf.steps?.find(s => s.status === 'Awaiting' && s.approver_id === CURRENT_USER.id);
                        setPreviewCapa({ id: wf.record_id, step: myStep ? { workflow_id: wf.id, id: myStep.id, kind: 'capa' } : null });
                      } else {
                        setPreviewDocId(wf.record_id);
                      }
                    }}>
                      <Eye size={13}/> View
                    </button>
                    {wf.status === 'In Progress' && (
                      <button className="btn btn-ghost btn-sm" onClick={e => { e.stopPropagation(); cancelMut.mutate({ id: wf.id, kind: wf.kind }); }}>Cancel</button>
                    )}
                    {expanded === `${wf.kind}-${wf.id}` ? <ChevronDown size={16}/> : <ChevronDown size={16} style={{ transform:'rotate(-90deg)' }}/>}
                  </div>
                </div>

                {expanded === `${wf.kind}-${wf.id}` && (
                  <div className="card-body">
                    {wf.rejection_comment && (
                      <div style={{ background:'var(--red-bg)', border:'1px solid #F5A9AB', borderRadius:'var(--radius-md)', padding:'10px 14px', fontSize:13, color:'var(--red)', marginBottom:14 }}>
                        <strong>Rejection reason:</strong> {wf.rejection_comment}
                      </div>
                    )}
                    <SectionHead>Approval Steps</SectionHead>
                    <WorkflowStepper steps={wf.steps}/>
                    {wf.completed_at && (
                      <div style={{ marginTop:10, fontSize:12, color:'var(--text-2)' }}>
                        Completed: {fmtDateTime(wf.completed_at)}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))
          )}
        </>
      )}

      <Modal
        open={!!actionModal}
        onClose={() => { setAction(null); setComment(''); }}
        title={
          actionModal?.type === 'approve'
            ? (actionModal?.purpose === 'retirement' ? 'Approve Retirement' : 'Approve Step')
            : `Reject ${actionModal?.kind === 'capa' ? 'Record' : actionModal?.purpose === 'retirement' ? 'Retirement' : 'Document'}`
        }
      >
        {actionModal?.type === 'approve' && actionModal?.purpose === 'retirement' && (
          <div style={{ display:'flex', gap:10, padding:'10px 12px', background:'var(--amber-bg)', border:'1px solid #F0C36D', borderRadius:'var(--radius-md)', marginBottom:14 }}>
            <AlertCircle size={16} style={{ color:'var(--amber)', flexShrink:0, marginTop:1 }}/>
            <div style={{ fontSize:13, color:'#7A5B12' }}>
              <strong>This cannot be undone.</strong> Approving this step moves the document one step closer to being permanently <strong>Retired and locked</strong>.
            </div>
          </div>
        )}
        {actionModal?.type === 'approve' && actionModal?.kind === 'capa' && (
          <div style={{ display:'flex', gap:10, padding:'10px 12px', background:'var(--amber-bg)', border:'1px solid #F0C36D', borderRadius:'var(--radius-md)', marginBottom:14 }}>
            <AlertCircle size={16} style={{ color:'var(--amber)', flexShrink:0, marginTop:1 }}/>
            <div style={{ fontSize:13, color:'#7A5B12' }}>
              <strong>This cannot be undone.</strong> If you're the final approver, the record will be locked immediately.
            </div>
          </div>
        )}
        <p style={{ fontSize:13, color:'var(--text-2)', marginBottom:12 }}>
          {actionModal?.type === 'approve'
            ? 'You can optionally add a comment before approving.'
            : 'A rejection comment is required.'}
        </p>
        <div className="form-row">
          <label>{actionModal?.type === 'approve' ? 'Comment (optional)' : 'Rejection reason (required)'}</label>
          <textarea value={comment} onChange={e => setComment(e.target.value)} placeholder={actionModal?.type === 'approve' ? 'Looks good…' : 'Describe what needs to be corrected…'}/>
        </div>
        <div className="modal-footer">
          <button className="btn" onClick={() => { setAction(null); setComment(''); }}>Cancel</button>
          {actionModal?.type === 'approve' ? (
            <button className={(actionModal?.purpose === 'retirement' || actionModal?.kind === 'capa') ? 'btn btn-red' : 'btn btn-green'} disabled={approveMut.isPending}
              onClick={() => approveMut.mutate({ wfId: actionModal.wfId, stepId: actionModal.stepId, comment, kind: actionModal.kind })}>
              {approveMut.isPending ? 'Approving…' : actionModal?.purpose === 'retirement' ? 'Confirm — Approve Retirement' : 'Confirm Approval'}
            </button>
          ) : (
            <button className="btn btn-red" disabled={!comment.trim() || rejectMut.isPending}
              onClick={() => rejectMut.mutate({ wfId: actionModal.wfId, stepId: actionModal.stepId, comment, kind: actionModal.kind })}>
              {rejectMut.isPending ? 'Rejecting…' : 'Confirm Rejection'}
            </button>
          )}
        </div>
      </Modal>

      {previewDocId && (
        <DocumentPreviewModal docId={previewDocId} onClose={() => setPreviewDocId(null)}/>
      )}

      {previewCapa && (
        <CapaPreviewModal
          capaId={previewCapa.id}
          step={previewCapa.step}
          onClose={() => setPreviewCapa(null)}
          onApprove={(step) => { setPreviewCapa(null); setAction({ wfId: step.workflow_id, stepId: step.id, type: 'approve', kind: 'capa' }); setComment(''); }}
          onReject={(step) => { setPreviewCapa(null); setAction({ wfId: step.workflow_id, stepId: step.id, type: 'reject', kind: 'capa' }); setComment(''); }}
        />
      )}
    </div>
  );
}
