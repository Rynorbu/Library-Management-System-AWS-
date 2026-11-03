import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Plus, Search, Pencil, Trash2, Wand2, Upload, BookX, MapPin } from 'lucide-react';
import { useApi, useDebounced, BookCover, Modal, ConfirmDialog, Empty, Loading, ErrorState, Pagination } from '../../components/ui.jsx';
import { api, qs } from '../../lib/api.js';
import { useToast } from '../../context/ToastContext.jsx';

const EMPTY = { isbn: '', title: '', author: '', publisher: '', published_year: '', category: '', shelf_location: '', total_copies: 1, cover_url: '', description: '' };

function BookForm({ book, categories, onClose, onSaved }) {
  const toast = useToast();
  const [form, setForm] = useState(() =>
    book ? Object.fromEntries(Object.keys(EMPTY).map((k) => [k, book[k] ?? ''])) : EMPTY,
  );
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [lookingUp, setLookingUp] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef();
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const preview = file ? { title: form.title, author: form.author, cover: URL.createObjectURL(file) } : { ...form, cover: form.cover_url || book?.cover };

  const lookup = async () => {
    if (!form.isbn) return toast.error('Enter an ISBN first');
    setLookingUp(true);
    try {
      const d = await api(`/books/lookup/${encodeURIComponent(form.isbn)}`);
      setForm((f) => ({
        ...f,
        isbn: d.isbn,
        title: d.title || f.title,
        author: d.author || f.author,
        publisher: d.publisher || f.publisher,
        published_year: d.published_year || f.published_year,
        cover_url: d.cover_url || f.cover_url,
        description: d.description || f.description,
        category: f.category || '',
      }));
      toast.success('Details filled in from Open Library');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLookingUp(false);
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const body = { ...form, total_copies: Number(form.total_copies), published_year: form.published_year === '' ? '' : Number(form.published_year), category: form.category || 'General' };
      const res = book ? await api(`/books/${book.id}`, { method: 'PUT', body }) : await api('/books', { method: 'POST', body });
      if (file) {
        const fd = new FormData();
        fd.append('cover', file);
        await api(`/books/${res.book.id}/cover`, { method: 'POST', form: fd });
      }
      toast.success(book ? `Saved "${form.title}"` : `Added "${form.title}" to the catalogue`);
      onSaved();
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      wide
      title={book ? 'Edit book' : 'Add a book'}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-outline" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" form="book-form" disabled={busy}>
            {busy && <span className="spinner" />} {book ? 'Save changes' : 'Add book'}
          </button>
        </>
      }
    >
      <form id="book-form" onSubmit={submit} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 150px', gap: 24 }} className="book-form">
        <div className="form-grid">
          {error && <div className="form-error full">{error}</div>}
          <div className="field full">
            <label>ISBN</label>
            <div className="row">
              <input className="input mono" value={form.isbn} onChange={set('isbn')} placeholder="978…" />
              <button type="button" className="btn btn-outline" onClick={lookup} disabled={lookingUp} title="Auto-fill from Open Library">
                {lookingUp ? <span className="spinner" /> : <Wand2 size={16} />} Auto-fill
              </button>
            </div>
          </div>
          <div className="field full">
            <label>Title *</label>
            <input className="input" required value={form.title} onChange={set('title')} />
          </div>
          <div className="field full">
            <label>Author(s) *</label>
            <input className="input" required value={form.author} onChange={set('author')} />
          </div>
          <div className="field">
            <label>Publisher</label>
            <input className="input" value={form.publisher} onChange={set('publisher')} />
          </div>
          <div className="field">
            <label>Year</label>
            <input className="input" type="number" min="1000" max="2100" value={form.published_year} onChange={set('published_year')} />
          </div>
          <div className="field">
            <label>Subject / category</label>
            <input className="input" list="cat-list" value={form.category} onChange={set('category')} placeholder="General" />
            <datalist id="cat-list">
              {categories.map((c) => (
                <option key={c.name} value={c.name} />
              ))}
            </datalist>
          </div>
          <div className="field">
            <label>Shelf location</label>
            <input className="input" value={form.shelf_location} onChange={set('shelf_location')} placeholder="e.g. CS-A3" />
          </div>
          <div className="field">
            <label>Total copies</label>
            <input className="input" type="number" min="0" max="1000" required value={form.total_copies} onChange={set('total_copies')} />
            {book && (
              <span className="hint">
                {book.total_copies - book.available_copies} on loan or held. Extra copies go to the waitlist automatically.
              </span>
            )}
          </div>
          <div className="field">
            <label>Cover image URL</label>
            <input className="input" value={form.cover_url} onChange={set('cover_url')} placeholder="https://…" />
          </div>
          <div className="field full">
            <label>Description</label>
            <textarea className="textarea" value={form.description} onChange={set('description')} />
          </div>
        </div>
        <div className="stack" style={{ gap: 10 }}>
          <BookCover book={preview} />
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => setFile(e.target.files[0] || null)} />
          <button type="button" className="btn btn-outline btn-sm" onClick={() => fileRef.current.click()}>
            <Upload size={14} /> Upload cover
          </button>
          <span className="tiny muted" style={{ textAlign: 'center' }}>
            {file ? file.name : 'Stored in S3 in production'}
          </span>
        </div>
      </form>
      <style>{`@media (max-width: 640px){ .book-form{ grid-template-columns: 1fr !important } }`}</style>
    </Modal>
  );
}

export default function ManageBooks() {
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const [text, setText] = useState('');
  const q = useDebounced(text);
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState(null); // null | 'new' | book
  const [deleting, setDeleting] = useState(null);
  const { data, loading, error, reload } = useApi(`/books${qs({ q, page, limit: 20, sort: 'title' })}`);
  const cats = useApi('/books/categories');

  useEffect(() => setPage(1), [q]);

  // Deep link from a book page: /admin/books?edit=12
  useEffect(() => {
    const id = params.get('edit');
    if (!id) return;
    api(`/books/${id}`)
      .then((d) => setEditing(d.book))
      .catch(() => {});
    setParams({}, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const del = async () => {
    try {
      await api(`/books/${deleting.id}`, { method: 'DELETE' });
      toast.success(`Deleted "${deleting.title}"`);
      reload();
      cats.reload();
    } catch (err) {
      toast.error(err.message);
      throw err;
    }
  };

  return (
    <div className="page">
      <div className="container">
        <div className="page-head">
          <div>
            <div className="eyebrow">Librarian</div>
            <h1>Manage catalogue</h1>
            <p>{data ? `${data.total} titles` : ' '}</p>
          </div>
          <span className="spacer" />
          <button className="btn btn-accent" onClick={() => setEditing('new')}>
            <Plus size={17} /> Add book
          </button>
        </div>

        <div className="toolbar">
          <div className="input-icon" style={{ flex: '1 1 300px', maxWidth: 460 }}>
            <Search size={16} />
            <input className="input" placeholder="Search title, author, ISBN or subject" value={text} onChange={(e) => setText(e.target.value)} />
          </div>
        </div>

        <div className="card">
          {loading && !data ? (
            <Loading />
          ) : error ? (
            <ErrorState error={error} onRetry={reload} />
          ) : data.books.length === 0 ? (
            <Empty icon={BookX} title="No books found" text={q ? 'Try another search.' : 'Add your first book to get started.'} />
          ) : (
            <div className="table-wrap" style={{ opacity: loading ? 0.6 : 1 }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>Book</th>
                    <th>Subject</th>
                    <th>Shelf</th>
                    <th className="num">Available</th>
                    <th className="num">Waitlist</th>
                    <th style={{ textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {data.books.map((b) => (
                    <tr key={b.id}>
                      <td>
                        <Link to={`/books/${b.id}`} className="row" style={{ color: 'var(--ink)', minWidth: 260 }}>
                          <BookCover book={b} size="sm" />
                          <span style={{ minWidth: 0 }}>
                            <strong className="clamp-2">{b.title}</strong>
                            <div className="small muted truncate">
                              {b.author} {b.isbn && <span className="mono">· {b.isbn}</span>}
                            </div>
                          </span>
                        </Link>
                      </td>
                      <td>
                        <span className="badge">{b.category}</span>
                      </td>
                      <td>
                        {b.shelf_location ? (
                          <span className="row small" style={{ gap: 4 }}>
                            <MapPin size={13} color="var(--saffron-600)" />
                            {b.shelf_location}
                          </span>
                        ) : (
                          <span className="muted">-</span>
                        )}
                      </td>
                      <td className="num">
                        <span style={{ fontWeight: 650, color: b.available_copies ? 'var(--green-600)' : 'var(--amber-600)' }}>{b.available_copies}</span>
                        <span className="muted"> / {b.total_copies}</span>
                      </td>
                      <td className="num">{b.waitlist_count || <span className="muted">0</span>}</td>
                      <td>
                        <div className="row" style={{ justifyContent: 'flex-end', gap: 4 }}>
                          <button className="btn btn-ghost btn-sm" onClick={() => setEditing(b)} aria-label={`Edit ${b.title}`}>
                            <Pencil size={15} />
                          </button>
                          <button className="btn btn-ghost btn-sm" onClick={() => setDeleting(b)} aria-label={`Delete ${b.title}`} style={{ color: 'var(--red-600)' }}>
                            <Trash2 size={15} />
                          </button>
                        </div>
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

      {editing && (
        <BookForm
          book={editing === 'new' ? null : editing}
          categories={cats.data?.categories || []}
          onClose={() => setEditing(null)}
          onSaved={() => {
            reload();
            cats.reload();
          }}
        />
      )}
      {deleting && (
        <ConfirmDialog
          title="Delete this book?"
          message={`"${deleting.title}" and its loan history will be permanently removed. Books with active loans or reservations can't be deleted.`}
          confirmLabel="Delete book"
          danger
          onConfirm={del}
          onClose={() => setDeleting(null)}
        />
      )}
    </div>
  );
}
