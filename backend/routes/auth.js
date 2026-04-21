const express  = require('express');
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const { authenticate, injectTenantDb, JWT_SECRET } = require('../middleware/auth');
const { masterDb, indexUserEmail } = require('../masterDatabase');
const { getTenantDb, db: defaultDb } = require('../database');

// ── Fallback: scan all active tenant schemas for an email ─────────────────────
// Used when the user_tenant_index has no entry — covers users who were created
// before the index was introduced.  Backfills the index on every hit so
// subsequent logins are instant.
async function findTenantsByEmailScan(normalizedEmail) {
  const tenantsResult = await masterDb.query(
    "SELECT slug, company_name, status FROM tenants WHERE status != 'suspended' ORDER BY created_at"
  );

  const found = [];
  await Promise.all(
    tenantsResult.rows.map(async (tenant) => {
      let release;
      try {
        const { wrapper: tenantDb, release: rel } = await getTenantDb(tenant.slug);
        release = rel;
        const result = await tenantDb.query(
          'SELECT 1 FROM users WHERE email = $1 LIMIT 1',
          [normalizedEmail]
        );
        if (result.rows.length > 0) {
          found.push(tenant);
          // Backfill the index so next login is instant
          indexUserEmail(normalizedEmail, tenant.slug).catch(() => {});
        }
      } catch {
        // Tenant DB unreachable — skip silently
      } finally {
        if (release) release();
      }
    })
  );

  return found;
}


const router = express.Router();

// ── Cookie options ────────────────────────────────────────────────────────────
const COOKIE_NAME = 'flow_token';
function cookieOptions() {
  return {
    httpOnly: true,                                          // Not accessible via JS
    secure: process.env.NODE_ENV === 'production',           // HTTPS only in prod
    sameSite: process.env.NODE_ENV === 'production' ? 'strict' : 'lax',
    maxAge: 8 * 60 * 60 * 1000,                             // 8 hours in ms
    path: '/',
  };
}

// ── POST /api/auth/login ──────────────────────────────────────────────────────
// Body: { email, password, companySlug? }
//   - No companySlug → attempt super-admin login via master DB
//   - companySlug    → look up tenant, authenticate against their DB
router.post('/login', async (req, res) => {
  try {
    const { email, password, companySlug } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }

    const normalizedEmail = email.toLowerCase().trim();

    // ── No companySlug — try super-admin first, then auto-detect tenant ───────
    if (!companySlug) {
      // 1. Check super_admins
      const superAdminResult = await masterDb.query(
        'SELECT * FROM super_admins WHERE email = $1',
        [normalizedEmail]
      );
      const superAdmin = superAdminResult.rows[0];

      if (superAdmin) {
        const valid = bcrypt.compareSync(password, superAdmin.password_hash);
        if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

        // MFA check for super-admin
        if (superAdmin.mfa_enabled && superAdmin.mfa_secret) {
          const mfaToken = jwt.sign(
            { userId: superAdmin.id, email: superAdmin.email, name: superAdmin.name, role: 'super_admin', type: 'mfa_pending' },
            JWT_SECRET,
            { expiresIn: '2m' }
          );
          return res.json({ mfaRequired: true, mfaToken });
        }

        const token = jwt.sign(
          { id: superAdmin.id, email: superAdmin.email, name: superAdmin.name, role: 'super_admin' },
          JWT_SECRET,
          { expiresIn: '8h' }
        );

        res.cookie(COOKIE_NAME, token, cookieOptions());
        return res.json({
          token,
          user: { id: superAdmin.id, name: superAdmin.name, email: superAdmin.email, role: 'super_admin' },
        });
      }

      // 2. Not a super-admin — look up tenant(s) by email index
      const indexResult = await masterDb.query(
        `SELECT uti.tenant_slug, t.company_name, t.status
         FROM user_tenant_index uti
         JOIN tenants t ON t.slug = uti.tenant_slug
         WHERE uti.email = $1`,
        [normalizedEmail]
      );

      // If index misses, fall back to scanning all tenant schemas.
      // This covers users created before the index was introduced.
      // On a hit we backfill the index so next login is instant.
      let indexRows = indexResult.rows;
      if (indexRows.length === 0) {
        const scanned = await findTenantsByEmailScan(normalizedEmail);
        indexRows = scanned.map(r => ({ tenant_slug: r.slug, company_name: r.company_name, status: r.status }));
      }

      if (indexRows.length === 0) {
        // Genuinely no account anywhere — tell user to enter org code
        return res.status(401).json({
          error: 'No account found for this email. Please check your email or enter your organisation code.',
          requiresOrgCode: true,
        });
      }

      if (indexRows.length > 1) {
        // Multiple tenants — ask user to pick one
        const tenants = indexRows
          .filter(r => r.status !== 'suspended')
          .map(r => ({ slug: r.tenant_slug, name: r.company_name }));
        return res.json({
          multipleOrgs: true,
          tenants,
          message: 'Your email is associated with multiple organisations. Please select one.',
        });
      }

      // 3. Exactly one tenant — proceed automatically
      const autoTenant = indexRows[0];
      if (autoTenant.status === 'suspended') {
        return res.status(403).json({ error: 'This organisation account has been suspended' });
      }

      const autoTenantFull = await masterDb.query(
        'SELECT * FROM tenants WHERE slug = $1', [autoTenant.tenant_slug]
      );
      return await handleTenantLogin(res, autoTenantFull.rows[0], normalizedEmail, password);
    }

    // ── Tenant path (companySlug provided) ─────────────────────────────────────
    const tenantResult = await masterDb.query(
      'SELECT * FROM tenants WHERE slug = $1',
      [companySlug.toLowerCase().trim()]
    );
    const tenant = tenantResult.rows[0];

    if (!tenant) {
      return res.status(401).json({ error: `Organization '${companySlug}' not found` });
    }
    if (tenant.status === 'suspended') {
      return res.status(403).json({ error: 'This organization account has been suspended' });
    }

    return await handleTenantLogin(res, tenant, normalizedEmail, password);

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Shared tenant login handler ───────────────────────────────────────────────
// Used by both the explicit-slug path and the auto-detect path.
async function handleTenantLogin(res, tenant, normalizedEmail, password) {
  // getTenantDb returns { wrapper, release } — must await and destructure,
  // then release the pg client regardless of success or early return.
  let tenantRelease;
  try {
      const { wrapper: tenantDb, release } = await getTenantDb(tenant.slug);
      tenantRelease = release;

      const userResult = await tenantDb.query('SELECT * FROM users WHERE email = $1', [normalizedEmail]);
      const user = userResult.rows[0];
      if (!user) return res.status(401).json({ error: 'Invalid credentials' });

      const valid = bcrypt.compareSync(password, user.password_hash);
      if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

      // ── Resolve linked IDs (needed for MFA token and session token) ────────────
      let candidateId = null;
      if (user.role === 'candidate') {
        const candResult = await tenantDb.query('SELECT id FROM candidates WHERE user_id = $1', [user.id]);
        const cand = candResult.rows[0];
        if (cand) candidateId = cand.id;
      }

      let clientId = null;
      if (user.role === 'client') {
        const clientRecResult = await tenantDb.query('SELECT id FROM clients WHERE user_id = $1', [user.id]);
        const clientRec = clientRecResult.rows[0];
        if (clientRec) clientId = clientRec.id;
      }

      let recruiterId = null;
      if (user.role === 'recruiter') {
        const recResult = await tenantDb.query('SELECT id FROM recruiters WHERE user_id = $1', [user.id]);
        const rec = recResult.rows[0];
        if (rec) recruiterId = rec.id;
      }

      const mustChangePw = !!(user.must_change_password);

      // ── Tenant MFA policy enforcement ────────────────────────────────────────
      const mfaPolicy  = tenant.mfa_policy  || 'off';
      const mfaMethods = tenant.mfa_methods || ['totp'];

      // Determine if this user is subject to the policy
      const policyApplies =
        mfaPolicy === 'required' ||
        (mfaPolicy === 'admin_required' && user.role === 'admin');

      if (policyApplies && !user.mfa_enabled) {
        // User must set up MFA before they can log in
        // If email_otp is an allowed method, we can auto-send one — no setup required
        if (mfaMethods.includes('email_otp')) {
          const mfaToken = jwt.sign(
            { userId: user.id, email: user.email, name: user.name, role: user.role,
              candidateId, clientId, recruiterId, tenantSlug: tenant.slug, tenantName: tenant.company_name,
              mustChangePw, type: 'mfa_pending' },
            JWT_SECRET, { expiresIn: '2m' }
          );
          return res.json({ mfaRequired: true, mfaToken, mfaMethod: 'email_otp', autoSend: true });
        }
        // TOTP only — user must enroll first
        const setupToken = jwt.sign(
          { userId: user.id, email: user.email, name: user.name, role: user.role,
            candidateId, clientId, recruiterId, tenantSlug: tenant.slug, tenantName: tenant.company_name,
            mustChangePw, type: 'mfa_setup_required' },
          JWT_SECRET, { expiresIn: '15m' }
        );
        return res.json({ mfaSetupRequired: true, setupToken });
      }

      // ── User has MFA enabled — issue challenge ───────────────────────────────
      if (user.mfa_enabled) {
        const method = user.mfa_method || 'totp';
        const mfaToken = jwt.sign(
          { userId: user.id, email: user.email, name: user.name, role: user.role,
            candidateId, clientId, recruiterId, tenantSlug: tenant.slug, tenantName: tenant.company_name,
            mustChangePw, type: 'mfa_pending' },
          JWT_SECRET, { expiresIn: '2m' }
        );
        return res.json({ mfaRequired: true, mfaToken, mfaMethod: method });
      }

      const token = jwt.sign(
        {
          id: user.id, email: user.email, name: user.name, role: user.role,
          candidateId, clientId, recruiterId,
          tenantSlug: tenant.slug,
          tenantName: tenant.company_name,
          mustChangePw,
        },
        JWT_SECRET,
        { expiresIn: '8h' }
      );

      res.cookie(COOKIE_NAME, token, cookieOptions());
      res.json({
        token,   // Also returned for API / non-browser clients
        user: {
          id: user.id, name: user.name, email: user.email, role: user.role,
          candidateId, clientId, recruiterId,
          tenantSlug: tenant.slug,
          tenantName: tenant.company_name,
          mustChangePw,
        },
      });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    if (tenantRelease) tenantRelease();
  }
}

// ── POST /api/auth/logout ─────────────────────────────────────────────────────
router.post('/logout', async (req, res) => {
  try {
    res.clearCookie(COOKIE_NAME, { ...cookieOptions(), maxAge: 0 });
    res.json({ message: 'Logged out' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/auth/me ──────────────────────────────────────────────────────────
router.get('/me', authenticate, injectTenantDb, async (req, res) => {
  try {
    if (req.user.role === 'super_admin') {
      const saResult = await masterDb.query(
        'SELECT id, name, email, created_at FROM super_admins WHERE id = $1',
        [req.user.id]
      );
      const sa = saResult.rows[0];
      if (!sa) return res.status(404).json({ error: 'User not found' });
      return res.json({ ...sa, role: 'super_admin' });
    }

    const db   = req.db;
    const userResult = await db.query('SELECT id, name, email, role, created_at FROM users WHERE id = $1', [req.user.id]);
    const user = userResult.rows[0];
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PUT /api/auth/change-password ─────────────────────────────────────────────
router.put('/change-password', authenticate, injectTenantDb, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({ error: 'New password must be at least 6 characters' });
    }

    if (req.user.role === 'super_admin') {
      const saResult = await masterDb.query('SELECT * FROM super_admins WHERE id = $1', [req.user.id]);
      const sa = saResult.rows[0];
      if (!bcrypt.compareSync(currentPassword, sa.password_hash)) {
        return res.status(401).json({ error: 'Current password is incorrect' });
      }
      if (newPassword.length < 8) {
        return res.status(400).json({ error: 'New password must be at least 8 characters' });
      }
      const newHash = await bcrypt.hash(newPassword, 10);
      await masterDb.query('UPDATE super_admins SET password_hash = $1 WHERE id = $2', [newHash, req.user.id]);
      const freshToken = jwt.sign(
        { id: sa.id, email: sa.email, name: sa.name, role: 'super_admin', mustChangePw: false },
        JWT_SECRET, { expiresIn: '8h' }
      );
      res.cookie(COOKIE_NAME, freshToken, cookieOptions());
      return res.json({ message: 'Password updated successfully', token: freshToken });
    }

    const db   = req.db;
    const userResult = await db.query('SELECT * FROM users WHERE id = $1', [req.user.id]);
    const user = userResult.rows[0];
    if (!bcrypt.compareSync(currentPassword, user.password_hash)) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ error: 'New password must be at least 8 characters' });
    }
    const tenantNewHash = await bcrypt.hash(newPassword, 10);
    await db.query('UPDATE users SET password_hash = $1, must_change_password = FALSE WHERE id = $2', [tenantNewHash, req.user.id]);

    // Issue a fresh token with mustChangePw cleared so the UI unlocks immediately
    const freshToken = jwt.sign(
      {
        id: user.id, email: user.email, name: user.name, role: user.role,
        candidateId: req.user.candidateId || null,
        clientId:    req.user.clientId    || null,
        recruiterId: req.user.recruiterId || null,
        tenantSlug:  req.user.tenantSlug  || null,
        tenantName:  req.user.tenantName  || null,
        mustChangePw: false,
      },
      JWT_SECRET,
      { expiresIn: '8h' }
    );
    res.cookie(COOKIE_NAME, freshToken, cookieOptions());
    res.json({ message: 'Password updated successfully', token: freshToken });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
