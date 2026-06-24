import React, { useState } from 'react';
import { X, AlertTriangle } from 'lucide-react';

// ── Status / type helpers ──────────────────────────────────────────────────
export function statusPill(status) {
  const map = {
    Approved:      'pill-green',
    Draft:         'pill-amber',
    'Under Review':'pill-blue',
    Retired:       'pill-gray',
    Rejected:      'pill-red',
  };
  return <span className={`pill ${map[status] || 'pill-gray'}`}>{status}</span>;
}

export function standardPill(standard) {
  if (standard === 'ISO 9001')  return <span className="pill pill-blue">ISO 9001</span>;
  if (standard === 'ISO 27001') return <span className="pill pill-green">ISO 27001</span>;
  return <span className="pill pill-purple">Both</span>;
}

export function typePill(type) {
  return <span className="pill pill-gray" style={{ fontSize: 10 }}>{type}</span>;
}

export function capaStatusPill(status) {
  const map = { 'In Progress':'pill-red', 'Waiting for Approval':'pill-amber', 'Approved & Closed':'pill-green', Overdue:'pill-amber' };
  return <span className={`pill ${map[status] || 'pill-gray'}`}>{status}</span>;
}

export function approvalStatusPill(status) {
  const map = {
    'Not Submitted': 'pill-gray',
    'Under Review':  'pill-blue',
    'Approved':       'pill-green',
    'Rejected':       'pill-red',
  };
  return <span className={`pill ${map[status] || 'pill-gray'}`}>{status || 'Not Submitted'}</span>;
}

export function reviewPill(dateStr) {
  if (!dateStr) return <span className="pill pill-gray">—</span>;
  const days = Math.round((new Date(dateStr) - new Date()) / 86400000);
  if (days < 0)   return <span className="pill pill-red">Overdue {Math.abs(days)}d</span>;
  if (days <= 30) return <span className="pill pill-amber">{fmtDate(dateStr)}</span>;
  return <span className="pill pill-gray">{fmtDate(dateStr)}</span>;
}

export function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function fmtDateTime(d) {
  if (!d) return '—';
  return new Date(d.replace(' ', 'T')).toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
  });
}

// ── Spinner ────────────────────────────────────────────────────────────────
export function Spinner({ size = 20 }) {
  return (
    <div style={{ display:'flex', justifyContent:'center', padding:'2rem' }}>
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
        style={{ animation:'spin 0.8s linear infinite' }}>
        <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
        <circle cx="12" cy="12" r="10" stroke="var(--border-md)" strokeWidth="3"/>
        <path d="M12 2a10 10 0 0 1 10 10" stroke="var(--accent)" strokeWidth="3" strokeLinecap="round"/>
      </svg>
    </div>
  );
}

// ── Empty State ────────────────────────────────────────────────────────────
export function EmptyState({ icon: Icon, title, sub }) {
  return (
    <div className="empty-state">
      {Icon && <Icon size={36} style={{ margin:'0 auto 10px', display:'block', opacity:.3 }}/>}
      <div style={{ fontWeight:500, marginBottom:4 }}>{title}</div>
      {sub && <div className="text-sm text-2">{sub}</div>}
    </div>
  );
}

// ── Modal ──────────────────────────────────────────────────────────────────
export function Modal({ open, onClose, title, children, size = '' }) {
  if (!open) return null;
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className={`modal ${size}`} onClick={e => e.stopPropagation()}>
        <div className="flex-between mb-12">
          <div className="modal-title" style={{ margin:0 }}>{title}</div>
          <button className="btn btn-ghost btn-icon" onClick={onClose}><X size={16}/></button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ── Confirm Dialog ─────────────────────────────────────────────────────────
export function ConfirmDialog({ open, onClose, onConfirm, title, message, danger }) {
  if (!open) return null;
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth:420 }} onClick={e => e.stopPropagation()}>
        <div className="flex-center gap-8 mb-12">
          <AlertTriangle size={20} color={danger ? 'var(--red)' : 'var(--amber)'}/>
          <div style={{ fontWeight:600, fontSize:15 }}>{title}</div>
        </div>
        <p className="text-sm text-2" style={{ marginBottom:'1.25rem' }}>{message}</p>
        <div className="modal-footer" style={{ marginTop:0, paddingTop:0, border:'none' }}>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className={`btn ${danger ? 'btn-red' : 'btn-primary'}`} onClick={() => { onConfirm(); onClose(); }}>
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Section Label ──────────────────────────────────────────────────────────
export function SectionHead({ children }) {
  return <div className="section-head">{children}</div>;
}

// ── Progress Bar ───────────────────────────────────────────────────────────
export function ProgressBar({ pct, amber }) {
  return (
    <div className="progress-wrap" style={{ marginTop:8 }}>
      <div className={`progress-bar ${amber ? 'amber' : ''}`} style={{ width:`${pct}%` }}/>
    </div>
  );
}

// ── Workflow Stepper ───────────────────────────────────────────────────────
export function WorkflowStepper({ steps }) {
  if (!steps || !steps.length) return null;
  return (
    <div className="stepper">
      {steps.map((step, i) => {
        const isLast = i === steps.length - 1;
        const dotClass = {
          Approved: 'approved', Awaiting: 'awaiting',
          Rejected: 'rejected', Skipped:  'skipped', Pending: ''
        }[step.status] || '';
        const symbol = { Approved:'✓', Rejected:'✕', Skipped:'—', Awaiting:step.step_order, Pending:step.step_order };
        return (
          <div className="step-item" key={step.id}>
            <div className="step-line-wrap">
              <div className={`step-dot ${dotClass}`}>{symbol[step.status]}</div>
              {!isLast && <div className={`step-connector ${step.status==='Approved'?'done':''}`}/>}
            </div>
            <div className="step-body">
              <div className="step-name">{step.approver_name}</div>
              <div className="step-meta">{step.status}{step.acted_at ? ` · ${fmtDateTime(step.acted_at)}` : ''}</div>
              {step.comment && <div className="step-comment">"{step.comment}"</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
