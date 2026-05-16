const express = require('express');
const router = express.Router();
const { authenticate, requireAdmin, injectTenantDb } = require('../middleware/auth');
const { masterDb } = require('../masterDatabase');

// All settings endpoints are admin-only and tenant-scoped
router.use(authenticate, requireAdmin, injectTenantDb);

/**
 * GET /api/settings
 * Returns current tenant settings from master DB.
 */
router.get('/', async (req, res) => {
  try {
    const result = await masterDb.query('SELECT * FROM tenants WHERE slug = $1', [req.user.tenantSlug]);
    const tenant = result.rows[0];
    if (!tenant) return res.status(404).json({ error: 'Tenant not found' });
    // Never expose db_path to the client
    const { db_path, ...safe } = tenant;
    res.json(safe);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * PUT /api/settings
 * Update tenant settings.
 * Body: { company_name, company_logo, contact_email, contact_phone }
 */
router.put('/', async (req, res) => {
  try {
    const { company_name, company_logo, contact_email, contact_phone } = req.body;

    if (!company_name || !company_name.trim()) {
      return res.status(400).json({ error: 'company_name is required' });
    }

    await masterDb.query(`
      UPDATE tenants SET
        company_name   = $1,
        company_logo   = COALESCE($2, company_logo),
        contact_email  = $3,
        contact_phone  = $4,
        updated_at     = NOW()
      WHERE slug = $5
    `, [
      company_name.trim(),
      company_logo || null,
      contact_email || null,
      contact_phone || null,
      req.user.tenantSlug
    ]);

    const result = await masterDb.query('SELECT * FROM tenants WHERE slug = $1', [req.user.tenantSlug]);
    const tenant = result.rows[0];
    const { db_path, ...safe } = tenant;
    res.json({ message: 'Settings updated', tenant: safe });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /api/settings/logo
 * Remove company logo.
 */
router.delete('/logo', async (req, res) => {
  try {
    await masterDb.query(
      "UPDATE tenants SET company_logo = NULL, updated_at = NOW() WHERE slug = $1",
      [req.user.tenantSlug]
    );
    res.json({ message: 'Logo removed' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/settings/access-review ──────────────────────────────────────────
// SOC 2 CC6.3: Periodic access review — lists all users with role, MFA status,
// last login, and account status so admins can certify or revoke access.
router.get('/access-review', async (req, res) => {
  try {
    const db = req.db;
    const result = await db.query(`
      SELECT
        u.id,
        u.name,
        u.email,
        u.role,
        u.created_at,
        u.last_login_at,
        u.must_change_password,
        COALESCE(u.mfa_enabled, FALSE)  AS mfa_enabled,
        u.mfa_method,
        e.status                        AS employee_status,
        e.id                            AS employee_id
      FROM users u
      LEFT JOIN employees e ON e.user_id = u.id
      ORDER BY u.role, u.name
    `);

    const users = result.rows;
    const totalUsers    = users.length;
    const mfaEnabled    = users.filter(u => u.mfa_enabled).length;
    const noRecentLogin = users.filter(u => {
      if (!u.last_login_at) return true;
      const days = (Date.now() - new Date(u.last_login_at).getTime()) / 86400000;
      return days > 90;
    }).length;
    const mustChangePw  = users.filter(u => u.must_change_password).length;

    res.json({
      generatedAt: new Date().toISOString(),
      tenantSlug:  req.user.tenantSlug,
      summary: { totalUsers, mfaEnabled, noRecentLogin, mustChangePw },
      users,
    });
  } catch (err) {
    console.error('[access-review]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/settings/locked-accounts ────────────────────────────────────────
// SOC 2 CC6.1: List accounts currently locked out for this tenant.
router.get('/locked-accounts', async (req, res) => {
  try {
    const result = await masterDb.query(`
      SELECT email, attempts, locked_until, last_attempt_at
      FROM login_attempts
      WHERE tenant_slug = $1
        AND locked_until IS NOT NULL
        AND locked_until > NOW()
      ORDER BY locked_until DESC
    `, [req.user.tenantSlug]);
    res.json(result.rows);
  } catch (err) {
    console.error('[locked-accounts]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /api/settings/locked-accounts/:email ───────────────────────────────
// Admin unlocks a specific account immediately.
router.delete('/locked-accounts/:email', async (req, res) => {
  try {
    const email = decodeURIComponent(req.params.email).toLowerCase().trim();
    await masterDb.query(
      `UPDATE login_attempts SET locked_until = NULL, attempts = 0
       WHERE email = $1 AND tenant_slug IS NOT DISTINCT FROM $2`,
      [email, req.user.tenantSlug]
    );
    res.json({ message: `Account ${email} unlocked` });
  } catch (err) {
    console.error('[unlock-account]', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
