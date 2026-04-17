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
    const cached = sessionStorage.getItem('flow_user');
    if (cached) {
      try { setUser(JSON.parse(cached)); } catch { /* ignore malformed cache */ }
    }

    api.get('/api/auth/me')
      .then(res => {
        setUser(res.data);
        sessionStorage.setItem('flow_user', JSON.stringify(res.data));
      })
      .catch(() => {
        // 401 handled by interceptor (redirect to /login)
        setUser(null);
        sessionStorage.removeItem('flow_user');
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
   *
   * Returns:
   *  - If MFA required: { mfaRequired: true, mfaToken, companySlug? }
   *  - Otherwise: { user } (same as before)
   */
  const login = async (email, password, companySlug) => {
    const payload = { email, password };
    if (companySlug) payload.companySlug = companySlug.trim().toLowerCase();

    const res = await api.post('/api/auth/login', payload);

    // Check if MFA is required
    if (res.data.mfaRequired) {
      return {
        mfaRequired: true,
        mfaToken: res.data.mfaToken,
        companySlug: companySlug,
      };
    }

    // Normal login path
    const { user } = res.data;

    // Cache user profile (contains no secrets — only id, name, role, etc.)
    sessionStorage.setItem('flow_user', JSON.stringify(user));
    setUser(user);
    return { user };
  };

  /**
   * verifyMfa(mfaToken, code)
   *  - mfaToken: token from login response
   *  - code: 6-digit code or 8-char backup code from authenticator app
   *
   * Calls POST /api/auth/mfa/verify, sets user on success
   */
  const verifyMfa = async (mfaToken, code) => {
    const res = await api.post('/api/auth/mfa/verify', {
      mfaToken,
      code: code.replace(/\s/g, ''), // Remove any whitespace
    });

    const { user } = res.data;

    // Cache user profile
    sessionStorage.setItem('flow_user', JSON.stringify(user));
    setUser(user);
    return user;
  };

  const logout = async () => {
    try { await api.post('/api/auth/logout'); } catch { /* ignore network errors */ }
    sessionStorage.removeItem('flow_user');
    // Remove legacy localStorage keys if present from an older session
    localStorage.removeItem('flow_token');
    localStorage.removeItem('flow_user');
    setUser(null);
  };

  /**
   * Re-fetch the current user from the server using the active session cookie.
   * Call this after any operation that changes the JWT payload (e.g. password
   * change clears mustChangePw) so the in-memory auth state stays in sync.
   */
  const refreshUser = async () => {
    try {
      const res = await api.get('/api/auth/me');
      setUser(res.data);
      sessionStorage.setItem('flow_user', JSON.stringify(res.data));
    } catch {
      setUser(null);
      sessionStorage.removeItem('flow_user');
    }
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
      verifyMfa,
      logout,
      refreshUser,
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
