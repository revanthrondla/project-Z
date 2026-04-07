const express = require('express');
const router = express.Router();
const { authenticate, requireAdmin, injectTenantDb } = require('../middleware/auth');
const { masterDb } = require('../masterDatabase');

// All settings endpoints are admin-only
router.use(authenticate, requireAdmin);

/**
 * GET /api/settings
 * Returns current tenant settings from master DB.
 */
router.get('/', async (req, res) => {
  try {
    const tenant = await masterDb.prepare('SELECT * FROM tenants WHERE slug = ?').get(req.user.tenantSlug);
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

    await masterDb.prepare(`
      UPDATE tenants SET
        company_name   = ?,
        company_logo   = COALESCE(?, company_logo),
        contact_email  = ?,
        contact_phone  = ?,
        updated_at     = NOW()
      WHERE slug = ?
    `).run(
      company_name.trim(),
      company_logo || null,
      contact_email || null,
      contact_phone || null,
      req.user.tenantSlug
    );

    const tenant = await masterDb.prepare('SELECT * FROM tenants WHERE slug = ?').get(req.user.tenantSlug);
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
    await masterDb.prepare(
      "UPDATE tenants SET company_logo = NULL, updated_at = NOW() WHERE slug = ?"
    ).run(req.user.tenantSlug);
    res.json({ message: 'Logo removed' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
