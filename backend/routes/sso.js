const express = require('express');
const https = require('node:https');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const querystring = require('querystring');
const { authenticate, requireAdmin, JWT_SECRET, injectTenantDb } = require('../middleware/auth');
const { masterDb } = require('../masterDatabase');
const { getTenantDb } = require('../database');

const router = express.Router();

// ── Environment configuration ──────────────────────────────────────────────────
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const BASE_URL = process.env.BASE_URL || 'http://localhost:3001';
const CALLBACK_URL = `${BASE_URL}/api/auth/sso/callback`;

// ── Cookie options ────────────────────────────────────────────────────────────
const COOKIE_NAME = 'flow_token';
function cookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'strict' : 'lax',
    maxAge: 8 * 60 * 60 * 1000,
    path: '/',
  };
}

/**
 * Helper: Make HTTPS request with node:https
 * Returns Promise<{ statusCode, body }>
 */
function httpsRequest(options, postData = null) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => {
        body += chunk;
      });
      res.on('end', () => {
        resolve({ statusCode: res.statusCode, body });
      });
    });

    req.on('error', reject);

    if (postData) {
      req.write(postData);
    }
    req.end();
  });
}

/**
 * Helper: Decode base64url (RFC 4648 Section 5) to JSON
 */
function base64urlDecode(str) {
  const padded = str + '='.repeat((4 - (str.length % 4)) % 4);
  const buf = Buffer.from(padded, 'base64');
  return JSON.parse(buf.toString('utf8'));
}

/**
 * Helper: Encode object to base64url (RFC 4648 Section 5)
 */
function base64urlEncode(obj) {
  const str = JSON.stringify(obj);
  return Buffer.from(str, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

// ──────────────────────────────────────────────────────────────────────────────
// GET /config?tenant=slug — public (no auth)
// ──────────────────────────────────────────────────────────────────────────────
router.get('/config', async (req, res) => {
  try {
    const { tenant } = req.query;
    if (!tenant) {
      return res.status(400).json({ error: 'tenant query param required' });
    }

    const tenantResult = await masterDb.query(
      'SELECT sso_enabled, sso_provider FROM tenants WHERE slug = $1',
      [tenant.toLowerCase().trim()]
    );

    const tenantRecord = tenantResult.rows[0];
    if (!tenantRecord) {
      return res.status(404).json({ error: 'Tenant not found' });
    }

    res.json({
      ssoEnabled: !!tenantRecord.sso_enabled,
      ssoProvider: tenantRecord.sso_provider || null,
      googleConfigured: !!(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET),
    });
  } catch (err) {
    console.error('[SSO /config] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// GET /admin-config — admin auth
// ──────────────────────────────────────────────────────────────────────────────
router.get('/admin-config', authenticate, injectTenantDb, requireAdmin, async (req, res) => {
  try {
    const tenantSlug = req.user.tenantSlug;
    if (!tenantSlug) {
      return res.status(403).json({ error: 'Only tenant admins can access this' });
    }

    const tenantResult = await masterDb.query(
      'SELECT sso_enabled, sso_provider, sso_domain, mfa_policy, mfa_methods FROM tenants WHERE slug = $1',
      [tenantSlug]
    );

    const t = tenantResult.rows[0];
    if (!t) return res.status(404).json({ error: 'Tenant not found' });

    res.json({
      ssoEnabled:       !!t.sso_enabled,
      ssoProvider:      t.sso_provider || 'google',
      ssoDomain:        t.sso_domain   || '',
      mfaPolicy:        t.mfa_policy   || 'off',
      mfaMethods:       t.mfa_methods  || ['totp'],
      googleConfigured: !!(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET),
    });
  } catch (err) {
    console.error('[SSO /admin-config] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// PUT /admin-config — admin auth
// Body: { ssoEnabled, ssoProvider, ssoDomain, mfaRequired }
// ──────────────────────────────────────────────────────────────────────────────
router.put('/admin-config', authenticate, injectTenantDb, requireAdmin, async (req, res) => {
  try {
    const { ssoEnabled, ssoProvider, ssoDomain, mfaPolicy, mfaMethods } = req.body;
    const tenantSlug = req.user.tenantSlug;
    if (!tenantSlug) return res.status(403).json({ error: 'Only tenant admins can access this' });

    const VALID_POLICIES = ['off', 'optional', 'required', 'admin_required'];
    const VALID_PROVIDERS = ['google', 'microsoft'];
    if (mfaPolicy && !VALID_POLICIES.includes(mfaPolicy)) {
      return res.status(400).json({ error: `Invalid mfaPolicy. Allowed: ${VALID_POLICIES.join(', ')}` });
    }
    if (ssoProvider && !VALID_PROVIDERS.includes(ssoProvider)) {
      return res.status(400).json({ error: `Invalid ssoProvider. Allowed: ${VALID_PROVIDERS.join(', ')}` });
    }
    if (mfaMethods && (!Array.isArray(mfaMethods) || mfaMethods.some(m => !['totp','email_otp'].includes(m)))) {
      return res.status(400).json({ error: 'Invalid mfaMethods. Allowed values: totp, email_otp' });
    }

    await masterDb.query(
      `UPDATE tenants SET
        sso_enabled  = COALESCE($1, sso_enabled),
        sso_provider = COALESCE($2, sso_provider),
        sso_domain   = $3,
        mfa_policy   = COALESCE($4, mfa_policy),
        mfa_methods  = COALESCE($5, mfa_methods),
        updated_at   = NOW()
       WHERE slug = $6`,
      [
        ssoEnabled  !== undefined ? !!ssoEnabled       : null,
        ssoProvider || null,
        ssoDomain !== undefined ? (ssoDomain?.toLowerCase().trim() || null) : undefined,
        mfaPolicy   || null,
        mfaMethods  ? JSON.stringify(mfaMethods) : null,
        tenantSlug,
      ]
    );

    res.json({ message: 'Security configuration updated' });
  } catch (err) {
    console.error('[SSO PUT /admin-config] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// GET /google?tenant=slug — public
// Redirect to Google OAuth with state
// ──────────────────────────────────────────────────────────────────────────────
router.get('/google', async (req, res) => {
  try {
    const { tenant } = req.query;
    if (!tenant) {
      return res.status(400).json({ error: 'tenant query param required' });
    }

    if (!GOOGLE_CLIENT_ID) {
      return res.status(500).json({ error: 'Google SSO not configured' });
    }

    // Create state: base64url-encoded { tenant, nonce }
    const nonce = crypto.randomBytes(16).toString('hex');
    const stateObj = { tenant: tenant.toLowerCase().trim(), nonce };
    const state = base64urlEncode(stateObj);

    // Build Google OAuth URL
    const params = querystring.stringify({
      client_id: GOOGLE_CLIENT_ID,
      redirect_uri: CALLBACK_URL,
      response_type: 'code',
      scope: 'openid email profile',
      prompt: 'select_account',
      state,
    });

    const googleOAuthUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
    res.redirect(googleOAuthUrl);
  } catch (err) {
    console.error('[SSO /google] Error:', err.message);
    res.redirect(`/login?sso_error=${encodeURIComponent('Failed to initiate SSO')}`);
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// GET /callback — public (OAuth callback from Google)
// ──────────────────────────────────────────────────────────────────────────────
router.get('/callback', async (req, res) => {
  try {
    const { code, state, error, error_description } = req.query;

    // Check for OAuth errors from Google
    if (error) {
      const msg = error_description || error;
      return res.redirect(`/login?sso_error=${encodeURIComponent(msg)}`);
    }

    if (!code || !state) {
      return res.redirect(`/login?sso_error=${encodeURIComponent('Missing code or state')}`);
    }

    // Decode state to get tenantSlug
    let tenantSlug, nonce;
    try {
      const stateObj = base64urlDecode(state);
      tenantSlug = stateObj.tenant;
      nonce = stateObj.nonce;
    } catch (err) {
      return res.redirect(`/login?sso_error=${encodeURIComponent('Invalid state')}`);
    }

    // ── Exchange code for token ────────────────────────────────────────────────
    const tokenData = querystring.stringify({
      code,
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      redirect_uri: CALLBACK_URL,
      grant_type: 'authorization_code',
    });

    const tokenResponse = await httpsRequest(
      {
        hostname: 'oauth2.googleapis.com',
        path: '/token',
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(tokenData),
        },
      },
      tokenData
    );

    if (tokenResponse.statusCode !== 200) {
      console.error('[SSO /callback] Token exchange failed:', tokenResponse.body);
      return res.redirect(`/login?sso_error=${encodeURIComponent('Token exchange failed')}`);
    }

    let tokenBody;
    try {
      tokenBody = JSON.parse(tokenResponse.body);
    } catch {
      return res.redirect(`/login?sso_error=${encodeURIComponent('Invalid token response')}`);
    }

    const accessToken = tokenBody.access_token;
    if (!accessToken) {
      return res.redirect(`/login?sso_error=${encodeURIComponent('No access token received')}`);
    }

    // ── Get user info from Google ──────────────────────────────────────────────
    const userInfoResponse = await httpsRequest({
      hostname: 'www.googleapis.com',
      path: `/oauth2/v3/userinfo?access_token=${encodeURIComponent(accessToken)}`,
      method: 'GET',
    });

    if (userInfoResponse.statusCode !== 200) {
      console.error('[SSO /callback] User info fetch failed:', userInfoResponse.body);
      return res.redirect(`/login?sso_error=${encodeURIComponent('Failed to fetch user info')}`);
    }

    let userInfo;
    try {
      userInfo = JSON.parse(userInfoResponse.body);
    } catch {
      return res.redirect(`/login?sso_error=${encodeURIComponent('Invalid user info response')}`);
    }

    const { email, name } = userInfo;
    if (!email) {
      return res.redirect(`/login?sso_error=${encodeURIComponent('Email not provided by Google')}`);
    }

    // ── Check tenant exists and SSO enabled ─────────────────────────────────────
    const tenantResult = await masterDb.query(
      'SELECT id, slug, sso_enabled, sso_domain FROM tenants WHERE slug = $1',
      [tenantSlug]
    );

    const tenant = tenantResult.rows[0];
    if (!tenant) {
      return res.redirect(`/login?sso_error=${encodeURIComponent('Tenant not found')}`);
    }

    if (!tenant.sso_enabled) {
      return res.redirect(`/login?sso_error=${encodeURIComponent('SSO not enabled for this tenant')}`);
    }

    // ── Check domain restriction (if sso_domain is set) ─────────────────────────
    if (tenant.sso_domain) {
      const emailDomain = email.split('@')[1];
      if (emailDomain !== tenant.sso_domain.toLowerCase()) {
        return res.redirect(`/login?sso_error=${encodeURIComponent('Email domain not allowed')}`);
      }
    }

    // ── Find or create user in tenant DB ───────────────────────────────────────
    const { wrapper: tenantDb, release: tenantRelease } = await getTenantDb(tenantSlug);

    try {
      const userResult = await tenantDb.query(
        'SELECT id, name, email, role FROM users WHERE email = $1',
        [email.toLowerCase()]
      );

      let user = userResult.rows[0];

      if (!user) {
        // Create new user with role 'candidate' and random 32-byte password hash
        const randomPassword = crypto.randomBytes(32).toString('hex');
        const passwordHash = await bcrypt.hash(randomPassword, 10);

        const createResult = await tenantDb.query(
          `INSERT INTO users (name, email, password_hash, role, must_change_password, created_at, updated_at)
           VALUES ($1, $2, $3, 'candidate', FALSE, NOW(), NOW())
           RETURNING id, name, email, role`,
          [name || email.split('@')[0], email.toLowerCase(), passwordHash]
        );

        user = createResult.rows[0];
      }

      // Get candidateId if applicable
      let candidateId = null;
      if (user.role === 'candidate') {
        const candResult = await tenantDb.query('SELECT id FROM candidates WHERE user_id = $1', [user.id]);
        const cand = candResult.rows[0];
        if (cand) candidateId = cand.id;
      }

      // Get clientId if applicable
      let clientId = null;
      if (user.role === 'client') {
        const clientRecResult = await tenantDb.query('SELECT id FROM clients WHERE user_id = $1', [user.id]);
        const clientRec = clientRecResult.rows[0];
        if (clientRec) clientId = clientRec.id;
      }

      // Issue JWT
      const token = jwt.sign(
        {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          candidateId,
          clientId,
          tenantSlug: tenant.slug,
          tenantName: tenant.company_name || tenant.slug,
          mustChangePw: false,
        },
        JWT_SECRET,
        { expiresIn: '8h' }
      );

      // Set cookie and redirect
      res.cookie(COOKIE_NAME, token, cookieOptions());
      res.redirect(`/dashboard?token=${encodeURIComponent(token)}`);
    } finally {
      tenantRelease();
    }
  } catch (err) {
    console.error('[SSO /callback] Unhandled error:', err.message);
    res.redirect(`/login?sso_error=${encodeURIComponent('SSO login failed')}`);
  }
});

module.exports = router;
