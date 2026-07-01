import React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import {
  LayoutDashboard, Files, GitBranch, AlertTriangle,
  Archive, Users, Download, Settings, LogOut,
} from 'lucide-react';
import { exportExcel } from '../api';
import toast from 'react-hot-toast';
import NotificationBell from './NotificationBell';
import { useAuth } from '../context/AuthContext';

const ALL_NAV = [
  { section: 'Main' },
  { to: '/',          icon: LayoutDashboard, label: 'Dashboard',  roles: null },
  { to: '/documents', icon: Files,           label: 'Documents',  roles: null },
  { to: '/workflows', icon: GitBranch,       label: 'Approvals',  roles: null },
  { to: '/capas',     icon: AlertTriangle,   label: 'NCR / CAPA', roles: null },
  { to: '/archive',   icon: Archive,         label: 'Archive',    roles: null },
  { section: 'Admin', roles: ['admin'] },
  { to: '/users',     icon: Users,           label: 'Users',      roles: ['admin'] },
  { to: '/settings',  icon: Settings,        label: 'Settings',   roles: ['admin'] },
];

function canSee(item, systemRole) {
  if (!item.roles) return true;
  return item.roles.includes(systemRole);
}

export default function AppShell({ children }) {
  const router = useRouter();
  const { user, logout } = useAuth();
  const systemRole = user?.system_role || 'viewer';

  async function handleExcelExport() {
    toast.promise(exportExcel(), {
      loading: 'Generating Excel…',
      success: 'Excel downloaded!',
      error:   'Export failed',
    });
  }

  async function handleLogout() {
    await logout();
    router.push('/login');
  }

  const initials = user ? user.name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2) : '?';

  return (
    <div className="app-shell">
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
          {ALL_NAV.map((item, i) => {
            if (item.section) {
              if (!canSee(item, systemRole)) return null;
              return <div className="nav-section" key={i}>{item.section}</div>;
            }
            if (!canSee(item, systemRole)) return null;
            return (
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
            );
          })}

          <div className="nav-section" style={{ marginTop: '1rem' }}>Export</div>
          <button className="nav-link" style={{ width:'100%', border:'none', background:'none', cursor:'pointer', textAlign:'left' }} onClick={handleExcelExport}>
            <Download size={16}/> Export Excel
          </button>
        </nav>

        <div className="sidebar-user">
          <div className="user-chip" style={{ flex: 1, minWidth: 0 }}>
            <div className="user-avatar">{initials}</div>
            <div style={{ minWidth: 0 }}>
              <div className="user-name" style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{user?.name}</div>
              <div className="user-role">{user?.role}</div>
            </div>
          </div>
          {user && <NotificationBell userId={user.id}/>}
          <button
            onClick={handleLogout}
            title="Sign out"
            style={{ background:'none', border:'none', cursor:'pointer', color:'var(--text-3)', display:'flex', padding:4, flexShrink:0 }}
          >
            <LogOut size={15}/>
          </button>
        </div>
      </aside>

      <main className="main">
        {children}
      </main>
    </div>
  );
}
