import { useEffect, useState } from 'react';
import { MailX, ArrowRight } from 'lucide-react';
import { useApi, Empty, Loading, ErrorState, Pagination, StatusBadge } from '../../components/ui.jsx';
import { qs } from '../../lib/api.js';
import { fmtDateTime } from '../../lib/format.js';
import { NOTICE_META } from '../Notifications.jsx';

const label = (t) => t.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

export default function EmailLog() {
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const { data, loading, error, reload } = useApi(`/notifications${qs({ status, page })}`);
  useEffect(() => setPage(1), [status]);

  // Auto-refresh so you can watch delivery status change during the demo
  useEffect(() => {
    const id = setInterval(reload, 5000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, page]);

  return (
    <div className="page">
      <div className="container">
        <div className="page-head">
          <div>
            <div className="eyebrow">Librarian</div>
            <h1>Email log</h1>
            <p className="row wrap" style={{ gap: 6 }}>
              Outbox <ArrowRight size={13} /> SQS <ArrowRight size={13} /> Lambda <ArrowRight size={13} /> SES. Refreshes every 5 seconds.
            </p>
          </div>
        </div>
        <div className="toolbar">
          <div className="segmented">
            {[
              ['', 'All'],
              ['queued', 'Queued'],
              ['published', 'In SQS'],
              ['sent', 'Sent'],
              ['failed', 'Failed'],
            ].map(([v, l]) => (
              <button key={v} className={status === v ? 'active' : ''} onClick={() => setStatus(v)}>
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
          ) : data.notifications.length === 0 ? (
            <Empty icon={MailX} title="No emails" text="Emails appear here as soon as members reserve, borrow or return books." />
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Type</th>
                    <th>Recipient</th>
                    <th>Subject</th>
                    <th>Status</th>
                    <th>Created</th>
                    <th>Delivered</th>
                  </tr>
                </thead>
                <tbody>
                  {data.notifications.map((n) => {
                    const [Icon, cls] = NOTICE_META[n.type] || [];
                    return (
                      <tr key={n.id}>
                        <td>
                          <div className="row small" style={{ gap: 8, whiteSpace: 'nowrap' }}>
                            {Icon && (
                              <span className={`tdot ${cls}`} style={{ width: 26, height: 26, borderRadius: 8, display: 'grid', placeItems: 'center' }}>
                                <Icon size={13} />
                              </span>
                            )}
                            {label(n.type)}
                          </div>
                        </td>
                        <td>
                          <div style={{ fontWeight: 600 }}>{n.user_name}</div>
                          <div className="small muted">{n.recipient}</div>
                        </td>
                        <td style={{ maxWidth: 320 }}>
                          <div className="truncate">{n.subject}</div>
                          {n.error && <div className="tiny" style={{ color: 'var(--red-600)' }}>{n.error}</div>}
                        </td>
                        <td>
                          <StatusBadge status={n.status} />
                          {n.attempts > 1 && <div className="tiny muted">{n.attempts} attempts</div>}
                        </td>
                        <td className="muted small" style={{ whiteSpace: 'nowrap' }}>
                          {fmtDateTime(n.created_at)}
                        </td>
                        <td className="muted small" style={{ whiteSpace: 'nowrap' }}>
                          {n.sent_at ? fmtDateTime(n.sent_at) : '-'}
                        </td>
                      </tr>
                    );
                  })}
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
