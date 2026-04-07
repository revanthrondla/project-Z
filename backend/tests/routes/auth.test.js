/**
 * Integration tests — routes/auth.js
 *
 * Uses Supertest against a minimal Express app that mounts only the auth router.
 * Both masterDatabase and database modules are mocked so no real files are touched.
 *
 * Test matrix:
 *   POST /api/auth/login
 *     super-admin path  — success, wrong password, missing companySlug email not found
 *     tenant path       — success (admin, candidate, client), wrong password,
 *                         unknown tenant, suspended tenant, getTenantDb throws
 *   POST /api/auth/logout
 *     — clears cookie and returns 200
 *   GET  /api/auth/me
 *     — super-admin, tenant user, missing user in DB, unauthenticated
 *   PUT  /api/auth/change-password
 *     — success (tenant user, super-admin), wrong current password, too short
 */
'use strict';

const request     = require('supertest');
const express     = require('express');
const cookieParser = require('cookie-parser');

// ── In-memory databases ──────────────────────────────────────────────────────
const { createMasterTestDb, createTestDb, seedTenantData } = require('../helpers/db');
const { makeAdminToken, makeSuperAdminToken, makeCandidateToken } = require('../helpers/tokens');

// ── Module mocks (must come before any require of the modules under test) ─────

// Master DB mock
let mockMasterDb;
jest.mock('../../masterDatabase', () => ({ get masterDb() { return mockMasterDb; } }));

// Tenant DB mock
let mockTenantDb;
const mockGetTenantDb = jest.fn(() => mockTenantDb);
jest.mock('../../database', () => ({
  get db() { return mockTenantDb; },
  getTenantDb: (...args) => mockGetTenantDb(...args),
}));

// ── App factory ──────────────────────────────────────────────────────────────
function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/auth', require('../../routes/auth'));
  return app;
}

// ── Fixtures ─────────────────────────────────────────────────────────────────
let app, ids;

beforeAll(() => {
  mockMasterDb = createMasterTestDb();
  mockTenantDb = createTestDb();
  ids       = seedTenantData(mockTenantDb);
  app       = buildApp();
});

afterEach(() => {
  mockGetTenantDb.mockClear();
});

// ═══════════════════════════════════════════════════════════════════════════════
// POST /api/auth/login — super-admin path (no companySlug)
// ═══════════════════════════════════════════════════════════════════════════════

describe('POST /api/auth/login — super-admin path', () => {
  it('returns 200 + token + user for valid super-admin credentials', async () => {
    const res = await request(app).post('/api/auth/login').send({
      email:    'super@test.com',
      password: 'SuperPass123!',
    });

    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();
    expect(res.body.user.role).toBe('super_admin');
    expect(res.body.user.email).toBe('super@test.com');
    // Cookie should be set
    expect(res.headers['set-cookie']).toBeDefined();
    expect(res.headers['set-cookie'][0]).toMatch(/hireiq_token=/);
  });

  it('returns 401 when super-admin email is not found', async () => {
    const res = await request(app).post('/api/auth/login').send({
      email:    'nobody@test.com',
      password: 'SuperPass123!',
    });

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/credentials|organization/i);
  });

  it('returns 401 when super-admin password is wrong', async () => {
    const res = await request(app).post('/api/auth/login').send({
      email:    'super@test.com',
      password: 'WrongPassword!',
    });

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/invalid credentials/i);
  });

  it('returns 400 when email is omitted', async () => {
    const res = await request(app).post('/api/auth/login').send({ password: 'foo' });
    expect(res.status).toBe(400);
  });

  it('returns 400 when password is omitted', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'a@b.com' });
    expect(res.status).toBe(400);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// POST /api/auth/login — tenant path (companySlug provided)
// ═══════════════════════════════════════════════════════════════════════════════

describe('POST /api/auth/login — tenant path', () => {
  it('authenticates a tenant admin and returns mustChangePw in user object', async () => {
    const res = await request(app).post('/api/auth/login').send({
      email:       'admin@test.com',
      password:    'AdminPass123!',
      companySlug: 'testco',
    });

    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();
    expect(res.body.user.role).toBe('admin');
    expect(res.body.user.tenantSlug).toBe('testco');
    expect(typeof res.body.user.mustChangePw).toBe('boolean');
  });

  it('includes candidateId in JWT for a candidate user', async () => {
    const res = await request(app).post('/api/auth/login').send({
      email:       'alice@test.com',
      password:    'CandPass123!',
      companySlug: 'testco',
    });

    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe('candidate');
    expect(res.body.user.candidateId).toBe(ids.cand1Id);
    expect(res.body.user.clientId).toBeNull();
  });

  it('includes clientId in JWT for a client portal user', async () => {
    const res = await request(app).post('/api/auth/login').send({
      email:       'john@client.com',
      password:    'CliPass123!',
      companySlug: 'testco',
    });

    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe('client');
    expect(res.body.user.clientId).toBe(ids.client1Id);
    expect(res.body.user.candidateId).toBeNull();
  });

  it('returns 401 for wrong tenant user password', async () => {
    const res = await request(app).post('/api/auth/login').send({
      email:       'admin@test.com',
      password:    'WrongPassword!',
      companySlug: 'testco',
    });

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/invalid credentials/i);
  });

  it('returns 401 when tenant user email does not exist', async () => {
    const res = await request(app).post('/api/auth/login').send({
      email:       'ghost@test.com',
      password:    'AdminPass123!',
      companySlug: 'testco',
    });

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/invalid credentials/i);
  });

  it('returns 401 for an unknown companySlug', async () => {
    const res = await request(app).post('/api/auth/login').send({
      email:       'admin@test.com',
      password:    'AdminPass123!',
      companySlug: 'no-such-tenant',
    });

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/not found/i);
  });

  it('returns 403 for a suspended tenant', async () => {
    const res = await request(app).post('/api/auth/login').send({
      email:       'sus@test.com',
      password:    'anything',
      companySlug: 'suspended',
    });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/suspended/i);
  });

  it('returns 500 when getTenantDb throws', async () => {
    mockGetTenantDb.mockImplementationOnce(() => {
      throw new Error('disk I/O failure');
    });

    const res = await request(app).post('/api/auth/login').send({
      email:       'admin@test.com',
      password:    'AdminPass123!',
      companySlug: 'testco',
    });

    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/connect|database/i);
  });

  it('normalizes email to lowercase before lookup', async () => {
    const res = await request(app).post('/api/auth/login').send({
      email:       '  ADMIN@TEST.COM  ',
      password:    'AdminPass123!',
      companySlug: 'testco',
    });

    expect(res.status).toBe(200);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// POST /api/auth/logout
// ═══════════════════════════════════════════════════════════════════════════════

describe('POST /api/auth/logout', () => {
  it('returns 200 and clears the hireiq_token cookie', async () => {
    const res = await request(app).post('/api/auth/logout');

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/logged out/i);

    // Cookie should be cleared (max-age=0 or expires in the past)
    const setCookie = res.headers['set-cookie'];
    expect(setCookie).toBeDefined();
    const cookieStr = setCookie[0];
    expect(cookieStr).toMatch(/hireiq_token=;|hireiq_token=(?!.+\S)/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// GET /api/auth/me
// ═══════════════════════════════════════════════════════════════════════════════

describe('GET /api/auth/me', () => {
  it('returns 401 with no token', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
  });

  it('returns super-admin profile when authenticated as super_admin', async () => {
    const token = makeSuperAdminToken({ id: 1 });
    const res   = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.email).toBe('super@test.com');
    expect(res.body.role).toBe('super_admin');
  });

  it('returns tenant user profile when authenticated as admin', async () => {
    const token = makeAdminToken({ id: ids.adminId });
    const res   = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.email).toBe('admin@test.com');
    expect(res.body.role).toBe('admin');
  });

  it('returns 404 when super-admin record is missing from master DB', async () => {
    const token = makeSuperAdminToken({ id: 9999 }); // non-existent id
    const res   = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
  });

  it('returns 404 when tenant user record is missing from tenant DB', async () => {
    const token = makeAdminToken({ id: 9999 });
    const res   = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// PUT /api/auth/change-password
// ═══════════════════════════════════════════════════════════════════════════════

describe('PUT /api/auth/change-password', () => {
  it('returns 401 with no token', async () => {
    const res = await request(app).put('/api/auth/change-password').send({
      currentPassword: 'AdminPass123!',
      newPassword: 'NewPass123!',
    });
    expect(res.status).toBe(401);
  });

  it('successfully changes password for a tenant user', async () => {
    const token = makeAdminToken({ id: ids.adminId });
    const res   = await request(app)
      .put('/api/auth/change-password')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: 'AdminPass123!', newPassword: 'NewAdminPass123!' });

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/updated/i);
    expect(res.body.token).toBeDefined();

    // A fresh httpOnly cookie should be set
    expect(res.headers['set-cookie']).toBeDefined();
    expect(res.headers['set-cookie'][0]).toMatch(/hireiq_token=/);

    // Restore original password for subsequent tests
    const bcrypt = require('bcryptjs');
    const hash   = bcrypt.hashSync('AdminPass123!', 10);
    mockTenantDb.prepare('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?')
      .run(hash, ids.adminId);
  });

  it('returns 401 when currentPassword is wrong (tenant user)', async () => {
    const token = makeAdminToken({ id: ids.adminId });
    const res   = await request(app)
      .put('/api/auth/change-password')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: 'WrongPassword!', newPassword: 'NewAdminPass123!' });

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/incorrect/i);
  });

  it('returns 400 when newPassword is too short', async () => {
    const token = makeAdminToken({ id: ids.adminId });
    const res   = await request(app)
      .put('/api/auth/change-password')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: 'AdminPass123!', newPassword: 'short' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/6 characters|8 characters/i);
  });

  it('returns 400 when newPassword is missing', async () => {
    const token = makeAdminToken({ id: ids.adminId });
    const res   = await request(app)
      .put('/api/auth/change-password')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: 'AdminPass123!' });

    expect(res.status).toBe(400);
  });

  it('successfully changes password for a super-admin', async () => {
    const superToken = makeSuperAdminToken({ id: 1 });
    const res        = await request(app)
      .put('/api/auth/change-password')
      .set('Authorization', `Bearer ${superToken}`)
      .send({ currentPassword: 'SuperPass123!', newPassword: 'NewSuperPass123!' });

    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();

    // Restore original password
    const bcrypt = require('bcryptjs');
    const hash   = bcrypt.hashSync('SuperPass123!', 10);
    mockMasterDb.prepare('UPDATE super_admins SET password_hash = ? WHERE id = ?')
      .run(hash, 1);
  });

  it('returns 401 when currentPassword is wrong (super-admin)', async () => {
    const superToken = makeSuperAdminToken({ id: 1 });
    const res        = await request(app)
      .put('/api/auth/change-password')
      .set('Authorization', `Bearer ${superToken}`)
      .send({ currentPassword: 'WrongPassword!', newPassword: 'NewSuperPass123!' });

    expect(res.status).toBe(401);
  });
});
