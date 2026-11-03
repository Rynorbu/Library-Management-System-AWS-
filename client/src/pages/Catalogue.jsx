import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Search, SearchX, X } from 'lucide-react';
import { useApi, useDebounced, BookCard, BookCardSkeleton, Empty, ErrorState, Pagination } from '../components/ui.jsx';
import { qs } from '../lib/api.js';

export default function Catalogue() {
  const [params, setParams] = useSearchParams();
  const q = params.get('q') || '';
  const category = params.get('category') || '';
  const sort = params.get('sort') || 'title';
  const available = params.get('available') === 'true';
  const page = parseInt(params.get('page'), 10) || 1;

  const [text, setText] = useState(q);
  const debounced = useDebounced(text, 300);
  useEffect(() => setText(q), [q]);

  const update = (patch) => {
    const next = { q, category, sort: sort === 'title' ? '' : sort, available, page: 1, ...patch };
    if (next.page === 1) delete next.page;
    setParams(new URLSearchParams(Object.entries(next).filter(([, v]) => v !== '' && v !== false && v != null)), { replace: true });
  };
  useEffect(() => {
    if (debounced !== q) update({ q: debounced.trim() });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);

  const { data: cats } = useApi('/books/categories');
  const { data, loading, error, reload } = useApi(`/books${qs({ q, category, sort, available, page, limit: 18 })}`);

  return (
    <div className="page">
      <div className="container">
        <div className="page-head">
          <div>
            <div className="eyebrow">Catalogue</div>
            <h1>Find a book</h1>
            <p>{data ? `${data.total} ${data.total === 1 ? 'title' : 'titles'}${q ? ` matching "${q}"` : ''}${category ? ` in ${category}` : ''}` : 'Loading the collection…'}</p>
          </div>
        </div>

        <div className="toolbar">
          <div className="input-icon" style={{ flex: '1 1 320px', maxWidth: 520 }}>
            <Search size={17} />
            <input
              className="input"
              placeholder="Title, author, ISBN or subject"
              value={text}
              onChange={(e) => setText(e.target.value)}
              aria-label="Search the catalogue"
            />
          </div>
          <select className="select" style={{ width: 'auto' }} value={sort} onChange={(e) => update({ sort: e.target.value === 'title' ? '' : e.target.value })} aria-label="Sort">
            <option value="title">Sort: Title A–Z</option>
            <option value="popular">Sort: Most popular</option>
            <option value="newest">Sort: Newest</option>
            <option value="available">Sort: Most available</option>
          </select>
          <label className="chip" style={{ cursor: 'pointer' }}>
            <input type="checkbox" checked={available} onChange={(e) => update({ available: e.target.checked })} style={{ accentColor: 'var(--navy-700)' }} />
            Available now
          </label>
          {(q || category || available || sort !== 'title') && (
            <button className="btn btn-ghost btn-sm" onClick={() => setParams({}, { replace: true })}>
              <X size={15} /> Clear
            </button>
          )}
        </div>

        <div className="chips-scroll" style={{ marginBottom: 28 }}>
          <button className={`chip ${!category ? 'active' : ''}`} onClick={() => update({ category: '' })}>
            All subjects
          </button>
          {cats?.categories.map((c) => (
            <button key={c.name} className={`chip ${category === c.name ? 'active' : ''}`} onClick={() => update({ category: c.name })}>
              {c.name} <span className="count">{c.count}</span>
            </button>
          ))}
        </div>

        {error ? (
          <ErrorState error={error} onRetry={reload} />
        ) : loading && !data ? (
          <div className="book-grid">
            {Array.from({ length: 12 }, (_, i) => (
              <BookCardSkeleton key={i} />
            ))}
          </div>
        ) : data.books.length === 0 ? (
          <Empty
            icon={SearchX}
            title="No books found"
            text="Try a different search term, another subject, or turn off the “Available now” filter."
            action={
              <button className="btn btn-outline" onClick={() => setParams({}, { replace: true })}>
                Reset filters
              </button>
            }
          />
        ) : (
          <>
            <div className="book-grid" style={{ opacity: loading ? 0.6 : 1, transition: 'opacity .15s' }}>
              {data.books.map((b) => (
                <BookCard key={b.id} book={b} />
              ))}
            </div>
            <Pagination
              page={data.page}
              pages={data.pages}
              onChange={(p) => {
                update({ page: p });
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
            />
          </>
        )}
      </div>
    </div>
  );
}
