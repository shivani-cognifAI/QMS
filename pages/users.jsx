import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Edit2, Trash2, Users, Shield, Eye, PenTool } from 'lucide-react';
import toast from 'react-hot-toast';
import { getUsers, createUser, updateUser, deleteUser, updateSystemRole } from '../api';
import { Spinner, EmptyState, Modal, ConfirmDialog, fmtDate } from '../components/UI';
import { useAuth } from '../context/AuthContext';

const ROLES = ['QA Manager','CISO','IT Manager','Risk Officer','MD / CEO','HR Manager','Procurement','Internal Auditor','Reviewer','Document Author'];
const SYSTEM_ROLES = ['admin', 'editor', 'viewer'];
const EMPTY = { name: '', email: '', role: 'Reviewer', system_role: 'viewer', password: '' };

const SYSTEM_ROLE_META = {
  admin:  { label:'Admin',  color:'var(--red)',    bg:'var(--red-bg)',    icon: Shield,  desc:'Full access — can create, edit, approve and delete everything' },
  editor: { label:'Editor', color:'var(--amber)',  bg:'var(--amber-bg)', icon: PenTool, desc:'Can edit documents they are granted access to, can submit for approval' },
  viewer: { label:'Viewer', color:'var(--text-2)', bg:'var(--bg-hover)', icon: Eye,     desc:'Read-only access — can view all documents but cannot edit' },
};

export default function UsersPage() {
  const qc = useQueryClient();
  const { user: currentUser } = useAuth();
  const isAdmin = currentUser?.system_role === 'admin';
  const [modal, setModal]       = useState(false);
  const [editItem, setEditItem] = useState(null);
  const [form, setForm]         = useState(EMPTY);
  const [delTarget, setDel]     = useState(null);

  const { data: users = [], isLoading } = useQuery({ queryKey:['users'], queryFn: getUsers });

  const saveMut = useMutation({
    mutationFn: data => editItem ? updateUser(editItem.id, data) : createUser(data),
    onSuccess: () => {
      qc.invalidateQueries(['users']);
      toast.success(editItem ? 'User updated' : 'User added');
      setModal(false);
    },
    onError: e => toast.error(e.response?.data?.error || 'Save failed'),
  });

  const delMut = useMutation({
    mutationFn: id => deleteUser(id),
    onSuccess: () => { qc.invalidateQueries(['users']); toast.success('User removed'); },
    onError:   e  => toast.error(e.response?.data?.error || 'Delete failed'),
  });

  const roleMut = useMutation({
    mutationFn: ({ userId, role }) => updateSystemRole(userId, role),
    onSuccess: () => { qc.invalidateQueries(['users']); toast.success('System role updated'); },
    onError:   e  => toast.error(e.response?.data?.error || 'Failed'),
  });

  function openNew()   { setEditItem(null); setForm(EMPTY); setModal(true); }
  function openEdit(u) { setEditItem(u); setForm({ name:u.name, email:u.email, role:u.role, system_role:u.system_role||'viewer', password:'' }); setModal(true); }
  function f(field)    { return e => setForm(p => ({ ...p, [field]: e.target.value })); }
  function initials(name) { return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0,2); }

  const admins  = users.filter(u => u.system_role === 'admin').length;
  const editors = users.filter(u => u.system_role === 'editor').length;
  const viewers = users.filter(u => (u.system_role||'viewer') === 'viewer').length;

  return (
    <div className="page">
      <div className="flex-between mb-16">
        <div>
          <div className="page-title">Users & Access</div>
          <div className="page-sub">Manage team members, approvers and system-wide roles</div>
        </div>
        {isAdmin && <button className="btn btn-primary" onClick={openNew}><Plus size={15}/> Add User</button>}
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:12, marginBottom:20 }}>
        {Object.entries(SYSTEM_ROLE_META).map(([key, meta]) => {
          const count = key==='admin' ? admins : key==='editor' ? editors : viewers;
          const Icon  = meta.icon;
          return (
            <div key={key} className="card" style={{ borderLeft:`3px solid ${meta.color}` }}>
              <div className="card-body" style={{ padding:'12px 14px', display:'flex', alignItems:'center', gap:12 }}>
                <Icon size={20} color={meta.color}/>
                <div style={{ flex:1 }}>
                  <div style={{ fontSize:12, fontWeight:600, color: meta.color }}>{meta.label}</div>
                  <div style={{ fontSize:11, color:'var(--text-2)', marginTop:1 }}>{meta.desc}</div>
                </div>
                <div style={{ fontSize:22, fontWeight:600 }}>{count}</div>
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ background:'var(--accent-bg)', border:'1px solid var(--accent-bdr)', borderRadius:'var(--radius-md)', padding:'10px 14px', fontSize:13, color:'var(--accent)', marginBottom:16 }}>
        System role controls what a user can do across the entire QMS. You can also grant per-document edit access from the shield icon on any document row.
      </div>

      {isLoading ? <Spinner/> : users.length === 0 ? (
        <EmptyState icon={Users} title="No users yet" sub="Add team members to assign them as approvers"/>
      ) : (
        <div className="card">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Name</th><th>Email</th><th>Department Role</th>
                  <th>System Role</th><th>Added</th><th></th>
                </tr>
              </thead>
              <tbody>
                {users.map(u => {
                  const sr   = u.system_role || 'viewer';
                  const meta = SYSTEM_ROLE_META[sr];
                  const Icon = meta.icon;
                  return (
                    <tr key={u.id}>
                      <td>
                        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                          <div style={{
                            width:32, height:32, borderRadius:'50%',
                            background: meta.bg, color: meta.color,
                            display:'flex', alignItems:'center', justifyContent:'center',
                            fontSize:11, fontWeight:700, flexShrink:0,
                          }}>
                            {initials(u.name)}
                          </div>
                          <span style={{ fontWeight:500 }}>{u.name}</span>
                        </div>
                      </td>
                      <td style={{ fontSize:13, color:'var(--text-2)' }}>{u.email}</td>
                      <td>
                        <span style={{ fontSize:11, fontWeight:600, padding:'2px 9px', borderRadius:20, background:'var(--bg-hover)', color:'var(--text-2)' }}>
                          {u.role}
                        </span>
                      </td>
                      <td>
                        <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                          <Icon size={13} color={meta.color}/>
                          <select
                            value={sr}
                            disabled={!isAdmin}
                            onChange={e => isAdmin && roleMut.mutate({ userId: u.id, role: e.target.value })}
                            style={{ fontSize:12, padding:'3px 8px', width:'auto',
                              background: meta.bg, color: meta.color,
                              border:`1px solid ${meta.color}40`, borderRadius:20, fontWeight:600,
                              cursor: isAdmin ? 'pointer' : 'default',
                            }}>
                            {SYSTEM_ROLES.map(r => (
                              <option key={r} value={r}>{SYSTEM_ROLE_META[r].label}</option>
                            ))}
                          </select>
                        </div>
                      </td>
                      <td style={{ fontSize:12, color:'var(--text-2)' }}>{fmtDate(u.created_at)}</td>
                      <td>
                        {isAdmin && (
                          <div style={{ display:'flex', gap:6 }}>
                            <button className="btn btn-ghost btn-icon btn-sm" onClick={() => openEdit(u)}><Edit2 size={14}/></button>
                            <button className="btn btn-ghost btn-icon btn-sm" style={{ color:'var(--red)' }} onClick={() => setDel(u)}><Trash2 size={14}/></button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Modal open={modal} onClose={() => setModal(false)} title={editItem ? `Edit — ${editItem.name}` : 'Add User'}>
        <div className="form-row">
          <label>Full Name</label>
          <input value={form.name} onChange={f('name')} placeholder="e.g. Arjun Mehta"/>
        </div>
        <div className="form-row">
          <label>Email Address</label>
          <input type="email" value={form.email} onChange={f('email')} placeholder="arjun@company.com" disabled={!!editItem}/>
          {editItem && <div className="input-hint">Email cannot be changed after creation</div>}
        </div>
        <div className="form-row">
          <label>Department Role</label>
          <select value={form.role} onChange={f('role')}>
            {ROLES.map(r => <option key={r}>{r}</option>)}
          </select>
        </div>
        <div className="form-row">
          <label>System Role</label>
          <select value={form.system_role} onChange={f('system_role')}>
            {SYSTEM_ROLES.map(r => <option key={r} value={r}>{SYSTEM_ROLE_META[r].label} — {SYSTEM_ROLE_META[r].desc}</option>)}
          </select>
          <div className="input-hint">{SYSTEM_ROLE_META[form.system_role]?.desc}</div>
        </div>
        <div className="form-row">
          <label>{editItem ? 'New Password' : 'Password'}</label>
          <input type="password" value={form.password} onChange={f('password')}
            placeholder={editItem ? 'Leave blank to keep current password' : 'Set login password'}
            autoComplete="new-password"/>
          {!editItem && <div className="input-hint">Required — user will use this to log in</div>}
        </div>
        <div className="modal-footer">
          <button className="btn" onClick={() => setModal(false)}>Cancel</button>
          <button className="btn btn-primary" onClick={() => saveMut.mutate(form)}
            disabled={saveMut.isPending || !form.name || !form.email || (!editItem && !form.password)}>
            {saveMut.isPending ? 'Saving…' : editItem ? 'Update User' : 'Add User'}
          </button>
        </div>
      </Modal>

      <ConfirmDialog open={!!delTarget} onClose={() => setDel(null)} danger
        title="Remove User"
        message={`Remove "${delTarget?.name}"? They will no longer be available as an approver.`}
        onConfirm={() => delMut.mutate(delTarget.id)}/>
    </div>
  );
}
