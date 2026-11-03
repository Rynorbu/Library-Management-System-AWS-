import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Search, PackageCheck, Hourglass, BookOpen, AlertTriangle, History, LogOut as CheckOutIcon, Undo2, XCircle, Plus, Check, Inbox } from 'lucide-react';
import { useApi, useDebounced, BookCover, StatusBadge, Empty, Loading, ErrorState, ConfirmDialog, Modal, loanStatus } from '../../components/ui.jsx';
import { api, qs } from '../../lib/api.js';
import { useToast } from '../../context/ToastContext.jsx';
import { fmtDate, fmtDateTime, countdown, daysUntil } from '../../lib/format.js';

const TABS = [
  ['pickups', 'Ready for pickup', PackageCheck],
  ['loans', 'Active loans', BookOpen],
  ['overdue', 'Overdue', AlertTriangle],
  ['waitlists', 'Waitlists', Hourglass],
  ['returned', 'Recently returned', History],
];

const Who = ({ r }) => (
  <div>
    <div style={{ fontWeight: 600 }}>{r.user_name}</div>
    <div className="small muted">
      {r.user_email}
      {r.student_id && ` · ${r.student_id}`}
    </div>
  </div>
);

const BookCell = ({ r }) => (
  <Link to={`/books/${r.book_id}`} className="row" style={{ color: 'var(--ink)', minWidth: 220 }}>
    <BookCover book={r} size="sm" />
    <span style={{ minWidth: 0 }}>
      <strong className="clamp-2">{r.title}</strong>
      <div className="small muted">{r.shelf_location || r.author}</div>
    </span>
  </Link>
);

function Pick({ label, selected, onClear, children }) {
  return selected ? (
    <div className="dropzone">
      <Check size={18} color="var(--green-600)" />
      <div style={{ flex: 1, minWidth: 0 }}>{label}</div>
      <button className="btn btn-ghost btn-sm" onClick={onClear}>
        Change
      </button>
    </div>
  ) : (
    children
  );
}

function WalkInModal({ onClose, onDone }) {
  const toast = useToast();
  const [uq, setUq] = useState('');
  const [bq, setBq] = useState('');
  const [user, setUser] = useState(null);
  const [book, setBook] = useState(null);
  const [busy, setBusy] = useState(false);
  const du = useDebounced(uq);
  const db = useDebounced(bq);
  const users = useApi(du.length >= 2 && !user ? `/admin/users${qs({ q: du, limit: 6 })}` : null);
  const books = useApi(db.length >= 2 && !book ? `/books${qs({ q: db, limit: 6 })}` : null);

  const submit = async () => {
    setBusy(true);
    try {
      const r = await api('/loans/checkout', { method: 'POST', body: { userId: user.id, bookId: book.id } });
      toast.success(r.message);
      onDone();
      onClose();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Walk-in checkout"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-outline" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-success" disabled={!user || !book || busy} onClick={submit}>
            {busy ? <span className="spinner" /> : <CheckOutIcon size={16} />} Check out
          </button>
        </>
      }
    >
      <div className="stack">
        <p className="small muted">Lend a book directly at the desk. If the member already has a hold on this title, it will be used.</p>
        <div className="field">
          <label>1. Member</label>
          <Pick
            selected={user}
            onClear={() => setUser(null)}
            label={
              user && (
                <>
                  <strong>{user.name}</strong>
                  <div className="small muted">
                    {user.email} {user.student_id && `· ${user.student_id}`}
                  </div>
                </>
              )
            }
          >
            <div className="input-icon">
              <Search size={16} />
              <input className="input" autoFocus placeholder="Name, email or student ID" value={uq} onChange={(e) => setUq(e.target.value)} />
            </div>
            {users.data?.users.length > 0 && (
              <div className="card" style={{ marginTop: 6 }}>
                {users.data.users.map((u) => (
                  <button key={u.id} className="list-item btn-ghost" style={{ width: '100%', border: 0, background: 'none', cursor: 'pointer', textAlign: 'left' }} onClick={() => setUser(u)}>
                    <div className="main">
                      <div className="title">{u.name}</div>
                      <div className="small muted">
                        {u.email} {u.student_id && `· ${u.student_id}`}
                      </div>
                    </div>
                    <span className="small muted">{u.active_loans} on loan</span>
                  </button>
                ))}
              </div>
            )}
            {users.data?.users.length === 0 && <p className="small muted">No members match "{du}".</p>}
          </Pick>
        </div>
        <div className="field">
          <label>2. Book</label>
          <Pick
            selected={book}
            onClear={() => setBook(null)}
            label={
              book && (
                <>
                  <strong>{book.title}</strong>
                  <div className="small muted">
                    {book.available_copies} of {book.total_copies} available
                  </div>
                </>
              )
            }
          >
            <div className="input-icon">
              <Search size={16} />
              <input className="input" placeholder="Title, author or ISBN" value={bq} onChange={(e) => setBq(e.target.value)} />
            </div>
            {books.data?.books.length > 0 && (
              <div className="card" style={{ marginTop: 6 }}>
                {books.data.books.map((b) => (
                  <button key={b.id} className="list-item" style={{ width: '100%', border: 0, background: 'none', cursor: 'pointer', textAlign: 'left' }} onClick={() => setBook(b)}>
                    <BookCover book={b} size="sm" />
                    <div className="main">
                      <div className="title truncate">{b.title}</div>
                      <div className="small muted truncate">{b.author}</div>
                    </div>
                    <span className={`badge ${b.available_copies ? 'badge-green' : 'badge-amber'}`}>{b.available_copies} free</span>
                  </button>
                ))}
              </div>
            )}
          </Pick>
        </div>
      </div>
    </Modal>
  );
}

export default function Circulation() {
  const toast = useToast();
  const [tab, setTab] = useState('pickups');
  const [text, setText] = useState('');
  const q = useDebounced(text);
  const [confirm, setConfirm] = useState(null);
  const [walkIn, setWalkIn] = useState(false);
  const [busyId, setBusyId] = useState(null);

  const counts = useApi('/admin/stats');
  const path =
    tab === 'pickups'
      ? `/reservations${qs({ status: 'reserved', q })}`
      : tab === 'waitlists'
        ? `/reservations${qs({ status: 'waitlisted', q })}`
        : `/loans${qs({ status: tab === 'loans' ? 'active' : tab, q })}`;
  const { data, loading, error, reload } = useApi(path);
  const rows = data?.reservations || data?.loans || [];

  const refreshAll = () => {
    reload();
    counts.reload();
  };

  const checkout = async (r) => {
    setBusyId(`c${r.id}`);
    try {
      const res = await api('/loans/checkout', { method: 'POST', body: { reservationId: r.id } });
      toast.success(res.message);
      refreshAll();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusyId(null);
    }
  };

  const checkin = async (l) => {
    setBusyId(`r${l.id}`);
    try {
      const res = await api(`/loans/${l.id}/return`, { method: 'POST' });
      toast.success(res.message);
      refreshAll();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusyId(null);
    }
  };

  const cancelRes = async () => {
    try {
      await api(`/reservations/${confirm.id}`, { method: 'DELETE' });
      toast.success('Reservation cancelled and the member has been notified');
      refreshAll();
    } catch (err) {
      toast.error(err.message);
      throw err;
    }
  };

  const t = counts.data?.totals;
  const tabCount = { pickups: t?.ready_for_pickup, waitlists: t?.waitlisted, loans: t?.active_loans, overdue: t?.overdue };

  return (
    <div className="page">
      <div className="container">
        <div className="page-head">
          <div>
            <div className="eyebrow">Librarian</div>
            <h1>Circulation desk</h1>
            <p>Hand out held books, check returns in, and manage the queues.</p>
          </div>
          <span className="spacer" />
          <button className="btn btn-accent" onClick={() => setWalkIn(true)}>
            <Plus size={17} /> Walk-in checkout
          </button>
        </div>

        <div className="tabs">
          {TABS.map(([key, label, Icon]) => (
            <button key={key} className={tab === key ? 'active' : ''} onClick={() => setTab(key)}>
              <Icon size={16} /> {label}
              {tabCount[key] !== undefined && <span className="count">{tabCount[key]}</span>}
            </button>
          ))}
        </div>

        <div className="toolbar">
          <div className="input-icon" style={{ flex: '1 1 300px', maxWidth: 460 }}>
            <Search size={16} />
            <input className="input" placeholder="Search member name, email, student ID, title or ISBN" value={text} onChange={(e) => setText(e.target.value)} />
          </div>
        </div>

        <div className="card">
          {loading && !data ? (
            <Loading />
          ) : error ? (
            <ErrorState error={error} onRetry={reload} />
          ) : rows.length === 0 ? (
            <Empty
              icon={Inbox}
              title={q ? 'No matches' : 'All clear'}
              text={
                q
                  ? 'Nothing matches your search on this tab.'
                  : {
                      pickups: 'No books are waiting to be collected.',
                      waitlists: 'Nobody is on a waitlist right now.',
                      loans: 'No books are currently on loan.',
                      overdue: 'No overdue loans. 🎉',
                      returned: 'No returns yet.',
                    }[tab]
              }
            />
          ) : (
            <div className="table-wrap" style={{ opacity: loading ? 0.6 : 1 }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>Book</th>
                    <th>Member</th>
                    {tab === 'pickups' && <th>Pickup deadline</th>}
                    {tab === 'waitlists' && <th>Position</th>}
                    {tab === 'waitlists' && <th>Joined</th>}
                    {['loans', 'overdue'].includes(tab) && <th>Borrowed</th>}
                    {['loans', 'overdue'].includes(tab) && <th>Due</th>}
                    {tab === 'returned' && <th>Returned</th>}
                    {tab === 'returned' && <th>Status</th>}
                    {tab !== 'returned' && <th style={{ textAlign: 'right' }}>Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id}>
                      <td>
                        <BookCell r={r} />
                      </td>
                      <td>
                        <Who r={r} />
                      </td>
                      {tab === 'pickups' && (
                        <td>
                          <div>{fmtDateTime(r.pickup_deadline)}</div>
                          <div className="small" style={{ color: daysUntil(r.pickup_deadline) <= 1 ? 'var(--saffron-600)' : 'var(--ink-3)' }}>
                            {countdown(r.pickup_deadline)}
                          </div>
                        </td>
                      )}
                      {tab === 'waitlists' && (
                        <td>
                          <StatusBadge status="waitlisted">#{r.position}</StatusBadge>
                        </td>
                      )}
                      {tab === 'waitlists' && <td className="muted">{fmtDate(r.created_at)}</td>}
                      {['loans', 'overdue'].includes(tab) && <td className="muted">{fmtDate(r.checked_out_at)}</td>}
                      {['loans', 'overdue'].includes(tab) && (
                        <td>
                          <div>{fmtDate(r.due_at)}</div>
                          <StatusBadge status={loanStatus(r)}>{loanStatus(r) === 'overdue' ? `${Math.max(1, -daysUntil(r.due_at))}d overdue` : `${daysUntil(r.due_at)}d left`}</StatusBadge>
                        </td>
                      )}
                      {tab === 'returned' && <td className="muted">{fmtDateTime(r.returned_at)}</td>}
                      {tab === 'returned' && (
                        <td>{new Date(r.returned_at) > new Date(r.due_at) ? <StatusBadge status="overdue">Returned late</StatusBadge> : <StatusBadge status="sent">On time</StatusBadge>}</td>
                      )}
                      {tab !== 'returned' && (
                        <td>
                          <div className="row" style={{ justifyContent: 'flex-end' }}>
                            {tab === 'pickups' && (
                              <button className="btn btn-success btn-sm" disabled={busyId === `c${r.id}`} onClick={() => checkout(r)}>
                                {busyId === `c${r.id}` ? <span className="spinner" /> : <CheckOutIcon size={14} />} Check out
                              </button>
                            )}
                            {['loans', 'overdue'].includes(tab) && (
                              <button className="btn btn-primary btn-sm" disabled={busyId === `r${r.id}`} onClick={() => checkin(r)}>
                                {busyId === `r${r.id}` ? <span className="spinner" /> : <Undo2 size={14} />} Check in
                              </button>
                            )}
                            {['pickups', 'waitlists'].includes(tab) && (
                              <button className="btn btn-ghost btn-sm" onClick={() => setConfirm(r)} title="Cancel reservation">
                                <XCircle size={15} />
                              </button>
                            )}
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {walkIn && <WalkInModal onClose={() => setWalkIn(false)} onDone={refreshAll} />}
      {confirm && (
        <ConfirmDialog
          title="Cancel this reservation?"
          message={`${confirm.user_name}'s ${confirm.status === 'reserved' ? 'hold' : 'waitlist place'} for "${confirm.title}" will be cancelled and they'll receive an email.${confirm.status === 'reserved' ? ' The copy goes to the next person in line.' : ''}`}
          confirmLabel="Cancel reservation"
          danger
          onConfirm={cancelRes}
          onClose={() => setConfirm(null)}
        />
      )}
    </div>
  );
}
