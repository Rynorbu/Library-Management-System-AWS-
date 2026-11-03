import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Search, ArrowRight, BookmarkPlus, Clock3, MailCheck, Layers } from 'lucide-react';
import { useApi, BookCard, BookCardSkeleton } from '../components/ui.jsx';
import { useAuth } from '../context/AuthContext.jsx';

function Shelf({ title, subtitle, sort }) {
  const { data, loading } = useApi(`/books?sort=${sort}&limit=6`);
  return (
    <section style={{ marginTop: 48 }}>
      <div className="page-head" style={{ marginBottom: 20 }}>
        <div>
          <h2>{title}</h2>
          <p>{subtitle}</p>
        </div>
        <span className="spacer" />
        <Link to={`/books?sort=${sort}`} className="btn btn-ghost btn-sm">
          View all <ArrowRight size={15} />
        </Link>
      </div>
      <div className="book-grid">
        {loading
          ? Array.from({ length: 6 }, (_, i) => <BookCardSkeleton key={i} />)
          : data?.books.map((b) => <BookCard key={b.id} book={b} />)}
      </div>
    </section>
  );
}

export default function Home() {
  const [q, setQ] = useState('');
  const navigate = useNavigate();
  const { user } = useAuth();
  const { data: cats } = useApi('/books/categories');
  const totalTitles = cats?.categories.reduce((s, c) => s + c.count, 0);

  return (
    <>
      <section className="hero">
        <div className="container">
          <div className="eyebrow" style={{ color: 'var(--gold-400)' }}>
            College of Science and Technology
          </div>
          <h1>
            Skip the queue. <em>Reserve your next book</em> in seconds.
          </h1>
          <p className="lead">
            Search the catalogue, see live copy counts and shelf locations, reserve a copy or join a fair waitlist, and get an
            email the moment it's ready.
          </p>
          <form
            className="hero-search"
            onSubmit={(e) => {
              e.preventDefault();
              navigate(`/books${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ''}`);
            }}
          >
            <div className="input-icon">
              <Search size={19} />
              <input className="input" placeholder="Search by title, author, ISBN or subject…" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <button className="btn btn-accent btn-lg" type="submit">
              <Search size={17} />
              <span>Search</span>
            </button>
          </form>
          <div className="hero-stats">
            <div>
              <strong>{totalTitles ?? '-'}</strong>
              <span>titles in the catalogue</span>
            </div>
            <div>
              <strong>{cats?.categories.length ?? '-'}</strong>
              <span>subject areas</span>
            </div>
            <div>
              <strong>24/7</strong>
              <span>online reservations</span>
            </div>
          </div>
        </div>
      </section>

      <div className="container" style={{ paddingBottom: 64 }}>
        <section className="stats" style={{ marginTop: -28, position: 'relative', zIndex: 2 }}>
          {[
            [BookmarkPlus, 'ic-saffron', 'Reserve online', 'A copy is held for you for 48 hours at the desk.'],
            [Layers, 'ic-navy', 'Fair waitlist', 'All copies out? Join a first-come, first-served queue.'],
            [MailCheck, 'ic-green', 'Instant email', '"Now available" email the moment a book is returned.'],
            [Clock3, 'ic-violet', 'Reminders', 'Pickup, due-date and overdue reminders, every day.'],
          ].map(([Icon, cls, t, d]) => (
            <div className="card stat" key={t}>
              <div className={`ic ${cls}`}>
                <Icon size={20} />
              </div>
              <div>
                <h3>{t}</h3>
                <p className="small muted" style={{ marginTop: 3 }}>
                  {d}
                </p>
              </div>
            </div>
          ))}
        </section>

        {cats?.categories.length > 0 && (
          <section style={{ marginTop: 40 }}>
            <h2 style={{ marginBottom: 14 }}>Browse by subject</h2>
            <div className="row wrap" style={{ gap: 8 }}>
              {cats.categories.map((c) => (
                <Link key={c.name} to={`/books?category=${encodeURIComponent(c.name)}`} className="chip">
                  {c.name} <span className="count">{c.count}</span>
                </Link>
              ))}
            </div>
          </section>
        )}

        <Shelf title="Most in demand" subtitle="What CST students are borrowing right now" sort="popular" />
        <Shelf title="New arrivals" subtitle="Recently added to the collection" sort="newest" />

        {!user && (
          <section className="card card-pad" style={{ marginTop: 56, display: 'flex', gap: 20, alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 240 }}>
              <h2>Ready to reserve?</h2>
              <p className="muted" style={{ marginTop: 6 }}>
                Create a free account with your college email to reserve books and track your loans.
              </p>
            </div>
            <Link to="/register" className="btn btn-accent btn-lg">
              Create account <ArrowRight size={17} />
            </Link>
          </section>
        )}
      </div>
    </>
  );
}
