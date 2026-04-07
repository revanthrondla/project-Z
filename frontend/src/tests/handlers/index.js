/**
 * MSW request handlers for frontend tests.
 *
 * These handlers intercept real HTTP requests made by the application code
 * (axios calls) and return controlled responses — no real network needed.
 *
 * Usage: imported by src/tests/setup.js which starts the MSW server.
 */
import { http, HttpResponse } from 'msw';

// ── Fixture data ─────────────────────────────────────────────────────────────

export const ADMIN_USER = {
  id: 1,
  name: 'Test Admin',
  email: 'admin@test.com',
  role: 'admin',
  tenantSlug: 'testco',
  tenantName: 'Test Company',
  mustChangePw: false,
};

export const CANDIDATE_USER = {
  id: 2,
  name: 'Alice Smith',
  email: 'alice@test.com',
  role: 'candidate',
  candidateId: 1,
  clientId: null,
  tenantSlug: 'testco',
  tenantName: 'Test Company',
  mustChangePw: false,
};

export const MUST_CHANGE_USER = {
  ...ADMIN_USER,
  mustChangePw: true,
};

// ── Default handlers (used in most tests) ────────────────────────────────────

export const handlers = [
  // GET /api/auth/me — authenticated by default
  http.get('/api/auth/me', () => {
    return HttpResponse.json(ADMIN_USER);
  }),

  // POST /api/auth/login — success by default
  http.post('/api/auth/login', async ({ request }) => {
    const body = await request.json();
    const { email, password } = body;

    if (email === 'admin@test.com' && password === 'AdminPass123!') {
      return HttpResponse.json({ user: ADMIN_USER, token: 'test-admin-token' });
    }
    if (email === 'alice@test.com' && password === 'CandPass123!') {
      return HttpResponse.json({ user: CANDIDATE_USER, token: 'test-cand-token' });
    }
    return HttpResponse.json({ error: 'Invalid credentials' }, { status: 401 });
  }),

  // POST /api/auth/logout
  http.post('/api/auth/logout', () => {
    return HttpResponse.json({ message: 'Logged out' });
  }),

  // PUT /api/auth/change-password
  http.put('/api/auth/change-password', async ({ request }) => {
    const body = await request.json();
    const { currentPassword, newPassword } = body;

    if (!newPassword || newPassword.length < 8) {
      return HttpResponse.json({ error: 'New password must be at least 8 characters' }, { status: 400 });
    }
    if (currentPassword !== 'AdminPass123!') {
      return HttpResponse.json({ error: 'Current password is incorrect' }, { status: 401 });
    }
    return HttpResponse.json({
      message: 'Password updated successfully',
      token: 'new-test-token',
    });
  }),

  // GET /api/modules — return all modules enabled
  http.get('/api/modules', () => {
    return HttpResponse.json([
      'hr_candidates', 'hr_clients', 'hr_timesheets', 'hr_absences',
      'hr_invoices', 'hr_jobs', 'hr_reports', 'hr_import', 'hr_documents',
    ]);
  }),
];
