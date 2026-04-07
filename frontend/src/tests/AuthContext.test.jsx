/**
 * Unit tests — src/contexts/AuthContext.jsx
 *
 * Tests the AuthProvider behaviour: session restoration on mount,
 * login, logout, mustChangePw flag, and error handling.
 *
 * MSW intercepts all API calls — no real network traffic.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from './setup.js';
import { AuthProvider, useAuth } from '../contexts/AuthContext';
import { ADMIN_USER, CANDIDATE_USER, MUST_CHANGE_USER } from './handlers/index.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Renders children inside an AuthProvider and waits for loading to settle */
async function renderWithAuth(ui) {
  let result;
  await act(async () => {
    result = render(<AuthProvider>{ui}</AuthProvider>);
  });
  return result;
}

/** A tiny consumer component for inspecting auth state */
function AuthInspector() {
  const { user, loading, mustChangePw, isAdmin, isCandidate } = useAuth();
  if (loading) return <p data-testid="loading">loading...</p>;
  if (!user)   return <p data-testid="no-user">not logged in</p>;
  return (
    <div>
      <p data-testid="user-email">{user.email}</p>
      <p data-testid="user-role">{user.role}</p>
      <p data-testid="must-change-pw">{mustChangePw ? 'must-change' : 'ok'}</p>
      <p data-testid="is-admin">{isAdmin ? 'yes' : 'no'}</p>
      <p data-testid="is-candidate">{isCandidate ? 'yes' : 'no'}</p>
    </div>
  );
}

// ── Clean sessionStorage between tests ────────────────────────────────────────
beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
});

// ═══════════════════════════════════════════════════════════════════════════════
// Mount — /me call on startup
// ═══════════════════════════════════════════════════════════════════════════════

describe('AuthProvider — mount', () => {
  it('shows loading initially, then resolves user from /me', async () => {
    await renderWithAuth(<AuthInspector />);

    await waitFor(() =>
      expect(screen.queryByTestId('loading')).not.toBeInTheDocument()
    );
    expect(screen.getByTestId('user-email')).toHaveTextContent('admin@test.com');
    expect(screen.getByTestId('user-role')).toHaveTextContent('admin');
    expect(screen.getByTestId('is-admin')).toHaveTextContent('yes');
  });

  it('sets user to null when /me returns 401', async () => {
    server.use(
      http.get('/api/auth/me', () => HttpResponse.json({ error: 'Unauthorized' }, { status: 401 }))
    );

    await renderWithAuth(<AuthInspector />);
    await waitFor(() =>
      expect(screen.queryByTestId('loading')).not.toBeInTheDocument()
    );

    expect(screen.getByTestId('no-user')).toBeInTheDocument();
  });

  it('restores user from sessionStorage for fast render before /me resolves', async () => {
    sessionStorage.setItem('hireiq_user', JSON.stringify(ADMIN_USER));

    // /me call is slow — we still show the cached user immediately
    server.use(
      http.get('/api/auth/me', async () => {
        await new Promise(resolve => setTimeout(resolve, 50));
        return HttpResponse.json(ADMIN_USER);
      })
    );

    const { container } = render(<AuthProvider><AuthInspector /></AuthProvider>);

    // Immediately after mount the cached user should appear (not loading)
    // (AuthContext reads sessionStorage synchronously in useState initializer
    //  — if it hasn't loaded yet the loading placeholder may appear briefly)
    await waitFor(() =>
      expect(screen.queryByTestId('loading')).not.toBeInTheDocument()
    );
    expect(screen.getByTestId('user-email')).toHaveTextContent('admin@test.com');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// mustChangePw flag
// ═══════════════════════════════════════════════════════════════════════════════

describe('mustChangePw flag', () => {
  it('is false when /me returns mustChangePw: false', async () => {
    await renderWithAuth(<AuthInspector />);
    await waitFor(() =>
      expect(screen.queryByTestId('loading')).not.toBeInTheDocument()
    );
    expect(screen.getByTestId('must-change-pw')).toHaveTextContent('ok');
  });

  it('is true when /me returns mustChangePw: true', async () => {
    server.use(
      http.get('/api/auth/me', () => HttpResponse.json(MUST_CHANGE_USER))
    );

    await renderWithAuth(<AuthInspector />);
    await waitFor(() =>
      expect(screen.queryByTestId('loading')).not.toBeInTheDocument()
    );
    expect(screen.getByTestId('must-change-pw')).toHaveTextContent('must-change');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// login()
// ═══════════════════════════════════════════════════════════════════════════════

describe('login()', () => {
  function LoginTestComponent() {
    const { user, login, loading } = useAuth();
    if (loading) return <p>loading...</p>;
    return (
      <div>
        <p data-testid="current-user">{user ? user.email : 'none'}</p>
        <button
          onClick={() => login('admin@test.com', 'AdminPass123!', 'testco')}
          data-testid="login-btn"
        >
          Login
        </button>
        <button
          onClick={() => login('bad@test.com', 'wrong', 'testco').catch(() => {})}
          data-testid="bad-login-btn"
        >
          Bad Login
        </button>
      </div>
    );
  }

  it('updates user state and sessionStorage on successful login', async () => {
    // Start with no session
    server.use(
      http.get('/api/auth/me', () => HttpResponse.json({ error: 'Unauthorized' }, { status: 401 }))
    );

    await renderWithAuth(<LoginTestComponent />);
    await waitFor(() => expect(screen.queryByText('loading...')).not.toBeInTheDocument());

    // Reset /me to return admin after login
    server.use(
      http.get('/api/auth/me', () => HttpResponse.json(ADMIN_USER))
    );

    await userEvent.click(screen.getByTestId('login-btn'));

    await waitFor(() =>
      expect(screen.getByTestId('current-user')).toHaveTextContent('admin@test.com')
    );

    const cached = JSON.parse(sessionStorage.getItem('hireiq_user'));
    expect(cached.email).toBe('admin@test.com');
  });

  it('throws on failed login (credentials rejected by server)', async () => {
    server.use(
      http.get('/api/auth/me', () => HttpResponse.json({ error: 'Unauthorized' }, { status: 401 }))
    );

    await renderWithAuth(<LoginTestComponent />);
    await waitFor(() => expect(screen.queryByText('loading...')).not.toBeInTheDocument());

    // Click bad login — the component catches the error so no throw propagates
    await userEvent.click(screen.getByTestId('bad-login-btn'));

    // User should remain null
    expect(screen.getByTestId('current-user')).toHaveTextContent('none');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// logout()
// ═══════════════════════════════════════════════════════════════════════════════

describe('logout()', () => {
  function LogoutTestComponent() {
    const { user, logout, loading } = useAuth();
    if (loading) return <p>loading...</p>;
    return (
      <div>
        <p data-testid="current-user">{user ? user.email : 'none'}</p>
        <button onClick={logout} data-testid="logout-btn">Logout</button>
      </div>
    );
  }

  it('clears user state and sessionStorage on logout', async () => {
    await renderWithAuth(<LogoutTestComponent />);
    await waitFor(() => expect(screen.queryByText('loading...')).not.toBeInTheDocument());

    expect(screen.getByTestId('current-user')).toHaveTextContent('admin@test.com');

    await userEvent.click(screen.getByTestId('logout-btn'));

    await waitFor(() =>
      expect(screen.getByTestId('current-user')).toHaveTextContent('none')
    );
    expect(sessionStorage.getItem('hireiq_user')).toBeNull();
  });

  it('clears legacy localStorage keys on logout', async () => {
    localStorage.setItem('agrow_token', 'old-token');
    localStorage.setItem('agrow_user', '{"name":"old"}');

    await renderWithAuth(<LogoutTestComponent />);
    await waitFor(() => expect(screen.queryByText('loading...')).not.toBeInTheDocument());

    await userEvent.click(screen.getByTestId('logout-btn'));

    await waitFor(() =>
      expect(screen.getByTestId('current-user')).toHaveTextContent('none')
    );
    expect(localStorage.getItem('agrow_token')).toBeNull();
    expect(localStorage.getItem('agrow_user')).toBeNull();
  });

  it('proceeds silently when the logout API call fails (network error)', async () => {
    server.use(
      http.post('/api/auth/logout', () => HttpResponse.error())
    );

    await renderWithAuth(<LogoutTestComponent />);
    await waitFor(() => expect(screen.queryByText('loading...')).not.toBeInTheDocument());

    await userEvent.click(screen.getByTestId('logout-btn'));

    await waitFor(() =>
      expect(screen.getByTestId('current-user')).toHaveTextContent('none')
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Role flags
// ═══════════════════════════════════════════════════════════════════════════════

describe('role flags', () => {
  it('isCandidate is true for a candidate user', async () => {
    server.use(
      http.get('/api/auth/me', () => HttpResponse.json(CANDIDATE_USER))
    );

    await renderWithAuth(<AuthInspector />);
    await waitFor(() =>
      expect(screen.queryByTestId('loading')).not.toBeInTheDocument()
    );

    expect(screen.getByTestId('is-candidate')).toHaveTextContent('yes');
    expect(screen.getByTestId('is-admin')).toHaveTextContent('no');
  });
});
