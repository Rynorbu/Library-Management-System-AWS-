import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './context/AuthContext.jsx';
import Layout from './components/Layout.jsx';
import { Loading } from './components/ui.jsx';
import Home from './pages/Home.jsx';
import Catalogue from './pages/Catalogue.jsx';
import BookDetail from './pages/BookDetail.jsx';
import { Login, Register } from './pages/Auth.jsx';
import MyLibrary from './pages/MyLibrary.jsx';
import Notifications from './pages/Notifications.jsx';
import Account from './pages/Account.jsx';
import NotFound from './pages/NotFound.jsx';
import Dashboard from './pages/admin/Dashboard.jsx';
import Circulation from './pages/admin/Circulation.jsx';
import ManageBooks from './pages/admin/ManageBooks.jsx';
import Members from './pages/admin/Members.jsx';
import EmailLog from './pages/admin/EmailLog.jsx';

function RequireAuth({ children, role }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <Loading />;
  if (!user) return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  if (role && user.role !== role) return <Navigate to="/" replace />;
  return children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route element={<Layout />}>
        <Route path="/" element={<Home />} />
        <Route path="/books" element={<Catalogue />} />
        <Route path="/books/:id" element={<BookDetail />} />
        <Route path="/my-library" element={<RequireAuth><MyLibrary /></RequireAuth>} />
        <Route path="/notifications" element={<RequireAuth><Notifications /></RequireAuth>} />
        <Route path="/account" element={<RequireAuth><Account /></RequireAuth>} />
        <Route path="/admin" element={<RequireAuth role="librarian"><Dashboard /></RequireAuth>} />
        <Route path="/admin/circulation" element={<RequireAuth role="librarian"><Circulation /></RequireAuth>} />
        <Route path="/admin/books" element={<RequireAuth role="librarian"><ManageBooks /></RequireAuth>} />
        <Route path="/admin/users" element={<RequireAuth role="librarian"><Members /></RequireAuth>} />
        <Route path="/admin/emails" element={<RequireAuth role="librarian"><EmailLog /></RequireAuth>} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
