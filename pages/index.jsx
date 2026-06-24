import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { getStats, getDocuments, getCapas } from '../api';
import { Spinner, statusPill, standardPill, fmtDate, reviewPill } from '../components/UI';
import { FileCheck, AlertTriangle, Clock, CheckCircle, Shield, ShieldCheck } from 'lucide-react';

const ISO9001_CLAUSES  = [
  { c:'4', l:'Context of the organisation' },
  { c:'5', l:'Leadership' },
  { c:'6', l:'Planning' },
  { c:'7', l:'Support' },
  { c:'8', l:'Operation' },
  { c:'9', l:'Performance evaluation' },
  { c:'10', l:'Improvement' },
];
const ISO27001_CLAUSES = [
  { c:'A.5', l:'Organisational controls' },
  { c:'A.6', l:'People controls' },
  { c:'A.7', l:'Physical controls' },
  { c:'A.8', l:'Technological controls' },
];

function ClauseBar({ docs, prefix, standard }) {
  const all = docs.filter(d =>
    (d.standard === standard || d.standard === 'Both') && d.clause && d.clause.startsWith(prefix)
  );
  const approved = all.filter(d => d.status === 'Approved');
  const pct = all.length ? Math.round(approved.length / all.length * 100) : 0;
  const color = pct === 0 ? '#D3D1C7' : pct === 100 ? '#97C459' : '#FAC775';
  const tc    = pct === 0 ? '#888780' : pct === 100 ? '#27500A' : '#633806';
  return (
    <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:8 }}>
      <span style={{ fontSize:12, color:'var(--text-2)', width:200, flexShrink:0 }}>{prefix} · {ISO9001_CLAUSES.concat(ISO27001_CLAUSES).find(x=>x.c===prefix)?.l}</span>
      <div style={{ flex:1, background:'var(--bg-hover)', borderRadius:3, height:16, overflow:'hidden' }}>
        <div style={{ width:`${Math.max(pct,2)}%`, height:'100%', background:color, display:'flex', alignItems:'center', padding:'0 6px' }}>
          {pct > 12 && <span style={{ fontSize:10, fontWeight:600, color:tc }}>{pct}%</span>}
        </div>
      </div>
      <span style={{ fontSize:11, color:'var(--text-2)', width:55, textAlign:'right' }}>{approved.length}/{all.length}</span>
    </div>
  );
}

export default function Dashboard() {
  const { data: stats, isLoading: loadingStats } = useQuery({ queryKey:['stats'], queryFn: getStats });
  const { data: docs  = [] } = useQuery({ queryKey:['documents'], queryFn: () => getDocuments() });
  const { data: capas = [] } = useQuery({ queryKey:['capas'],     queryFn: () => getCapas() });

  if (loadingStats) return <div className="page"><Spinner/></div>;
  if (!stats) return <div className="page" style={{padding:40,color:'var(--text-2)'}}>Failed to load dashboard data. Check server logs.</div>;

  const today = new Date();
  const overdue  = docs.filter(d => d.review_date && new Date(d.review_date) < today);
  const due30    = docs.filter(d => {
    if (!d.review_date) return false;
    const diff = Math.round((new Date(d.review_date) - today) / 86400000);
    return diff >= 0 && diff <= 30;
  });
  const openCapas = capas.filter(c => c.status === 'In Progress' || c.status === 'Waiting for Approval');

  return (
    <div className="page">
      <div className="flex-between mb-16">
        <div>
          <div className="page-title">Dashboard</div>
          <div className="page-sub">QMS overview — ISO 9001 & ISO 27001</div>
        </div>
        <span style={{ fontSize:12, color:'var(--text-2)' }}>{new Date().toLocaleDateString('en-IN',{weekday:'long',day:'2-digit',month:'long',year:'numeric'})}</span>
      </div>

      {/* Stats */}
      <div className="stats-grid">
        {[
          { label:'Total Documents',   value: stats.totalDocs,     sub: `${stats.approvalRate}% approved`,  icon: FileCheck,   color:'var(--accent)' },
          { label:'Approved',          value: stats.approved,      sub: 'Active controlled docs',            icon: CheckCircle, color:'var(--green)' },
          { label:'Pending Approval',  value: stats.draft,         sub: 'Draft or under review',             icon: Clock,       color:'var(--amber)' },
          { label:'Reviews Overdue',   value: stats.overdue,       sub: overdue.length ? 'action needed':'on track', icon: AlertTriangle, color: stats.overdue ? 'var(--red)':'var(--green)' },
          { label:'Open NCR / CAPA',   value: stats.openCapas,     sub: `${stats.closedCapas} closed`,       icon: AlertTriangle, color: stats.openCapas ? 'var(--red)':'var(--green)' },
          { label:'ISO 9001 Docs',     value: stats.iso9001,       sub: 'Applicable documents',              icon: Shield,      color:'var(--accent)' },
          { label:'ISO 27001 Docs',    value: stats.iso27001,      sub: 'Applicable documents',              icon: ShieldCheck, color:'var(--green)' },
          { label:'Due in 30 days',    value: stats.dueSoon,       sub: 'Upcoming reviews',                  icon: Clock,       color:'var(--amber)' },
        ].map(({ label, value, sub, icon: Icon, color }) => (
          <div className="stat-card" key={label}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
              <div className="stat-label">{label}</div>
              <Icon size={16} color={color}/>
            </div>
            <div className="stat-value">{value}</div>
            <div className="stat-sub" style={{ color }}>{sub}</div>
          </div>
        ))}
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16, marginBottom:16 }}>
        {/* Overdue reviews */}
        <div className="card">
          <div className="card-head">
            <div style={{ fontWeight:500, fontSize:14 }}>Overdue Reviews</div>
            <span className="pill pill-red">{overdue.length}</span>
          </div>
          <div className="card-body" style={{ padding:0 }}>
            {overdue.length === 0 ? (
              <div style={{ padding:'1.25rem', color:'var(--text-2)', fontSize:13 }}>No overdue reviews</div>
            ) : overdue.slice(0,5).map(d => (
              <div key={d.id} style={{ padding:'10px 1.25rem', borderBottom:'1px solid var(--border)', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                <div>
                  <div style={{ fontSize:13, fontWeight:500 }}>{d.title}</div>
                  <div style={{ fontSize:11, color:'var(--text-2)' }}>{d.id} · {d.owner}</div>
                </div>
                {reviewPill(d.review_date)}
              </div>
            ))}
          </div>
        </div>

        {/* Open CAPAs */}
        <div className="card">
          <div className="card-head">
            <div style={{ fontWeight:500, fontSize:14 }}>Open NCR / CAPA</div>
            <span className="pill pill-red">{openCapas.length}</span>
          </div>
          <div className="card-body" style={{ padding:0 }}>
            {openCapas.length === 0 ? (
              <div style={{ padding:'1.25rem', color:'var(--text-2)', fontSize:13 }}>No open items</div>
            ) : openCapas.slice(0,5).map(c => (
              <div key={c.id} style={{ padding:'10px 1.25rem', borderBottom:'1px solid var(--border)', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                <div>
                  <div style={{ fontSize:13, fontWeight:500 }}>{c.title}</div>
                  <div style={{ fontSize:11, color:'var(--text-2)' }}>{c.id} · Due {fmtDate(c.due_date)}</div>
                </div>
                <div style={{ fontSize:12, background:'var(--bg-hover)', borderRadius:20, padding:'2px 8px', color:'var(--text-2)' }}>{c.pct_complete}%</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Compliance Matrix */}
      <div className="card">
        <div className="card-head"><div style={{ fontWeight:500, fontSize:14 }}>Compliance Matrix</div></div>
        <div className="card-body">
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:24 }}>
            <div>
              <div className="section-head" style={{ marginBottom:12 }}>ISO 9001 Clause Coverage</div>
              {ISO9001_CLAUSES.map(c => <ClauseBar key={c.c} docs={docs} prefix={c.c} standard="ISO 9001"/>)}
            </div>
            <div>
              <div className="section-head" style={{ marginBottom:12 }}>ISO 27001 Annex A Coverage</div>
              {ISO27001_CLAUSES.map(c => <ClauseBar key={c.c} docs={docs} prefix={c.c} standard="ISO 27001"/>)}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
