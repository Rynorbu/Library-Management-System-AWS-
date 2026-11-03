import { useEffect, useState } from 'react';
import { Search, UserX } from 'lucide-react';
import { useApi, useDebounced, Empty, Loading, ErrorState, Pagination } from '../../components/ui.jsx';
import { api, qs } from '../../lib/api.js';
import { useToast } from '../../context/ToastContext.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { fmtDate, initials } from '../../lib/format.js';

export default function Members() {
  const toast = useToast();
  const { user: me } = useAuth();
  const [text, setText] = useState('');
  const [role, setRole] = useState('');
  const [page, setPage] = useState(1);
  const q = useDebounced(text);
  const { data, loading, error, reload } = useApi(`/admin/users${qs({ q, role, page })}`);
  useEffect(() => setPage(1), [q, role]);

  const update = async (u, patch) => {
    try {
      await api(`/admin/users/${u.id}`, { method: 'PATCH', body: patch });
      toast.success(`Updated ${u.name}`);
      reload();
    } catch (err) {
      toast.error(err.message);
    }
  };

  return (
    <div className="page">
      <div className="container">
        <div className="page-head">
          <div>
            <div className="eyebrow">Librarian</div>
            <h1>Members</h1>
            <p>{data ? `${data.total} accounts` : ' '}</p>
          </div>
        </div>
        <div className="toolbar">
          <div className="input-icon" style={{ flex: '1 1 300px', maxWidth: 420 }}>
            <Search size={16} />
            <input className="input" placeholder="Name, email or student ID" value={text} onChange={(e) => setText(e.target.value)} />
          </div>
          <div className="segmented">
            {[
              ['', 'All'],
              ['student', 'Students'],
              ['staff', 'Staff'],
              ['librarian', 'Librarians'],
            ].map(([v, l]) => (
              <button key={v} className={role === v ? 'active' : ''} onClick={() => setRole(v)}>
                {l}
              </button>
            ))}
          </div>
        </div>
        <div className="card">
          {loading && !data ? (
            <Loading />
          ) : error ? (
            <ErrorState error={error} onRetry={reload} />
          ) : data.users.length === 0 ? (
            <Empty icon={UserX} title="No members found" />
          ) : (
            <div className="table-wrap" style={{ opacity: loading ? 0.6 : 1 }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>Member</th>
                    <th>ID / Department</th>
                    <th className="num">Loans</th>
                    <th className="num">Reservations</th>
                    <th>Joined</th>
                    <th>Role</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {data.users.map((u) => (
                    <tr key={u.id} style={{ opacity: u.is_active ? 1 : 0.55 }}>
                      <td>
                        <div className="row">
                          <span className="avatar">{initials(u.name)}</span>
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontWeight: 600 }}>{u.name}</div>
                            <div className="small muted">{u.email}</div>
                          </div>
                        </div>
                      </td>
                      <td>
                        <div className="mono">{u.student_id || '-'}</div>
                        <div className="small muted">{u.department || ''}</div>
                      </td>
                      <td className="num">
                        {u.active_loans}
                        {u.overdue > 0 && <span className="badge badge-red" style={{ marginLeft: 6 }}>{u.overdue} overdue</span>}
                      </td>
                      <td className="num">{u.active_reservations}</td>
                      <td className="muted">{fmtDate(u.created_at)}</td>
                      <td>
                        <select className="select" style={{ height: 34, width: 120 }} value={u.role} disabled={u.id === me.id} onChange={(e) => update(u, { role: e.target.value })} aria-label={`Role for ${u.name}`}>
                          <option value="student">Student</option>
                          <option value="staff">Staff</option>
                          <option value="librarian">Librarian</option>
                        </select>
                      </td>
                      <td>
                        <button className={`btn btn-sm ${u.is_active ? 'btn-outline' : 'btn-success'}`} disabled={u.id === me.id} onClick={() => update(u, { is_active: !u.is_active })}>
                          {u.is_active ? 'Deactivate' : 'Reactivate'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        {data && <Pagination page={data.page} pages={data.pages} onChange={setPage} />}
      </div>
    </div>
  );
}
