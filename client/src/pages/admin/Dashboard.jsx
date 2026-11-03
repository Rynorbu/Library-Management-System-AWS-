import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  BookCopy,
  PackageCheck,
  Hourglass,
  BookOpen,
  AlertTriangle,
  Users,
  Play,
  Activity,
  Server,
  Database,
  Mail,
  HardDrive,
  ArrowRight,
  CheckCircle2,
  Undo2,
  XCircle,
  Clock,
  BookPlus,
  Pencil,
  ListPlus,
  BellRing,
  RefreshCw,
} from 'lucide-react';
import { useApi, Loading, ErrorState, BookCover } from '../../components/ui.jsx';
import { api } from '../../lib/api.js';
import { useToast } from '../../context/ToastContext.jsx';
import { timeAgo } from '../../lib/format.js';

const ACTIONS = {
  reserved: [CheckCircle2, 'ic-green', (a) => `${a.user_name} reserved`],
  waitlisted: [ListPlus, 'ic-amber', (a) => `${a.user_name} joined the waitlist for`],
  waitlist_promoted: [BellRing, 'ic-saffron', (a) => `${a.user_name} was promoted from the waitlist for`],
  checked_out: [BookOpen, 'ic-navy', (a) => `${a.user_name} borrowed`],
  returned: [Undo2, 'ic-violet', (a) => `${a.user_name} returned`],
  renewed: [RefreshCw, 'ic-navy', (a) => `${a.user_name} renewed`],
  reservation_cancelled: [XCircle, 'ic-red', (a) => `Reservation cancelled (${a.user_name}) for`],
  hold_expired: [Clock, 'ic-red', (a) => `Hold expired (${a.user_name}) for`],
  book_added: [BookPlus, 'ic-green', (a) => `${a.actor_name} added`],
  book_updated: [Pencil, 'ic-navy', (a) => `${a.actor_name} edited`],
  book_deleted: [XCircle, 'ic-red', (a) => `${a.actor_name} deleted "${a.details?.title}"`],
  user_updated: [Users, 'ic-violet', (a) => `${a.actor_name} updated member ${a.user_name}`],
};

export default function Dashboard() {
  const { data, loading, error, reload } = useApi('/admin/stats');
  const toast = useToast();
  const [running, setRunning] = useState(false);

  if (loading && !data) return <Loading />;
  if (error) return <div className="container page"><ErrorState error={error} onRetry={reload} /></div>;

  const { totals: t, popular, categories, daily, activity, emails, system } = data;
  const maxDaily = Math.max(1, ...daily.map((d) => d.loans + d.reservations));
  const maxCat = Math.max(1, ...categories.map((c) => c.copies));

  const runJobs = async () => {
    setRunning(true);
    try {
      const r = await api('/admin/jobs/run', { method: 'POST' });
      toast.success(
        `Daily jobs done: ${r.expiredHolds} holds expired, ${r.pickupReminders} pickup reminders, ${r.dueReminders} due reminders, ${r.overdueNotices} overdue notices.`,
      );
      reload();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="page">
      <div className="container">
        <div className="page-head">
          <div>
            <div className="eyebrow">Librarian</div>
            <h1>Library dashboard</h1>
            <p>Live overview of the collection, circulation and notifications.</p>
          </div>
          <span className="spacer" />
          <button className="btn btn-outline" onClick={runJobs} disabled={running} title="Expire uncollected holds and send reminders now (normally run daily by EventBridge)">
            {running ? <span className="spinner" /> : <Play size={16} />} Run daily jobs now
          </button>
          <Link to="/admin/circulation" className="btn btn-primary">
            Open circulation desk <ArrowRight size={16} />
          </Link>
        </div>

        <div className="stats">
          {[
            [BookCopy, 'ic-navy', 'Collection', t.copies, `${t.titles} titles · ${t.available} on shelf`],
            [PackageCheck, 'ic-green', 'Ready for pickup', t.ready_for_pickup, 'Held at the desk'],
            [Hourglass, 'ic-amber', 'On waitlists', t.waitlisted, 'Students waiting'],
            [BookOpen, 'ic-violet', 'Active loans', t.active_loans, `${t.loans_30d} loans in 30 days`],
            [AlertTriangle, t.overdue ? 'ic-red' : 'ic-green', 'Overdue', t.overdue, t.overdue ? 'Needs follow-up' : 'Nothing overdue'],
            [Users, 'ic-saffron', 'Members', t.members, `${t.reservations_30d} reservations in 30 days`],
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

        <div className="grid-2" style={{ marginBottom: 20 }}>
          <section className="card">
            <div className="card-head">
              <h2>Activity - last 14 days</h2>
              <span className="spacer" />
              <div className="legend">
                <span>
                  <i style={{ background: 'var(--navy-700)' }} /> Loans
                </span>
                <span>
                  <i style={{ background: 'var(--gold-400)' }} /> Reservations
                </span>
              </div>
            </div>
            <div className="card-body">
              <div className="bars">
                {daily.map((d) => {
                  const total = d.loans + d.reservations;
                  const date = new Date(d.day + 'T00:00:00');
                  return (
                    <div className="col" key={d.day} title={`${date.toDateString()}: ${d.loans} loans, ${d.reservations} reservations`}>
                      <div className="stack-bar" style={{ height: `${(total / maxDaily) * 100}%` }}>
                        <div className="seg-a" style={{ flex: d.loans }} />
                        <div className="seg-b" style={{ flex: d.reservations }} />
                      </div>
                      <span className="lbl">{date.getDate()}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </section>

          <section className="card">
            <div className="card-head">
              <h2>Collection by subject</h2>
            </div>
            <div className="card-body">
              {categories.map((c) => (
                <div className="hbar" key={c.name}>
                  <span className="truncate" title={c.name}>
                    {c.name}
                  </span>
                  <div className="track">
                    <div className="fill" style={{ width: `${(c.copies / maxCat) * 100}%` }} />
                  </div>
                  <span className="num muted small" style={{ textAlign: 'right' }}>
                    {c.copies}
                  </span>
                </div>
              ))}
            </div>
          </section>
        </div>

        <div className="grid-2">
          <section className="card">
            <div className="card-head">
              <h2>Most in demand (90 days)</h2>
              <span className="spacer" />
              <Link to="/admin/books" className="btn btn-ghost btn-sm">
                Manage books
              </Link>
            </div>
            <div className="list">
              {popular.map((b, i) => (
                <Link to={`/books/${b.id}`} className="list-item" key={b.id} style={{ color: 'var(--ink)' }}>
                  <span className="muted" style={{ fontFamily: 'var(--font-serif)', fontSize: '1.2rem', width: 20 }}>
                    {i + 1}
                  </span>
                  <BookCover book={b} size="sm" />
                  <div className="main">
                    <div className="title truncate">{b.title}</div>
                    <div className="small muted truncate">{b.author}</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontWeight: 700 }}>{b.demand}</div>
                    <div className="tiny muted">
                      {b.available_copies}/{b.total_copies} free
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </section>

          <div className="stack" style={{ gap: 20 }}>
            <section className="card">
              <div className="card-head">
                <Activity size={17} color="var(--ink-3)" />
                <h2>Recent activity</h2>
              </div>
              <div className="card-body timeline" style={{ paddingTop: 6, paddingBottom: 6 }}>
                {activity.length === 0 && <p className="muted small">No activity yet.</p>}
                {activity.map((a) => {
                  const [Icon, cls, text] = ACTIONS[a.action] || [Activity, 'ic-navy', () => a.action];
                  return (
                    <div className="timeline-item" key={a.id}>
                      <span className={`tdot ${cls}`}>
                        <Icon size={14} />
                      </span>
                      <div style={{ minWidth: 0 }}>
                        <div>
                          {text(a)} {a.book_title && <strong>{a.book_title}</strong>}
                        </div>
                        <div className="tiny muted">{timeAgo(a.created_at)}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            <section className="card">
              <div className="card-head">
                <Server size={17} color="var(--ink-3)" />
                <h2>System</h2>
              </div>
              <div className="card-body stack" style={{ gap: 12 }}>
                {[
                  [Mail, 'Email pipeline', system.notifications === 'sqs' ? 'SQS → Lambda → SES' : system.notifications === 'ses-direct' ? 'SES (direct)' : 'Console (local dev)'],
                  [Database, 'Catalogue cache', system.cache === 'redis' ? 'ElastiCache (Redis)' : 'In-memory'],
                  [HardDrive, 'Cover storage', system.storage === 's3' ? 'Private S3 + presigned URLs' : 'Local disk'],
                  [Database, 'Read replica', system.readReplica ? 'Enabled' : 'Primary only'],
                ].map(([Icon, k, v]) => (
                  <div className="row small" key={k}>
                    <Icon size={15} color="var(--ink-3)" />
                    <span className="muted">{k}</span>
                    <span className="spacer" />
                    <strong>{v}</strong>
                  </div>
                ))}
                <div className="row wrap" style={{ gap: 6, borderTop: '1px solid var(--line)', paddingTop: 12 }}>
                  <span className="small muted">Emails:</span>
                  <span className="badge badge-green">{emails.sent || 0} sent</span>
                  <span className="badge badge-blue">{emails.published || 0} in SQS</span>
                  <span className="badge badge-amber">{emails.queued || 0} queued</span>
                  <span className="badge badge-red">{emails.failed || 0} failed</span>
                </div>
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
