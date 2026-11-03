import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Mail, Lock, User, IdCard, Building2, AlertCircle, Search, BellRing, ShieldCheck, ArrowRight } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { Brand } from '../components/Layout.jsx';

function AuthArt() {
  const colors = ['#e07a2f', '#f2b632', '#f7f5f0', '#2b4d7a', '#c9631f', '#f2b632', '#ffffff', '#e07a2f', '#3f6c96', '#f2b632', '#f7f5f0'];
  return (
    <aside className="auth-art">
      <Brand />
      <div>
        <h1>
          Your library, <em>open around the clock.</em>
        </h1>
        <div className="feature-list">
          <div>
            <span className="ic">
              <Search size={18} />
            </span>
            <p>
              <strong>Live availability</strong>
              <span>See copy counts and shelf locations before you walk over.</span>
            </p>
          </div>
          <div>
            <span className="ic">
              <BellRing size={18} />
            </span>
            <p>
              <strong>Never miss your turn</strong>
              <span>Get an email the moment a waitlisted book comes back.</span>
            </p>
          </div>
          <div>
            <span className="ic">
              <ShieldCheck size={18} />
            </span>
            <p>
              <strong>Fair for everyone</strong>
              <span>First come, first served - no double bookings, ever.</span>
            </p>
          </div>
        </div>
        <div className="book-stack" aria-hidden="true">
          {colors.map((c, i) => (
            <i key={i} style={{ background: c, height: `${60 + ((i * 37) % 55)}%`, opacity: 0.85 }} />
          ))}
        </div>
      </div>
      <p className="small" style={{ color: 'rgba(255,255,255,.6)' }}>
        College of Science and Technology · Royal University of Bhutan
      </p>
    </aside>
  );
}

const DEMO = [
  ['Librarian', 'librarian@cst.edu.bt'],
  ['Student A', 'student.a@cst.edu.bt'],
  ['Student B', 'student.b@cst.edu.bt'],
];

export function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [form, setForm] = useState({ email: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e, creds = form) => {
    e?.preventDefault();
    setBusy(true);
    setError('');
    try {
      const user = await login(creds.email, creds.password);
      navigate(location.state?.from || (user.role === 'librarian' ? '/admin' : '/books'), { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth">
      <AuthArt />
      <div className="auth-form">
        <div className="auth-card">
          <h2>Welcome back</h2>
          <p className="muted" style={{ margin: '6px 0 26px' }}>
            Sign in to reserve books and manage your loans.
          </p>
          <form className="stack" onSubmit={submit}>
            {error && (
              <div className="form-error">
                <AlertCircle size={17} /> {error}
              </div>
            )}
            <div className="field">
              <label htmlFor="email">Email</label>
              <div className="input-icon">
                <Mail size={17} />
                <input id="email" className="input" type="email" autoComplete="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="you@cst.edu.bt" />
              </div>
            </div>
            <div className="field">
              <label htmlFor="password">Password</label>
              <div className="input-icon">
                <Lock size={17} />
                <input id="password" className="input" type="password" autoComplete="current-password" required value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="••••••••" />
              </div>
            </div>
            <button className="btn btn-primary btn-lg btn-block" disabled={busy}>
              {busy && <span className="spinner" />} Sign in <ArrowRight size={17} />
            </button>
          </form>
          <p className="small muted" style={{ marginTop: 18, textAlign: 'center' }}>
            New here? <Link to="/register">Create an account</Link> · <Link to="/books">Browse without signing in</Link>
          </p>

          <div className="demo-box">
            <div className="small" style={{ fontWeight: 650 }}>
              Demo accounts
            </div>
            <div className="tiny muted">Password for all: Password@123</div>
            <div className="demo-users">
              {DEMO.map(([label, email]) => (
                <button key={email} type="button" disabled={busy} onClick={() => submit(null, { email, password: 'Password@123' })}>
                  <strong>{label}</strong>
                  <span className="muted">{email.split('@')[0]}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function Register() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'student', studentId: '', department: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await register(form);
      navigate('/books', { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth">
      <AuthArt />
      <div className="auth-form">
        <div className="auth-card">
          <h2>Create your account</h2>
          <p className="muted" style={{ margin: '6px 0 22px' }}>
            Use your college email so library notifications reach you.
          </p>
          <form className="stack" onSubmit={submit}>
            {error && (
              <div className="form-error">
                <AlertCircle size={17} /> {error}
              </div>
            )}
            <div className="segmented" role="radiogroup" aria-label="I am a">
              {['student', 'staff'].map((r) => (
                <button type="button" key={r} className={form.role === r ? 'active' : ''} onClick={() => setForm({ ...form, role: r })} aria-pressed={form.role === r}>
                  {r === 'student' ? 'Student' : 'Staff'}
                </button>
              ))}
            </div>
            <div className="field">
              <label htmlFor="name">Full name</label>
              <div className="input-icon">
                <User size={17} />
                <input id="name" className="input" required value={form.name} onChange={set('name')} autoComplete="name" />
              </div>
            </div>
            <div className="field">
              <label htmlFor="remail">Email</label>
              <div className="input-icon">
                <Mail size={17} />
                <input id="remail" className="input" type="email" required value={form.email} onChange={set('email')} autoComplete="email" placeholder="you@cst.edu.bt" />
              </div>
            </div>
            <div className="form-grid">
              <div className="field">
                <label htmlFor="sid">{form.role === 'student' ? 'Student ID' : 'Employee ID'}</label>
                <div className="input-icon">
                  <IdCard size={17} />
                  <input id="sid" className="input" value={form.studentId} onChange={set('studentId')} placeholder="Optional" />
                </div>
              </div>
              <div className="field">
                <label htmlFor="dept">Department</label>
                <div className="input-icon">
                  <Building2 size={17} />
                  <input id="dept" className="input" value={form.department} onChange={set('department')} placeholder="Optional" />
                </div>
              </div>
            </div>
            <div className="field">
              <label htmlFor="rpw">Password</label>
              <div className="input-icon">
                <Lock size={17} />
                <input id="rpw" className="input" type="password" required minLength={8} value={form.password} onChange={set('password')} autoComplete="new-password" />
              </div>
              <span className="hint">At least 8 characters.</span>
            </div>
            <button className="btn btn-accent btn-lg btn-block" disabled={busy}>
              {busy && <span className="spinner" />} Create account
            </button>
          </form>
          <p className="small muted" style={{ marginTop: 18, textAlign: 'center' }}>
            Already registered? <Link to="/login">Sign in</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
