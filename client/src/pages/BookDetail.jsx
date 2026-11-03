import { useState } from 'react';
import { Link, useNavigate, useParams, useLocation } from 'react-router-dom';
import {
  ArrowLeft,
  BookmarkPlus,
  ListPlus,
  CheckCircle2,
  Hourglass,
  BookOpenCheck,
  MapPin,
  Pencil,
  Users,
  CalendarClock,
  LogIn,
} from 'lucide-react';
import { useApi, BookCover, BookCard, Loading, ErrorState, ConfirmDialog } from '../components/ui.jsx';
import { api } from '../lib/api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { fmtDate, fmtDateTime, countdown } from '../lib/format.js';

export default function BookDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { user, isLibrarian, refresh } = useAuth();
  const toast = useToast();
  const { data, loading, error, reload } = useApi(`/books/${id}`, [user?.id]);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);

  if (loading && !data) return <Loading />;
  if (error) return <div className="container page"><ErrorState error={error} onRetry={reload} /></div>;

  const { book, mine, related } = data;
  const pct = book.total_copies ? Math.round((book.available_copies / book.total_copies) * 100) : 0;
  const reservation = mine?.reservation;
  const loan = mine?.loan;

  const reserve = async () => {
    setBusy(true);
    try {
      const res = await api('/reservations', { method: 'POST', body: { bookId: book.id } });
      toast.success(res.message);
      await reload();
      refresh();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    try {
      await api(`/reservations/${reservation.id}`, { method: 'DELETE' });
      toast.success(reservation.status === 'waitlisted' ? 'You left the waitlist' : 'Reservation cancelled - the copy has been released');
      await reload();
      refresh();
    } catch (err) {
      toast.error(err.message);
      throw err;
    }
  };

  let action;
  if (!user) {
    action = (
      <button className="btn btn-primary btn-lg" onClick={() => navigate('/login', { state: { from: location.pathname } })}>
        <LogIn size={18} /> Sign in to reserve
      </button>
    );
  } else if (loan) {
    action = (
      <div className="status-callout blue">
        <BookOpenCheck size={20} />
        <div>
          <strong>You have this book on loan.</strong> It's due back on {fmtDate(loan.due_at)}.{' '}
          <Link to="/my-library">Manage loan</Link>
        </div>
      </div>
    );
  } else if (reservation?.status === 'reserved') {
    action = (
      <>
        <div className="status-callout green">
          <CheckCircle2 size={20} />
          <div>
            <strong>A copy is held for you.</strong> Collect it from the circulation desk before{' '}
            <strong>{fmtDateTime(reservation.pickup_deadline)}</strong> ({countdown(reservation.pickup_deadline)}). Bring your ID card.
          </div>
        </div>
        <button className="btn btn-danger" style={{ marginTop: 12 }} onClick={() => setConfirm(true)}>
          Cancel reservation
        </button>
      </>
    );
  } else if (reservation?.status === 'waitlisted') {
    action = (
      <>
        <div className="status-callout amber">
          <Hourglass size={20} />
          <div>
            <strong>You're #{reservation.position} on the waitlist.</strong> We'll email you the moment a copy is ready - then you'll have{' '}
            48 hours to collect it.
          </div>
        </div>
        <button className="btn btn-outline" style={{ marginTop: 12 }} onClick={() => setConfirm(true)}>
          Leave waitlist
        </button>
      </>
    );
  } else if (book.total_copies === 0) {
    action = <p className="muted">This title is for reference use in the library only.</p>;
  } else if (book.available_copies > 0) {
    action = (
      <button className="btn btn-accent btn-lg" onClick={reserve} disabled={busy}>
        {busy ? <span className="spinner" /> : <BookmarkPlus size={18} />} Reserve a copy
      </button>
    );
  } else {
    action = (
      <>
        <button className="btn btn-primary btn-lg" onClick={reserve} disabled={busy}>
          {busy ? <span className="spinner" /> : <ListPlus size={18} />} Join the waitlist
        </button>
        <p className="small muted" style={{ marginTop: 10 }}>
          {book.waitlist_count
            ? `${book.waitlist_count} ${book.waitlist_count === 1 ? 'person is' : 'people are'} ahead of you.`
            : "You'll be first in line."}{' '}
          {book.next_due_at && `The next copy is due back ${fmtDate(book.next_due_at)}.`}
        </p>
      </>
    );
  }

  return (
    <div className="page">
      <div className="container">
        <button className="btn btn-ghost btn-sm" onClick={() => (window.history.length > 1 ? navigate(-1) : navigate('/books'))} style={{ marginBottom: 20 }}>
          <ArrowLeft size={16} /> Back
        </button>

        <div className="detail">
          <div className="detail-cover">
            <BookCover book={book} />
          </div>

          <div>
            <div className="row wrap" style={{ marginBottom: 12 }}>
              <Link to={`/books?category=${encodeURIComponent(book.category)}`} className="badge badge-navy">
                {book.category}
              </Link>
              {isLibrarian && (
                <Link to={`/admin/books?edit=${book.id}`} className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto' }}>
                  <Pencil size={14} /> Edit book
                </Link>
              )}
            </div>
            <h1>{book.title}</h1>
            <p className="by">by {book.author}</p>

            <dl className="meta-grid">
              <div>
                <dt>Shelf</dt>
                <dd className="row" style={{ gap: 5 }}>
                  <MapPin size={14} color="var(--saffron-600)" /> {book.shelf_location || '-'}
                </dd>
              </div>
              <div>
                <dt>ISBN</dt>
                <dd className="mono">{book.isbn || '-'}</dd>
              </div>
              <div>
                <dt>Publisher</dt>
                <dd className="truncate" title={book.publisher}>
                  {book.publisher || '-'}
                </dd>
              </div>
              <div>
                <dt>Year</dt>
                <dd>{book.published_year || '-'}</dd>
              </div>
            </dl>

            <div className="availability">
              <div className="ring" style={{ '--p': pct, '--ring-color': book.available_copies ? 'var(--green-600)' : 'var(--saffron-500)' }}>
                <div>
                  <div>
                    <strong>{book.available_copies}</strong>
                    <span style={{ display: 'block' }}>of {book.total_copies}</span>
                  </div>
                </div>
              </div>
              <div>
                <h3 style={{ fontSize: '1.1rem' }}>
                  {book.total_copies === 0
                    ? 'Reference only'
                    : book.available_copies > 0
                      ? `${book.available_copies} ${book.available_copies === 1 ? 'copy' : 'copies'} available now`
                      : 'All copies are currently out'}
                </h3>
                <div className="row wrap small muted" style={{ gap: 16, margin: '6px 0 16px' }}>
                  <span className="row" style={{ gap: 5 }}>
                    <BookOpenCheck size={14} /> {book.on_loan_count} on loan
                  </span>
                  <span className="row" style={{ gap: 5 }}>
                    <CalendarClock size={14} /> {book.held_count} held for pickup
                  </span>
                  <span className="row" style={{ gap: 5 }}>
                    <Users size={14} /> {book.waitlist_count} waiting
                  </span>
                </div>
                {action}
              </div>
            </div>

            {book.description && (
              <section style={{ marginTop: 32 }}>
                <h2 style={{ marginBottom: 10 }}>About this book</h2>
                <p style={{ color: 'var(--ink-2)', maxWidth: 680, lineHeight: 1.7 }}>{book.description}</p>
              </section>
            )}
          </div>
        </div>

        {related?.length > 0 && (
          <section style={{ marginTop: 64 }}>
            <h2 style={{ marginBottom: 18 }}>More in {book.category}</h2>
            <div className="book-grid">
              {related.map((b) => (
                <BookCard key={b.id} book={b} />
              ))}
            </div>
          </section>
        )}
      </div>

      {confirm && (
        <ConfirmDialog
          title={reservation?.status === 'waitlisted' ? 'Leave the waitlist?' : 'Cancel this reservation?'}
          message={
            reservation?.status === 'waitlisted'
              ? `You'll lose your place (#${reservation.position}) in the queue for "${book.title}".`
              : `The copy held for you will be released to the next person in line.`
          }
          confirmLabel={reservation?.status === 'waitlisted' ? 'Leave waitlist' : 'Cancel reservation'}
          danger
          onConfirm={cancel}
          onClose={() => setConfirm(false)}
        />
      )}
    </div>
  );
}
