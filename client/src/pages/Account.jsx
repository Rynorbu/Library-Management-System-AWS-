import { useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { api } from '../lib/api.js';
import { initials, roleLabel, fmtDate } from '../lib/format.js';

export default function Account() {
  const { user, setUser } = useAuth();
  const toast = useToast();
  const [profile, setProfile] = useState({ name: user.name, studentId: user.studentId || '', department: user.department || '' });
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [busy, setBusy] = useState('');

  const saveProfile = async (e) => {
    e.preventDefault();
    setBusy('profile');
    try {
      const r = await api('/auth/me', { method: 'PUT', body: profile });
      setUser(r.user);
      toast.success('Profile updated');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy('');
    }
  };

  const savePw = async (e) => {
    e.preventDefault();
    if (pw.newPassword !== pw.confirm) return toast.error('New passwords do not match');
    setBusy('pw');
    try {
      await api('/auth/me', { method: 'PUT', body: { currentPassword: pw.currentPassword, newPassword: pw.newPassword } });
      setPw({ currentPassword: '', newPassword: '', confirm: '' });
      toast.success('Password changed');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="page">
      <div className="container" style={{ maxWidth: 820 }}>
        <div className="page-head">
          <div>
            <div className="eyebrow">Account</div>
            <h1>Account settings</h1>
          </div>
        </div>

        <div className="card card-pad row" style={{ gap: 16, marginBottom: 20 }}>
          <span className="avatar" style={{ width: 56, height: 56, fontSize: '1.1rem' }}>
            {initials(user.name)}
          </span>
          <div>
            <h2>{user.name}</h2>
            <div className="muted small">
              {user.email} · {roleLabel[user.role]} · member since {fmtDate(user.createdAt)}
            </div>
          </div>
        </div>

        <form className="card" onSubmit={saveProfile} style={{ marginBottom: 20 }}>
          <div className="card-head">
            <h2>Profile</h2>
          </div>
          <div className="card-body form-grid">
            <div className="field full">
              <label>Full name</label>
              <input className="input" value={profile.name} onChange={(e) => setProfile({ ...profile, name: e.target.value })} required minLength={2} />
            </div>
            <div className="field">
              <label>{user.role === 'student' ? 'Student ID' : 'Employee ID'}</label>
              <input className="input" value={profile.studentId} onChange={(e) => setProfile({ ...profile, studentId: e.target.value })} />
            </div>
            <div className="field">
              <label>Department</label>
              <input className="input" value={profile.department} onChange={(e) => setProfile({ ...profile, department: e.target.value })} />
            </div>
          </div>
          <div className="modal-foot" style={{ position: 'static', borderRadius: '0 0 12px 12px' }}>
            <button className="btn btn-primary" disabled={busy === 'profile'}>
              {busy === 'profile' && <span className="spinner" />} Save profile
            </button>
          </div>
        </form>

        <form className="card" onSubmit={savePw}>
          <div className="card-head">
            <h2>Change password</h2>
          </div>
          <div className="card-body form-grid">
            <div className="field full">
              <label>Current password</label>
              <input className="input" type="password" required value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} autoComplete="current-password" />
            </div>
            <div className="field">
              <label>New password</label>
              <input className="input" type="password" required minLength={8} value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} autoComplete="new-password" />
            </div>
            <div className="field">
              <label>Confirm new password</label>
              <input className="input" type="password" required minLength={8} value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} autoComplete="new-password" />
            </div>
          </div>
          <div className="modal-foot" style={{ position: 'static', borderRadius: '0 0 12px 12px' }}>
            <button className="btn btn-primary" disabled={busy === 'pw'}>
              {busy === 'pw' && <span className="spinner" />} Update password
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
