import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  BookOpen,
  Library,
  Bell,
  LayoutDashboard,
  ArrowLeftRight,
  BookCopy,
  Users,
  Mail,
  LogOut,
  User,
  Menu,
  BookMarked,
  LogIn,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { initials, roleLabel } from '../lib/format.js';

export function Brand() {
  return (
    <Link to="/" className="brand">
      <span className="brand-mark">
        <BookOpen size={18} />
      </span>
      <span>
        CST Library
        <small>Book Reservation System</small>
      </span>
    </Link>
  );
}

function UserMenu() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef();
  const navigate = useNavigate();
  useEffect(() => {
    const close = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);
  return (
    <div className="user-menu" ref={ref}>
      <button className="user-trigger" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="avatar">{initials(user.name)}</span>
        <span className="user-name small" style={{ fontWeight: 600 }}>
          {user.name.split(' ')[0]}
        </span>
      </button>
      {open && (
        <div className="dropdown" onClick={() => setOpen(false)}>
          <div className="dropdown-head">
            <div style={{ fontWeight: 650 }}>{user.name}</div>
            <div className="small muted truncate">{user.email}</div>
            <span className="badge badge-navy" style={{ marginTop: 8 }}>
              {roleLabel[user.role]}
            </span>
          </div>
          <Link to="/my-library">
            <BookMarked size={16} /> My Library
          </Link>
          <Link to="/notifications">
            <Bell size={16} /> Notifications
          </Link>
          <Link to="/account">
            <User size={16} /> Account settings
          </Link>
          <button
            onClick={() => {
              logout();
              navigate('/');
            }}
          >
            <LogOut size={16} /> Sign out
          </button>
        </div>
      )}
    </div>
  );
}

export default function Layout() {
  const { user, counts, isLibrarian } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();
  useEffect(() => {
    setMenuOpen(false);
    window.scrollTo(0, 0);
  }, [location.pathname]);

  return (
    <>
      <header className="header">
        <div className="container">
          <Brand />
          <nav className={`nav ${menuOpen ? 'open' : ''}`}>
            <NavLink to="/books">
              <Library size={16} /> Catalogue
            </NavLink>
            {user && (
              <NavLink to="/my-library">
                <BookMarked size={16} /> My Library
                {counts.ready > 0 && <span className="badge badge-green" style={{ height: 20 }}>{counts.ready}</span>}
              </NavLink>
            )}
            {isLibrarian && (
              <>
                <NavLink to="/admin" end>
                  <LayoutDashboard size={16} /> Dashboard
                </NavLink>
                <NavLink to="/admin/circulation">
                  <ArrowLeftRight size={16} /> Circulation
                </NavLink>
                <NavLink to="/admin/books">
                  <BookCopy size={16} /> Books
                </NavLink>
                <NavLink to="/admin/users">
                  <Users size={16} /> Members
                </NavLink>
                <NavLink to="/admin/emails">
                  <Mail size={16} /> Emails
                </NavLink>
              </>
            )}
          </nav>
          <div className="header-actions">
            {user ? (
              <>
                <Link to="/notifications" className="icon-btn" aria-label="Notifications">
                  <Bell size={19} />
                  {counts.unread > 0 && <span className="dot-badge">{counts.unread > 9 ? '9+' : counts.unread}</span>}
                </Link>
                <UserMenu />
              </>
            ) : (
              <>
                <Link to="/login" className="btn btn-ghost btn-sm">
                  <LogIn size={15} /> Sign in
                </Link>
                <Link to="/register" className="btn btn-primary btn-sm">
                  Join
                </Link>
              </>
            )}
            <button className="icon-btn mobile-toggle" onClick={() => setMenuOpen((o) => !o)} aria-label="Menu">
              <Menu size={20} />
            </button>
          </div>
        </div>
      </header>
      <main>
        <Outlet />
      </main>
      <footer className="footer">
        <div className="container">
          <span>© {new Date().getFullYear()} CST Library · College of Science and Technology, Royal University of Bhutan</span>
          <span>Cloud-native on AWS Elastic Beanstalk · RDS PostgreSQL · SQS · Lambda · SES</span>
        </div>
      </footer>
    </>
  );
}
