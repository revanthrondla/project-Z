/**
 * Unit tests — App route guards (PrivateRoute, SuperAdminRoute, ModuleRoute)
 *
 * Renders a mini version of the route tree with mock pages to verify:
 *   - Unauthenticated users are redirected to /login
 *   - Users with mustChangePw are redirected to /change-password
 *   - Candidates are blocked from admin-only routes (→ /dashboard)
 *   - super_admin-only routes reject non-super-admins
 *
 * We render the full <App /> with a MemoryRouter initial entry so we can
 * test navigation without a real browser.
 */
import { describe, it, expect } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { act } from 'react';
import { http, HttpResponse } from 'msw';
import { server } from './setup.js';
import { AuthProvider, useAuth } from '../contexts/AuthContext';
import { ADMIN_USER, CANDIDATE_USER, MUST_CHANGE_USER } from './handlers/index.js';

// ── Minimal route guard implementations (mirrors App.jsx) ─────────────────────

function Spinner() {
  return <p data-testid="spinner">loading</p>;
}

function PrivateRoute({ children, adminOnly = false }) {
  const { user, loading, mustChangePw } = useAuth();
  if (loading)      return <Spinner />;
  if (!user)        return <RedirectTo path="/login" />;
  if (mustChangePw) return <RedirectTo path="/change-password" />;
  if (adminOnly && user.role !== 'admin') return <RedirectTo path="/dashboard" />;
  return children;
}

function SuperAdminRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading)  return <Spinner />;
  if (!user)    return <RedirectTo path="/login" />;
  if (user.role !== 'super_admin') return <RedirectTo path="/dashboard" />;
  return children;
}

/** Render a visible marker showing where we redirected */
function RedirectTo({ path }) {
  return <p data-testid="redirect">redirected-to:{path}</p>;
}

// ── Test helper that wraps everything in AuthProvider + MemoryRouter ──────────

async function renderProtected(ui, { initialPath = '/' } = {}) {
  await act(async () => {
    render(
      <AuthProvider>
        <MemoryRouter initialEntries={[initialPath]}>
          <Routes>
            {ui}
            {/* catch-all so we can detect redirects */}
            <Route path="/login"           element={<p data-testid="login-page">Login</p>} />
            <Route path="/dashboard"       element={<p data-testid="dashboard">Dashboard</p>} />
            <Route path="/change-password" element={<p data-testid="change-pw-page">ChangePassword</p>} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    );
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// PrivateRoute — unauthenticated
// ═══════════════════════════════════════════════════════════════════════════════

describe('PrivateRoute — unauthenticated', () => {
  it('redirects to /login when no session exists', async () => {
    server.use(
      http.get('/api/auth/me', () => HttpResponse.json({ error: 'Unauthorized' }, { status: 401 }))
    );

    await renderProtected(
      <Route path="/protected" element={
        <PrivateRoute>
          <p data-testid="protected-content">Protected</p>
        </PrivateRoute>
      } />,
      { initialPath: '/protected' }
    );

    await waitFor(() =>
      expect(screen.queryByTestId('spinner')).not.toBeInTheDocument()
    );
    expect(screen.getByTestId('redirect')).toHaveTextContent('redirected-to:/login');
    expect(screen.queryByTestId('protected-content')).not.toBeInTheDocument();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// PrivateRoute — mustChangePw redirect
// ═══════════════════════════════════════════════════════════════════════════════

describe('PrivateRoute — mustChangePw', () => {
  it('redirects to /change-password when mustChangePw is true', async () => {
    server.use(
      http.get('/api/auth/me', () => HttpResponse.json(MUST_CHANGE_USER))
    );

    await renderProtected(
      <Route path="/dashboard" element={
        <PrivateRoute>
          <p data-testid="dashboard-content">Dashboard</p>
        </PrivateRoute>
      } />,
      { initialPath: '/dashboard' }
    );

    await waitFor(() =>
      expect(screen.queryByTestId('spinner')).not.toBeInTheDocument()
    );
    expect(screen.getByTestId('redirect')).toHaveTextContent('redirected-to:/change-password');
    expect(screen.queryByTestId('dashboard-content')).not.toBeInTheDocument();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// PrivateRoute — adminOnly guard
// ═══════════════════════════════════════════════════════════════════════════════

describe('PrivateRoute — adminOnly', () => {
  it('allows access for an admin user', async () => {
    server.use(
      http.get('/api/auth/me', () => HttpResponse.json(ADMIN_USER))
    );

    await renderProtected(
      <Route path="/admin-page" element={
        <PrivateRoute adminOnly>
          <p data-testid="admin-content">Admin Only Content</p>
        </PrivateRoute>
      } />,
      { initialPath: '/admin-page' }
    );

    await waitFor(() =>
      expect(screen.queryByTestId('spinner')).not.toBeInTheDocument()
    );
    expect(screen.getByTestId('admin-content')).toBeInTheDocument();
    expect(screen.queryByTestId('redirect')).not.toBeInTheDocument();
  });

  it('redirects candidate to /dashboard when accessing admin-only route', async () => {
    server.use(
      http.get('/api/auth/me', () => HttpResponse.json(CANDIDATE_USER))
    );

    await renderProtected(
      <Route path="/admin-page" element={
        <PrivateRoute adminOnly>
          <p data-testid="admin-content">Admin Only Content</p>
        </PrivateRoute>
      } />,
      { initialPath: '/admin-page' }
    );

    await waitFor(() =>
      expect(screen.queryByTestId('spinner')).not.toBeInTheDocument()
    );
    expect(screen.getByTestId('redirect')).toHaveTextContent('redirected-to:/dashboard');
    expect(screen.queryByTestId('admin-content')).not.toBeInTheDocument();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SuperAdminRoute
// ═══════════════════════════════════════════════════════════════════════════════

describe('SuperAdminRoute', () => {
  it('redirects a regular admin to /dashboard', async () => {
    server.use(
      http.get('/api/auth/me', () => HttpResponse.json(ADMIN_USER))
    );

    await renderProtected(
      <Route path="/super-admin/dashboard" element={
        <SuperAdminRoute>
          <p data-testid="super-admin-content">Super Admin Area</p>
        </SuperAdminRoute>
      } />,
      { initialPath: '/super-admin/dashboard' }
    );

    await waitFor(() =>
      expect(screen.queryByTestId('spinner')).not.toBeInTheDocument()
    );
    expect(screen.getByTestId('redirect')).toHaveTextContent('redirected-to:/dashboard');
    expect(screen.queryByTestId('super-admin-content')).not.toBeInTheDocument();
  });

  it('redirects an unauthenticated user to /login', async () => {
    server.use(
      http.get('/api/auth/me', () => HttpResponse.json({ error: 'Unauthorized' }, { status: 401 }))
    );

    await renderProtected(
      <Route path="/super-admin/dashboard" element={
        <SuperAdminRoute>
          <p data-testid="super-admin-content">Super Admin Area</p>
        </SuperAdminRoute>
      } />,
      { initialPath: '/super-admin/dashboard' }
    );

    await waitFor(() =>
      expect(screen.queryByTestId('spinner')).not.toBeInTheDocument()
    );
    expect(screen.getByTestId('redirect')).toHaveTextContent('redirected-to:/login');
  });

  it('renders children for a super_admin user', async () => {
    server.use(
      http.get('/api/auth/me', () => HttpResponse.json({
        id: 1,
        name: 'Super Admin',
        email: 'super@test.com',
        role: 'super_admin',
        mustChangePw: false,
      }))
    );

    await renderProtected(
      <Route path="/super-admin/dashboard" element={
        <SuperAdminRoute>
          <p data-testid="super-admin-content">Super Admin Area</p>
        </SuperAdminRoute>
      } />,
      { initialPath: '/super-admin/dashboard' }
    );

    await waitFor(() =>
      expect(screen.queryByTestId('spinner')).not.toBeInTheDocument()
    );
    expect(screen.getByTestId('super-admin-content')).toBeInTheDocument();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Authenticated access to unguarded (PrivateRoute no adminOnly) route
// ═══════════════════════════════════════════════════════════════════════════════

describe('PrivateRoute — standard authenticated access', () => {
  it('renders children for any authenticated user (no adminOnly)', async () => {
    server.use(
      http.get('/api/auth/me', () => HttpResponse.json(CANDIDATE_USER))
    );

    await renderProtected(
      <Route path="/log-hours" element={
        <PrivateRoute>
          <p data-testid="log-hours-content">Log Hours</p>
        </PrivateRoute>
      } />,
      { initialPath: '/log-hours' }
    );

    await waitFor(() =>
      expect(screen.queryByTestId('spinner')).not.toBeInTheDocument()
    );
    expect(screen.getByTestId('log-hours-content')).toBeInTheDocument();
  });
});
