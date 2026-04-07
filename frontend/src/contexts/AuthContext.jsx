import React, { createContext, useContext, useState, useEffect } from 'react';
import api from '../api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser]       = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // On mount, attempt a fast restore from sessionStorage for instant render,
    // then verify the session via /me (the httpOnly cookie is sent automatically).
    // If the cookie has expired the /me call returns 401 → interceptor redirects.
    const cached = sessionStorage.getItem('hireiq_user');
    if (cached) {
      try { setUser(JSON.parse(cached)); } catch { /* ignore malformed cache */ }
    }

    api.get('/api/auth/me')
      .then(res => {
        setUser(res.data);
        sessionStorage.setItem('hireiq_user', JSON.stringify(res.data));
      })
      .catch(() => {
        // 401 handled by interceptor (redirect to /login)
        setUser(null);
        sessionStorage.removeItem('hireiq_user');
      })
      .finally(() => setLoading(false));
  }, []);

  /**
   * login(email, password, companySlug?)
   *  - companySlug absent/undefined → super-admin login (master DB)
   *  - companySlug provided         → tenant user login (tenant DB)
   *
   * The server sets an httpOnly cookie; we no longer store the token in the
   * browser — only the user profile for display purposes.
   */
  const login = async (email, password, companySlug) => {
    const payload = { email, password };
    if (companySlug) payload.companySlug = companySlug.trim().toLowerCase();

    const res = await api.post('/api/auth/login', payload);
    const { user } = res.data;

    // Cache user profile (contains no secrets — only id, name, role, etc.)
    sessionStorage.setItem('hireiq_user', JSON.stringify(user));
    setUser(user);
    return user;
  };

  const logout = async () => {
    try { await api.post('/api/auth/logout'); } catch { /* ignore network errors */ }
    sessionStorage.removeItem('hireiq_user');
    // Remove legacy localStorage keys if present from an older session
    localStorage.removeItem('agrow_token');
    localStorage.removeItem('agrow_user');
    setUser(null);
  };

  const isSuperAdmin  = user?.role === 'super_admin';
  const isAdmin       = user?.role === 'admin';
  const isCandidate   = user?.role === 'candidate';
  const isClient      = user?.role === 'client';
  /** True when this account requires a password change before use */
  const mustChangePw  = !!(user?.mustChangePw);

  return (
    <AuthContext.Provider value={{
      user,
      login,
      logout,
      loading,
      isSuperAdmin,
      isAdmin,
      isCandidate,
      isClient,
      mustChangePw,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
};
