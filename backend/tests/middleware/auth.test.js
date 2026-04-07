/**
 * Unit tests — middleware/auth.js
 *
 * These are pure unit tests: no HTTP server, no database.
 * Each middleware function is called directly with mock req/res/next objects.
 *
 * Coverage goals:
 *   authenticate    — cookie path, Bearer-header path, missing token,
 *                     expired token, wrong secret, missing exp claim
 *   requireAdmin    — passes when role=admin, 403 otherwise
 *   requireSuperAdmin — passes when role=super_admin, 403 otherwise
 */
'use strict';

// setup.js already set JWT_SECRET before this module is first required
const {
  authenticate,
  requireAdmin,
  requireSuperAdmin,
} = require('../../middleware/auth');

const {
  makeAdminToken,
  makeCandidateToken,
  makeClientToken,
  makeSuperAdminToken,
  makeWrongSecretToken,
  makeExpiredToken,
  makeNoExpToken,
} = require('../helpers/tokens');

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Build a minimal mock request */
function mockReq({ cookie, bearer, user } = {}) {
  const req = {
    cookies: {},
    headers: {},
    user,
  };
  if (cookie) req.cookies.hireiq_token = cookie;
  if (bearer) req.headers.authorization = `Bearer ${bearer}`;
  return req;
}

/** Build a mock response that captures status + json calls */
function mockRes() {
  const res = {};
  res.status = jest.fn(() => res);
  res.json   = jest.fn(() => res);
  return res;
}

const mockNext = jest.fn();

beforeEach(() => {
  mockNext.mockClear();
});

// ═══════════════════════════════════════════════════════════════════════════════
// authenticate()
// ═══════════════════════════════════════════════════════════════════════════════

describe('authenticate()', () => {
  describe('cookie path', () => {
    it('accepts a valid token from the httpOnly cookie', () => {
      const token = makeAdminToken();
      const req   = mockReq({ cookie: token });
      const res   = mockRes();

      authenticate(req, res, mockNext);

      expect(mockNext).toHaveBeenCalledTimes(1);
      expect(req.user).toBeDefined();
      expect(req.user.role).toBe('admin');
      expect(req.user.email).toBe('admin@test.com');
    });

    it('populates req.user with all JWT claims from the cookie', () => {
      const token = makeAdminToken({ id: 42, tenantSlug: 'testco' });
      const req   = mockReq({ cookie: token });
      const res   = mockRes();

      authenticate(req, res, mockNext);

      expect(req.user.id).toBe(42);
      expect(req.user.tenantSlug).toBe('testco');
      expect(mockNext).toHaveBeenCalled();
    });
  });

  describe('Authorization header path', () => {
    it('accepts a valid token from the Bearer header when no cookie present', () => {
      const token = makeCandidateToken();
      const req   = mockReq({ bearer: token });
      const res   = mockRes();

      authenticate(req, res, mockNext);

      expect(mockNext).toHaveBeenCalledTimes(1);
      expect(req.user.role).toBe('candidate');
    });

    it('prefers the cookie over the Authorization header', () => {
      const cookieToken  = makeAdminToken({ id: 1 });
      const headerToken  = makeCandidateToken({ id: 99 });
      const req = mockReq({ cookie: cookieToken, bearer: headerToken });
      const res = mockRes();

      authenticate(req, res, mockNext);

      // Should use the cookie payload (id: 1, admin)
      expect(req.user.role).toBe('admin');
      expect(req.user.id).toBe(1);
      expect(mockNext).toHaveBeenCalled();
    });

    it('ignores a malformed Authorization header (no Bearer prefix)', () => {
      const token = makeAdminToken();
      const req = {
        cookies: {},
        headers: { authorization: `Token ${token}` }, // wrong scheme
      };
      const res = mockRes();

      authenticate(req, res, mockNext);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ error: 'No token provided' });
      expect(mockNext).not.toHaveBeenCalled();
    });
  });

  describe('missing / invalid tokens', () => {
    it('returns 401 when no cookie and no Authorization header', () => {
      const req = mockReq();
      const res = mockRes();

      authenticate(req, res, mockNext);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ error: 'No token provided' });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('returns 401 for a token signed with the wrong secret', () => {
      const token = makeWrongSecretToken();
      const req   = mockReq({ bearer: token });
      const res   = mockRes();

      authenticate(req, res, mockNext);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ error: 'Invalid or expired token' });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('returns 401 for an expired token', () => {
      const token = makeExpiredToken();
      const req   = mockReq({ bearer: token });
      const res   = mockRes();

      authenticate(req, res, mockNext);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ error: 'Invalid or expired token' });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('returns 401 for a token with no exp claim', () => {
      const token = makeNoExpToken();
      const req   = mockReq({ bearer: token });
      const res   = mockRes();

      authenticate(req, res, mockNext);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Token has no expiry — rejected for security',
      });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('returns 401 for a completely malformed token string', () => {
      const req = mockReq({ bearer: 'not.a.jwt' });
      const res = mockRes();

      authenticate(req, res, mockNext);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(mockNext).not.toHaveBeenCalled();
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// requireAdmin()
// ═══════════════════════════════════════════════════════════════════════════════

describe('requireAdmin()', () => {
  it('calls next() when req.user.role is "admin"', () => {
    const req = mockReq({ user: { role: 'admin' } });
    const res = mockRes();

    requireAdmin(req, res, mockNext);

    expect(mockNext).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('returns 403 when req.user.role is "candidate"', () => {
    const req = mockReq({ user: { role: 'candidate' } });
    const res = mockRes();

    requireAdmin(req, res, mockNext);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: 'Admin access required' });
    expect(mockNext).not.toHaveBeenCalled();
  });

  it('returns 403 when req.user.role is "client"', () => {
    const req = mockReq({ user: { role: 'client' } });
    const res = mockRes();

    requireAdmin(req, res, mockNext);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(mockNext).not.toHaveBeenCalled();
  });

  it('returns 403 when req.user.role is "super_admin"', () => {
    const req = mockReq({ user: { role: 'super_admin' } });
    const res = mockRes();

    requireAdmin(req, res, mockNext);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(mockNext).not.toHaveBeenCalled();
  });

  it('returns 403 when req.user is undefined', () => {
    const req = { cookies: {}, headers: {} }; // no .user at all
    const res = mockRes();

    requireAdmin(req, res, mockNext);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(mockNext).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// requireSuperAdmin()
// ═══════════════════════════════════════════════════════════════════════════════

describe('requireSuperAdmin()', () => {
  it('calls next() when req.user.role is "super_admin"', () => {
    const req = mockReq({ user: { role: 'super_admin' } });
    const res = mockRes();

    requireSuperAdmin(req, res, mockNext);

    expect(mockNext).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('returns 403 when req.user.role is "admin"', () => {
    const req = mockReq({ user: { role: 'admin' } });
    const res = mockRes();

    requireSuperAdmin(req, res, mockNext);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: 'Super-admin access required' });
    expect(mockNext).not.toHaveBeenCalled();
  });

  it('returns 403 when req.user.role is "candidate"', () => {
    const req = mockReq({ user: { role: 'candidate' } });
    const res = mockRes();

    requireSuperAdmin(req, res, mockNext);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(mockNext).not.toHaveBeenCalled();
  });

  it('returns 403 when req.user is undefined', () => {
    const req = { cookies: {}, headers: {} };
    const res = mockRes();

    requireSuperAdmin(req, res, mockNext);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(mockNext).not.toHaveBeenCalled();
  });
});
