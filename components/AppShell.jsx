import React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import {
  LayoutDashboard, Files, GitBranch, AlertTriangle,
  Archive, Users, Download, Settings
} from 'lucide-react';
import { exportExcel } from '../api';
import toast from 'react-hot-toast';
import NotificationBell from './NotificationBell';

const nav = [
  { section: 'Main' },
  { to: '/',          icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/documents', icon: Files,           label: 'Documents' },
  { to: '/workflows', icon: GitBranch,       label: 'Approvals' },
  { to: '/capas',     icon: AlertTriangle,   label: 'NCR / CAPA' },
  { to: '/archive',   icon: Archive,         label: 'Archive' },
  { section: 'Admin' },
  { to: '/users',     icon: Users,           label: 'Users' },
  { to: '/settings',  icon: Settings,        label: 'Settings' },
];

// Simulated current user — in a real app this comes from auth
export const CURRENT_USER = { id: 1, name: 'Arjun Mehta', role: 'QA Manager' };

export default function AppShell({ children }) {
  const router = useRouter();

  function handleExcelExport() {
    toast.promise(exportExcel(), {
      loading: 'Generating Excel…',
      success: 'Excel downloaded!',
      error:   'Export failed',
    });
  }

  return (
    <div className="app-shell">
      {/* ── Sidebar ── */}
      <aside className="sidebar">
        <div className="sidebar-logo">
          <div className="sidebar-logo-name">QMS DocControl</div>
          <div className="sidebar-logo-sub">Document Management</div>
          <div className="sidebar-iso">
            <span className="iso-chip">ISO 9001</span>
            <span className="iso-chip">ISO 27001</span>
          </div>
        </div>

        <nav className="sidebar-nav">
          {nav.map((item, i) =>
            item.section ? (
              <div className="nav-section" key={i}>{item.section}</div>
            ) : (
              <Link
                key={item.to}
                href={item.to}
                className={`nav-link${
                  item.to === '/'
                    ? router.pathname === '/' ? ' active' : ''
                    : router.pathname.startsWith(item.to) ? ' active' : ''
                }`}
              >
                <item.icon size={16}/>
                {item.label}
              </Link>
            )
          )}

          <div className="nav-section" style={{ marginTop: '1rem' }}>Export</div>
          <button className="nav-link" style={{ width:'100%', border:'none', background:'none', cursor:'pointer', textAlign:'left' }} onClick={handleExcelExport}>
            <Download size={16}/> Export Excel
          </button>
        </nav>

        <div className="sidebar-user">
          <div className="user-chip" style={{ flex: 1 }}>
            <div className="user-avatar">
              {CURRENT_USER.name.split(' ').map(n => n[0]).join('')}
            </div>
            <div>
              <div className="user-name">{CURRENT_USER.name}</div>
              <div className="user-role">{CURRENT_USER.role}</div>
            </div>
          </div>
          <NotificationBell userId={CURRENT_USER.id}/>
        </div>
      </aside>

      {/* ── Main content ── */}
      <main className="main">
        {children}
      </main>
    </div>
  );
}
