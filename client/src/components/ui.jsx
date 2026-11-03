import { useEffect, useState, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import { X, ChevronLeft, ChevronRight, AlertTriangle } from 'lucide-react';
import { api } from '../lib/api.js';

/* ----------------------------------------------------------- data hook */
export function useApi(path, deps = []) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const ctrl = useRef();
  const load = useCallback(
    async (silent = false) => {
      if (!path) return;
      ctrl.current?.abort();
      const c = new AbortController();
      ctrl.current = c;
      if (!silent) setState((s) => ({ ...s, loading: true }));
      try {
        const data = await api(path, { signal: c.signal });
        setState({ data, error: null, loading: false });
      } catch (error) {
        if (error.name !== 'AbortError') setState({ data: null, error, loading: false });
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [path, ...deps],
  );
  useEffect(() => {
    load();
    return () => ctrl.current?.abort();
  }, [load]);
  return { ...state, reload: () => load(true) };
}

/* ------------------------------------------------------------- cover */
const PALETTES = [
  ['#1f3a5f', '#2b4d7a'],
  ['#7a2e2e', '#a54242'],
  ['#245a4a', '#2f7a63'],
  ['#5b3b7a', '#7c56a3'],
  ['#8a5a14', '#b9791f'],
  ['#2d4a6b', '#3f6c96'],
  ['#3b3b3b', '#5a5a5a'],
  ['#6b2f4f', '#94426e'],
];
const hash = (s) => [...String(s)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);

export function BookCover({ book, size = '', className = '' }) {
  const [failed, setFailed] = useState(false);
  const src = book?.cover;
  const [a, b] = PALETTES[hash(book?.title || '') % PALETTES.length];
  useEffect(() => setFailed(false), [src]);
  return (
    <div className={`cover ${size} ${className}`}>
      {src && !failed ? (
        <img src={src} alt={`Cover of ${book.title}`} loading="lazy" onError={() => setFailed(true)} />
      ) : (
        <div className="cover-fallback" style={{ background: `linear-gradient(160deg, ${a}, ${b})` }}>
          <div className="t">{book?.title}</div>
          <div className="a">{book?.author}</div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------- badges */
export function AvailabilityBadge({ book }) {
  if (book.total_copies === 0) return <span className="badge">Reference only</span>;
  if (book.available_copies > 0)
    return (
      <span className="badge badge-green">
        <span className="dot" />
        {book.available_copies} of {book.total_copies} available
      </span>
    );
  return (
    <span className="badge badge-amber">
      <span className="dot" />
      {book.waitlist_count ? `Waitlist · ${book.waitlist_count}` : 'All copies out'}
    </span>
  );
}

const STATUS = {
  reserved: ['badge-green', 'Ready for pickup'],
  waitlisted: ['badge-amber', 'Waitlisted'],
  fulfilled: ['badge-blue', 'Collected'],
  cancelled: ['', 'Cancelled'],
  expired: ['badge-red', 'Expired'],
  active: ['badge-blue', 'On loan'],
  overdue: ['badge-red', 'Overdue'],
  returned: ['', 'Returned'],
  queued: ['badge-amber', 'Queued'],
  published: ['badge-blue', 'In SQS'],
  sent: ['badge-green', 'Sent'],
  failed: ['badge-red', 'Failed'],
  student: ['badge-navy', 'Student'],
  staff: ['badge-violet', 'Staff'],
  librarian: ['badge-amber', 'Librarian'],
};
export function StatusBadge({ status, children }) {
  const [cls, label] = STATUS[status] || ['', status];
  return (
    <span className={`badge ${cls}`}>
      <span className="dot" />
      {children || label}
    </span>
  );
}

export const loanStatus = (l) => (l.returned_at ? 'returned' : new Date(l.due_at) < new Date() ? 'overdue' : 'active');

/* ------------------------------------------------------------- modal */
export function Modal({ title, onClose, children, footer, wide }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <h2>{title}</h2>
          <span className="spacer" />
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function ConfirmDialog({ title, message, confirmLabel = 'Confirm', danger, onConfirm, onClose }) {
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-outline" onClick={onClose} disabled={busy}>
            Keep it
          </button>
          <button
            className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`}
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onConfirm();
                onClose();
              } catch {
                // caller already showed a toast; keep the dialog open
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy && <span className="spinner" />}
            {confirmLabel}
          </button>
        </>
      }
    >
      <div className="row" style={{ alignItems: 'flex-start', gap: 14 }}>
        {danger && (
          <div className="stat" style={{ padding: 0 }}>
            <div className="ic ic-red">
              <AlertTriangle size={20} />
            </div>
          </div>
        )}
        <p style={{ color: 'var(--ink-2)' }}>{message}</p>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------- misc helpers */
export function Empty({ icon: Icon, title, text, action }) {
  return (
    <div className="empty">
      {Icon && (
        <div className="ic">
          <Icon size={28} />
        </div>
      )}
      <h3>{title}</h3>
      {text && <p>{text}</p>}
      {action}
    </div>
  );
}

export function Loading() {
  return (
    <div className="center-load">
      <div className="spinner" />
    </div>
  );
}

export function ErrorState({ error, onRetry }) {
  return (
    <Empty
      icon={AlertTriangle}
      title="Something went wrong"
      text={error?.message}
      action={
        onRetry && (
          <button className="btn btn-outline" onClick={onRetry}>
            Try again
          </button>
        )
      }
    />
  );
}

export function Pagination({ page, pages, onChange }) {
  if (pages <= 1) return null;
  const nums = [];
  for (let i = Math.max(1, page - 2); i <= Math.min(pages, page + 2); i++) nums.push(i);
  return (
    <nav className="pagination" aria-label="Pagination">
      <button disabled={page <= 1} onClick={() => onChange(page - 1)} aria-label="Previous page">
        <ChevronLeft size={16} />
      </button>
      {nums[0] > 1 && <span className="muted">…</span>}
      {nums.map((n) => (
        <button key={n} className={n === page ? 'active' : ''} onClick={() => onChange(n)}>
          {n}
        </button>
      ))}
      {nums[nums.length - 1] < pages && <span className="muted">…</span>}
      <button disabled={page >= pages} onClick={() => onChange(page + 1)} aria-label="Next page">
        <ChevronRight size={16} />
      </button>
    </nav>
  );
}

export function BookCard({ book }) {
  return (
    <Link to={`/books/${book.id}`} className="book-card">
      <div className="cover-wrap">
        <BookCover book={book} />
        <AvailabilityBadge book={book} />
      </div>
      <div>
        <h3 className="clamp-2">{book.title}</h3>
        <div className="author truncate">{book.author}</div>
      </div>
    </Link>
  );
}

export function BookCardSkeleton() {
  return (
    <div className="book-card">
      <div className="skeleton" style={{ aspectRatio: '2/3' }} />
      <div className="skeleton" style={{ height: 14, width: '85%' }} />
      <div className="skeleton" style={{ height: 12, width: '55%' }} />
    </div>
  );
}

export function useDebounced(value, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}
