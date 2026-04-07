/**
 * JWT token factory helpers for tests.
 *
 * All tokens are signed with the test JWT_SECRET set in tests/setup.js so they
 * will be accepted by the authenticate() middleware when it reads from the same
 * env var.
 *
 * Usage:
 *   const { makeAdminToken, makeCandidateToken } = require('../helpers/tokens');
 *   const token = makeAdminToken();              // standard admin, tenant 'testco'
 *   const cand  = makeCandidateToken({ id: 5 }); // override any field
 */
'use strict';

const jwt = require('jsonwebtoken');

// Matches tests/setup.js
const SECRET = process.env.JWT_SECRET || 'test-jwt-secret-hireiq-do-not-use-in-prod';
const TENANT_SLUG = 'testco';
const TENANT_NAME = 'Test Company';

// Default expiry: 1 hour from "now" (plenty for any single test run)
const DEFAULT_EXP = '1h';

/**
 * Low-level factory — merge caller overrides on top of base payload.
 */
function makeToken(base, overrides = {}, options = {}) {
  const payload = { ...base, ...overrides };
  const signOpts = { expiresIn: DEFAULT_EXP, ...options };

  // Allow callers to sign with a different secret to produce invalid tokens
  const secret = overrides._secret || SECRET;
  delete payload._secret; // never embed _secret in the actual JWT payload

  return jwt.sign(payload, secret, signOpts);
}

// ── Admin ─────────────────────────────────────────────────────────────────────

/**
 * Returns a signed JWT for an admin user in the test tenant.
 * @param {Object} overrides  - merge into the payload (e.g. { id: 99 })
 */
function makeAdminToken(overrides = {}) {
  return makeToken(
    {
      id: 1,
      email: 'admin@test.com',
      name: 'Test Admin',
      role: 'admin',
      candidateId: null,
      clientId: null,
      tenantSlug: TENANT_SLUG,
      tenantName: TENANT_NAME,
      mustChangePw: false,
    },
    overrides
  );
}

// ── Candidate ─────────────────────────────────────────────────────────────────

/**
 * Returns a signed JWT for candidate user alice@test.com.
 * @param {Object} overrides
 */
function makeCandidateToken(overrides = {}) {
  return makeToken(
    {
      id: 2,
      email: 'alice@test.com',
      name: 'Alice Smith',
      role: 'candidate',
      candidateId: 1,
      clientId: null,
      tenantSlug: TENANT_SLUG,
      tenantName: TENANT_NAME,
      mustChangePw: false,
    },
    overrides
  );
}

// ── Client portal ─────────────────────────────────────────────────────────────

/**
 * Returns a signed JWT for client portal user john@client.com.
 * @param {Object} overrides
 */
function makeClientToken(overrides = {}) {
  return makeToken(
    {
      id: 6,
      email: 'john@client.com',
      name: 'John Client',
      role: 'client',
      candidateId: null,
      clientId: 1,
      tenantSlug: TENANT_SLUG,
      tenantName: TENANT_NAME,
      mustChangePw: false,
    },
    overrides
  );
}

// ── Super-admin ───────────────────────────────────────────────────────────────

/**
 * Returns a signed JWT for a super-admin (no tenant).
 * @param {Object} overrides
 */
function makeSuperAdminToken(overrides = {}) {
  return makeToken(
    {
      id: 1,
      email: 'super@test.com',
      name: 'Super Admin',
      role: 'super_admin',
    },
    overrides
  );
}

// ── Invalid / edge-case tokens ────────────────────────────────────────────────

/** Signed with the wrong secret — should fail authenticate(). */
function makeWrongSecretToken(baseOverrides = {}) {
  return makeAdminToken({ ...baseOverrides, _secret: 'this-is-not-the-right-secret' });
}

/** Expired token — iat/exp in the past. */
function makeExpiredToken(baseOverrides = {}) {
  const payload = {
    id: 1,
    email: 'admin@test.com',
    name: 'Test Admin',
    role: 'admin',
    tenantSlug: TENANT_SLUG,
    tenantName: TENANT_NAME,
    mustChangePw: false,
    ...baseOverrides,
  };
  // Sign with a past expiry by manipulating the exp claim directly
  return jwt.sign(payload, SECRET, { expiresIn: -1 }); // -1s → already expired
}

/**
 * Token with no `exp` claim — should be rejected by authenticate() which
 * enforces `!decoded.exp` → 401.
 */
function makeNoExpToken(baseOverrides = {}) {
  const payload = {
    id: 1,
    email: 'admin@test.com',
    name: 'Test Admin',
    role: 'admin',
    tenantSlug: TENANT_SLUG,
    tenantName: TENANT_NAME,
    mustChangePw: false,
    ...baseOverrides,
  };
  // Pass noTimestamp AND no expiresIn to produce a token with no exp field
  return jwt.sign(payload, SECRET, { noTimestamp: true });
}

module.exports = {
  makeAdminToken,
  makeCandidateToken,
  makeClientToken,
  makeSuperAdminToken,
  makeWrongSecretToken,
  makeExpiredToken,
  makeNoExpToken,
  SECRET,
  TENANT_SLUG,
};
