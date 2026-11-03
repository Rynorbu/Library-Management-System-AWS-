import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, tokenStore, setUnauthorizedHandler } from '../lib/api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [counts, setCounts] = useState({ unread: 0, ready: 0, overdue: 0 });
  const [loading, setLoading] = useState(Boolean(tokenStore.get()));

  const logout = useCallback(() => {
    tokenStore.set(null);
    setUser(null);
    setCounts({ unread: 0, ready: 0, overdue: 0 });
  }, []);

  const refresh = useCallback(async () => {
    if (!tokenStore.get()) return setLoading(false);
    try {
      const data = await api('/auth/me');
      setUser(data.user);
      setCounts(data.counts);
    } catch {
      logout();
    } finally {
      setLoading(false);
    }
  }, [logout]);

  useEffect(() => {
    setUnauthorizedHandler(logout);
    refresh();
  }, [refresh, logout]);

  // Keep the notification badge fresh
  useEffect(() => {
    if (!user) return;
    const id = setInterval(refresh, 60_000);
    return () => clearInterval(id);
  }, [user, refresh]);

  const login = async (email, password) => {
    const data = await api('/auth/login', { method: 'POST', body: { email, password } });
    tokenStore.set(data.token);
    setUser(data.user);
    refresh();
    return data.user;
  };

  const register = async (payload) => {
    const data = await api('/auth/register', { method: 'POST', body: payload });
    tokenStore.set(data.token);
    setUser(data.user);
    refresh();
    return data.user;
  };

  const value = useMemo(
    () => ({ user, counts, loading, login, register, logout, refresh, setUser, isLibrarian: user?.role === 'librarian' }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [user, counts, loading, refresh, logout],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
