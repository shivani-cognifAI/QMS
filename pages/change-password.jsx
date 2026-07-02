import React, { useState } from 'react';
import { useRouter } from 'next/router';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';
import { Lock, Eye, EyeOff, Shield, CheckCircle } from 'lucide-react';

export default function ChangePasswordPage() {
  const router = useRouter();
  const { user, login } = useAuth();
  const [form, setForm]       = useState({ newPassword: '', confirm: '' });
  const [show, setShow]       = useState({ new: false, confirm: false });
  const [error, setError]     = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (form.newPassword.length < 6) { setError('Password must be at least 6 characters'); return; }
    if (form.newPassword !== form.confirm) { setError('Passwords do not match'); return; }
    setLoading(true);
    try {
      const { data } = await axios.post('/api/auth/change-password', { newPassword: form.newPassword });
      login(data);
      router.push('/');
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to change password');
    } finally {
      setLoading(false);
    }
  }

  const rules = [
    { label: 'At least 6 characters', ok: form.newPassword.length >= 6 },
    { label: 'Passwords match',        ok: form.newPassword && form.newPassword === form.confirm },
  ];

  return (
    <div style={{ minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center', background:'var(--bg)', fontFamily:'var(--font)' }}>
      <div style={{ width:'100%', maxWidth:420, padding:'0 16px' }}>

        <div style={{ textAlign:'center', marginBottom:28 }}>
          <div style={{ display:'inline-flex', alignItems:'center', justifyContent:'center', width:48, height:48, borderRadius:12, background:'var(--amber-bg)', border:'1px solid #f0c060', marginBottom:12 }}>
            <Lock size={22} color="var(--amber)"/>
          </div>
          <div style={{ fontSize:20, fontWeight:600, letterSpacing:'-0.3px' }}>Set Your Password</div>
          <div style={{ fontSize:13, color:'var(--text-2)', marginTop:4 }}>
            {user?.name ? `Welcome, ${user.name}!` : 'Welcome!'} Please set a permanent password to continue.
          </div>
        </div>

        <div style={{ background:'var(--bg-card)', border:'1px solid var(--border)', borderRadius:'var(--radius-lg)', padding:'28px 28px 24px', boxShadow:'var(--shadow-md)' }}>
          <div style={{ background:'var(--amber-bg)', border:'1px solid #f0c060', borderRadius:'var(--radius-sm)', padding:'9px 13px', fontSize:12, color:'var(--amber)', marginBottom:20 }}>
            You logged in with a one-time password. Set a new password to secure your account.
          </div>

          <form onSubmit={handleSubmit}>
            <div style={{ marginBottom:16 }}>
              <label style={{ fontSize:12, fontWeight:600, display:'block', marginBottom:6, color:'var(--text-2)' }}>NEW PASSWORD</label>
              <div style={{ position:'relative' }}>
                <Lock size={14} style={{ position:'absolute', left:10, top:'50%', transform:'translateY(-50%)', color:'var(--text-3)', pointerEvents:'none' }}/>
                <input type={show.new ? 'text' : 'password'} required autoFocus
                  value={form.newPassword} onChange={e => setForm(p => ({ ...p, newPassword: e.target.value }))}
                  placeholder="Enter new password" style={{ width:'100%', paddingLeft:34, paddingRight:36 }}/>
                <button type="button" onClick={() => setShow(p => ({ ...p, new: !p.new }))}
                  style={{ position:'absolute', right:8, top:'50%', transform:'translateY(-50%)', background:'none', border:'none', cursor:'pointer', color:'var(--text-3)', display:'flex', padding:4 }}>
                  {show.new ? <EyeOff size={14}/> : <Eye size={14}/>}
                </button>
              </div>
            </div>

            <div style={{ marginBottom:16 }}>
              <label style={{ fontSize:12, fontWeight:600, display:'block', marginBottom:6, color:'var(--text-2)' }}>CONFIRM PASSWORD</label>
              <div style={{ position:'relative' }}>
                <Lock size={14} style={{ position:'absolute', left:10, top:'50%', transform:'translateY(-50%)', color:'var(--text-3)', pointerEvents:'none' }}/>
                <input type={show.confirm ? 'text' : 'password'} required
                  value={form.confirm} onChange={e => setForm(p => ({ ...p, confirm: e.target.value }))}
                  placeholder="Confirm new password" style={{ width:'100%', paddingLeft:34, paddingRight:36 }}/>
                <button type="button" onClick={() => setShow(p => ({ ...p, confirm: !p.confirm }))}
                  style={{ position:'absolute', right:8, top:'50%', transform:'translateY(-50%)', background:'none', border:'none', cursor:'pointer', color:'var(--text-3)', display:'flex', padding:4 }}>
                  {show.confirm ? <EyeOff size={14}/> : <Eye size={14}/>}
                </button>
              </div>
            </div>

            {/* Password rules */}
            <div style={{ marginBottom:20 }}>
              {rules.map(r => (
                <div key={r.label} style={{ display:'flex', alignItems:'center', gap:7, fontSize:12, color: r.ok ? 'var(--green)' : 'var(--text-3)', marginBottom:4 }}>
                  <CheckCircle size={13} style={{ opacity: r.ok ? 1 : 0.35 }}/>
                  {r.label}
                </div>
              ))}
            </div>

            {error && (
              <div style={{ background:'var(--red-bg)', color:'var(--red)', border:'1px solid #f5a0a0', borderRadius:'var(--radius-sm)', padding:'8px 12px', fontSize:13, marginBottom:16 }}>
                {error}
              </div>
            )}

            <button type="submit" className="btn btn-primary" style={{ width:'100%', justifyContent:'center', height:38 }}
              disabled={loading || !form.newPassword || !form.confirm}>
              {loading ? 'Saving…' : 'Set Password & Continue'}
            </button>
          </form>
        </div>

        <div style={{ textAlign:'center', marginTop:16, fontSize:11, color:'var(--text-3)' }}>
          QMS Document Control System
        </div>
      </div>
    </div>
  );
}
