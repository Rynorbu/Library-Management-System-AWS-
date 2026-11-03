import { useState } from 'react';
import { Link } from 'react-router-dom';
import { PackageCheck, Hourglass, BookOpen, AlertTriangle, RefreshCw, MapPin, Library, History } from 'lucide-react';
import { useApi, BookCover, StatusBadge, Empty, Loading, ErrorState, ConfirmDialog, loanStatus } from '../components/ui.jsx';
import { api } from '../lib/api.js';
import { useToast } from '../context/ToastContext.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { fmtDate, fmtDateTime, countdown, daysUntil } from '../lib/format.js';

function Section({ title, icon: Icon, count, children }) {
  return (
    <section className="card" style={{ marginBottom: 20 }}>
      <div className="card-head">
        <Icon size={18} color="var(--ink-3)" />
        <h2>{title}</h2>
        <span className="badge">{count}</span>
      </div>
      <div className="list">{children}</div>
    </section>
  );
}

export default function MyLibrary() {
  const toast = useToast();
  const { user, refresh } = useAuth();
  const res = useApi('/reservations/me');
  const loans = useApi('/loans/me');
  const [tab, setTab] = useState('current');
  const [cancelling, setCancelling] = useState(null);
  const [renewing, setRenewing] = useState(null);

  if ((res.loading && !res.data) || (loans.loading && !loans.data)) return <Loading />;
  if (res.error || loans.error) return <div className="container page"><ErrorState error={res.error || loans.error} onRetry={() => { res.reload(); loans.reload(); }} /></div>;

  const reservations = res.data.reservations;
  const allLoans = loans.data.loans;
  const ready = reservations.filter((r) => r.status === 'reserved');
  const waiting = reservations.filter((r) => r.status === 'waitlisted');
  const pastRes = reservations.filter((r) => !['reserved', 'waitlisted'].includes(r.status));
  const active = allLoans.filter((l) => !l.returned_at);
  const returned = allLoans.filter((l) => l.returned_at);
  const overdue = active.filter((l) => new Date(l.due_at) < new Date());

  const reload = () => {
    res.reload();
    loans.reload();
    refresh();
  };

  const cancel = async () => {
    try {
      await api(`/reservations/${cancelling.id}`, { method: 'DELETE' });
      toast.success(cancelling.status === 'waitlisted' ? `Left the waitlist for "${cancelling.title}"` : `Reservation for "${cancelling.title}" cancelled`);
      reload();
    } catch (err) {
      toast.error(err.message);
      throw err;
    }
  };

  const renew = async (loan) => {
    setRenewing(loan.id);
    try {
      const r = await api(`/loans/${loan.id}/renew`, { method: 'POST' });
      toast.success(`Renewed - "${loan.title}" is now due ${fmtDate(r.loan.due_at)}`);
      reload();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setRenewing(null);
    }
  };

  const nothing = !ready.length && !waiting.length && !active.length;

  return (
    <div className="page">
      <div className="container">
        <div className="page-head">
          <div>
            <div className="eyebrow">My Library</div>
            <h1>Hello, {user.name.split(' ')[0]}</h1>
            <p>Your holds, waitlists and loans in one place.</p>
          </div>
        </div>

        <div className="stats">
          {[
            [PackageCheck, 'ic-green', 'Ready for pickup', ready.length, ready[0] ? `Next deadline ${countdown(ready[0].pickup_deadline)}` : 'Nothing to collect'],
            [Hourglass, 'ic-amber', 'On waitlist', waiting.length, waiting.length ? `Best position #${Math.min(...waiting.map((w) => w.position))}` : 'Not waiting on anything'],
            [BookOpen, 'ic-navy', 'Books on loan', active.length, active.length ? `Next due ${fmtDate(active.map((l) => l.due_at).sort()[0])}` : 'No active loans'],
            [AlertTriangle, overdue.length ? 'ic-red' : 'ic-violet', 'Overdue', overdue.length, overdue.length ? 'Please return these soon' : 'All good!'],
          ].map(([Icon, cls, label, value, sub]) => (
            <div className="card stat" key={label}>
              <div className={`ic ${cls}`}>
                <Icon size={20} />
              </div>
              <div>
                <div className="label">{label}</div>
                <div className="value">{value}</div>
                <div className="sub">{sub}</div>
              </div>
            </div>
          ))}
        </div>

        <div className="tabs">
          <button className={tab === 'current' ? 'active' : ''} onClick={() => setTab('current')}>
            Current <span className="count">{ready.length + waiting.length + active.length}</span>
          </button>
          <button className={tab === 'history' ? 'active' : ''} onClick={() => setTab('history')}>
            History <span className="count">{pastRes.length + returned.length}</span>
          </button>
        </div>

        {tab === 'current' &&
          (nothing ? (
            <div className="card">
              <Empty
                icon={Library}
                title="Your shelf is empty"
                text="Find a book in the catalogue and reserve it - we'll hold a copy for you at the desk."
                action={
                  <Link to="/books" className="btn btn-accent">
                    Browse the catalogue
                  </Link>
                }
              />
            </div>
          ) : (
            <>
              {ready.length > 0 && (
                <Section title="Ready for pickup" icon={PackageCheck} count={ready.length}>
                  {ready.map((r) => (
                    <div className="list-item" key={r.id}>
                      <Link to={`/books/${r.book_id}`}>
                        <BookCover book={r} size="md" />
                      </Link>
                      <div className="main">
                        <Link to={`/books/${r.book_id}`} className="title">
                          {r.title}
                        </Link>
                        <div className="small muted">{r.author}</div>
                        <div className="row wrap small" style={{ marginTop: 8, gap: 12 }}>
                          <StatusBadge status="reserved" />
                          <span>
                            Collect by <strong>{fmtDateTime(r.pickup_deadline)}</strong>{' '}
                            <span className={daysUntil(r.pickup_deadline) <= 1 ? '' : 'muted'} style={{ color: daysUntil(r.pickup_deadline) <= 1 ? 'var(--saffron-600)' : undefined }}>
                              ({countdown(r.pickup_deadline)})
                            </span>
                          </span>
                          {r.shelf_location && (
                            <span className="row muted" style={{ gap: 4 }}>
                              <MapPin size={13} /> {r.shelf_location}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="actions">
                        <button className="btn btn-danger btn-sm" onClick={() => setCancelling(r)}>
                          Cancel
                        </button>
                      </div>
                    </div>
                  ))}
                </Section>
              )}

              {active.length > 0 && (
                <Section title="On loan" icon={BookOpen} count={active.length}>
                  {active.map((l) => {
                    const st = loanStatus(l);
                    const d = daysUntil(l.due_at);
                    const canRenew = st === 'active' && l.renewals < loans.data.maxRenewals && l.waitlist_count === 0;
                    return (
                      <div className="list-item" key={l.id}>
                        <Link to={`/books/${l.book_id}`}>
                          <BookCover book={l} size="md" />
                        </Link>
                        <div className="main">
                          <Link to={`/books/${l.book_id}`} className="title">
                            {l.title}
                          </Link>
                          <div className="small muted">{l.author}</div>
                          <div className="row wrap small" style={{ marginTop: 8, gap: 12 }}>
                            <StatusBadge status={st}>{st === 'overdue' ? `Overdue by ${Math.max(1, -d)} day${Math.max(1, -d) === 1 ? '' : 's'}`: d <= 2 ? `Due in ${d} day${d === 1 ? '' : 's'}` : 'On loan'}</StatusBadge>
                            <span>
                              Due <strong>{fmtDate(l.due_at)}</strong>
                            </span>
                            <span className="muted">Borrowed {fmtDate(l.checked_out_at)}</span>
                            {l.renewals > 0 && <span className="muted">Renewed {l.renewals}×</span>}
                          </div>
                        </div>
                        <div className="actions">
                          <button
                            className="btn btn-outline btn-sm"
                            disabled={!canRenew || renewing === l.id}
                            onClick={() => renew(l)}
                            title={
                              canRenew
                                ? 'Extend by another loan period'
                                : st === 'overdue'
                                  ? 'Overdue loans cannot be renewed'
                                  : l.waitlist_count
                                    ? 'Others are waiting for this book'
                                    : 'Renewal limit reached'
                            }
                          >
                            {renewing === l.id ? <span className="spinner" /> : <RefreshCw size={14} />} Renew
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </Section>
              )}

              {waiting.length > 0 && (
                <Section title="Waitlist" icon={Hourglass} count={waiting.length}>
                  {waiting.map((r) => (
                    <div className="list-item" key={r.id}>
                      <Link to={`/books/${r.book_id}`}>
                        <BookCover book={r} size="md" />
                      </Link>
                      <div className="main">
                        <Link to={`/books/${r.book_id}`} className="title">
                          {r.title}
                        </Link>
                        <div className="small muted">{r.author}</div>
                        <div className="row wrap small" style={{ marginTop: 8, gap: 12 }}>
                          <StatusBadge status="waitlisted">Position #{r.position}</StatusBadge>
                          <span className="muted">Joined {fmtDate(r.created_at)}</span>
                          <span className="muted">We'll email you when it's your turn</span>
                        </div>
                      </div>
                      <div className="actions">
                        <button className="btn btn-outline btn-sm" onClick={() => setCancelling(r)}>
                          Leave
                        </button>
                      </div>
                    </div>
                  ))}
                </Section>
              )}
            </>
          ))}

        {tab === 'history' && (
          <div className="card">
            {pastRes.length + returned.length === 0 ? (
              <Empty icon={History} title="No history yet" text="Returned loans and past reservations will show up here." />
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Book</th>
                      <th>Type</th>
                      <th>Status</th>
                      <th>Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      ...returned.map((l) => ({ key: `l${l.id}`, ...l, kind: 'Loan', st: 'returned', date: l.returned_at })),
                      ...pastRes.map((r) => ({ key: `r${r.id}`, ...r, kind: 'Reservation', st: r.status, date: r.updated_at })),
                    ]
                      .sort((a, b) => new Date(b.date) - new Date(a.date))
                      .map((row) => (
                        <tr key={row.key}>
                          <td>
                            <Link to={`/books/${row.book_id}`} className="row" style={{ color: 'var(--ink)' }}>
                              <BookCover book={row} size="sm" />
                              <span>
                                <strong>{row.title}</strong>
                                <div className="small muted">{row.author}</div>
                              </span>
                            </Link>
                          </td>
                          <td>{row.kind}</td>
                          <td>
                            <StatusBadge status={row.st} />
                          </td>
                          <td className="muted">{fmtDate(row.date)}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

      {cancelling && (
        <ConfirmDialog
          title={cancelling.status === 'waitlisted' ? 'Leave the waitlist?' : 'Cancel reservation?'}
          message={
            cancelling.status === 'waitlisted'
              ? `You'll lose your place (#${cancelling.position}) for "${cancelling.title}".`
              : `The copy of "${cancelling.title}" held for you will go to the next person in line.`
          }
          confirmLabel={cancelling.status === 'waitlisted' ? 'Leave waitlist' : 'Cancel reservation'}
          danger
          onConfirm={cancel}
          onClose={() => setCancelling(null)}
        />
      )}
    </div>
  );
}
