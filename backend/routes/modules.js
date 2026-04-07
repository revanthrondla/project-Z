/**
 * Tenant-facing module endpoint
 * GET /api/modules/me — returns the list of modules enabled for the calling tenant
 */
const express = require('express');
const router = express.Router();
const { authenticate, injectTenantDb } = require('../middleware/auth');
const { masterDb, seedDefaultModulesForTenant } = require('../masterDatabase');
const { MODULE_REGISTRY } = require('../moduleRegistry');

/**
 * GET /api/modules/me
 * Returns enabled module keys for the current tenant.
 * Super-admins get all modules enabled (they operate across all tenants).
 */
router.get('/me', authenticate, (req, res) => {
  // Super admins see everything
  if (req.user.role === 'super_admin') {
    return res.json({ modules: MODULE_REGISTRY.map(m => m.key), all: true });
  }

  const slug = req.user.tenantSlug;
  if (!slug) return res.status(400).json({ error: 'No tenant slug in token' });

  // Ensure modules are seeded for this tenant
  try { seedDefaultModulesForTenant(slug); } catch {}

  const rows = masterDb.prepare(
    'SELECT module_key, enabled FROM tenant_modules WHERE tenant_slug = ?'
  ).all(slug);

  const enabledSet = new Set(rows.filter(r => r.enabled).map(r => r.module_key));

  // For modules not yet in the DB, fall back to registry default
  const modules = MODULE_REGISTRY
    .filter(m => rows.some(r => r.module_key === m.key) ? enabledSet.has(m.key) : m.default)
    .map(m => m.key);

  res.json({ modules, all: false });
});

module.exports = router;
