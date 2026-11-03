import { useEffect } from 'react';
import { BellOff, CheckCircle2, Hourglass, BellRing, BookOpen, Undo2, XCircle, Clock, AlertTriangle, RefreshCw, Mail } from 'lucide-react';
import { useApi, Empty, Loading, ErrorState, StatusBadge } from '../components/ui.jsx';
import { api } from '../lib/api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { timeAgo, fmtDateTime } from '../lib/format.js';

export const NOTICE_META = {
  reservation_confirmed: [CheckCircle2, 'ic-green'],
  waitlist_joined: [Hourglass, 'ic-amber'],
  book_available: [BellRing, 'ic-saffron'],
  checked_out: [BookOpen, 'ic-navy'],
  returned: [Undo2, 'ic-violet'],
  renewed: [RefreshCw, 'ic-navy'],
  reservation_cancelled: [XCircle, 'ic-red'],
  reservation_expired: [Clock, 'ic-red'],
  pickup_reminder: [Clock, 'ic-amber'],
  due_reminder: [Clock, 'ic-amber'],
  overdue_notice: [AlertTriangle, 'ic-red'],
};

export default function Notifications() {
  const { data, loading, error, reload } = useApi('/notifications/me');
  const { refresh, counts } = useAuth();

  useEffect(() => {
    if (data && counts.unread > 0) {
      api('/notifications/me/read-all', { method: 'POST' }).then(refresh).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  return (
    <div className="page">
      <div className="container" style={{ maxWidth: 820 }}>
        <div className="page-head">
          <div>
            <div className="eyebrow">Inbox</div>
            <h1>Notifications</h1>
            <p>Every email the library has sent you, with its delivery status.</p>
          </div>
        </div>
        {loading && !data ? (
          <Loading />
        ) : error ? (
          <ErrorState error={error} onRetry={reload} />
        ) : data.notifications.length === 0 ? (
          <div className="card">
            <Empty icon={BellOff} title="No notifications yet" text="Reserve a book and confirmations will appear here and in your email inbox." />
          </div>
        ) : (
          <div className="card">
            {data.notifications.map((n) => {
              const [Icon, cls] = NOTICE_META[n.type] || [Mail, 'ic-navy'];
              return (
                <div key={n.id} className={`notice ${n.read_at ? '' : 'unread'}`}>
                  <div className={`nic ${cls}`}>
                    <Icon size={18} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="row wrap" style={{ gap: 8 }}>
                      <strong>{n.subject}</strong>
                      <span className="spacer" />
                      <span className="tiny muted" title={fmtDateTime(n.created_at)}>
                        {timeAgo(n.created_at)}
                      </span>
                    </div>
                    <pre>
                      {n.body
                        .split('\n')
                        .filter((l) => l.trim() && !/^Hi |^- CST Library|https?:\/\//.test(l))
                        .join('\n')}
                    </pre>
                    <div style={{ marginTop: 8 }}>
                      <StatusBadge status={n.status}>
                        {n.status === 'sent' ? 'Email delivered' : n.status === 'published' ? 'Email sending' : n.status === 'failed' ? 'Email failed' : 'Email queued'}
                      </StatusBadge>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
