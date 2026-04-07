/**
 * Super-Admin Routes — Tenant Provisioning & Management
 * All routes require role: super_admin
 */
const express = require('express');
const path    = require('path');
const fs      = require('fs');
const bcrypt  = require('bcryptjs');

const { authenticate, requireSuperAdmin } = require('../middleware/auth');
const { masterDb, TENANTS_DIR, seedDefaultModulesForTenant } = require('../masterDatabase');
const { provisionTenantDb, evictTenantFromCache, getTenantDb } = require('../database');
const { MODULE_REGISTRY, defaultModuleKeys } = require('../moduleRegistry');

const router = express.Router();

// All super-admin routes require authentication + super_admin role
router.use(authenticate, requireSuperAdmin);

// ── Slug helper ────────────────────────────────────────────────────────────────
function toSlug(str) {
  return str.toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

// ── GET /api/super-admin/tenants ──────────────────────────────────────────────
router.get('/tenants', (req, res) => {
  const tenants = masterDb.prepare(`
    SELECT id, slug, company_name, company_logo, contact_email, contact_phone,
           status, plan, max_candidates, max_clients, admin_email,
           created_at, updated_at
    FROM tenants ORDER BY created_at DESC
  `).all();

  // Attach live counts from each tenant DB (best effort — skip on error)
  const enriched = tenants.map(t => {
    try {
      const tdb = getTenantDb(t.slug);
      const candidates = tdb.prepare("SELECT COUNT(*) as c FROM candidates WHERE status='active'").get();
      const clients    = tdb.prepare("SELECT COUNT(*) as c FROM clients").get();
      const users      = tdb.prepare("SELECT COUNT(*) as c FROM users").get();
      return { ...t, candidate_count: candidates.c, client_count: clients.c, user_count: users.c };
    } catch {
      return { ...t, candidate_count: 0, client_count: 0, user_count: 0 };
    }
  });

  res.json(enriched);
});

// ── GET /api/super-admin/tenants/:id ─────────────────────────────────────────
router.get('/tenants/:id', (req, res) => {
  const tenant = masterDb.prepare('SELECT * FROM tenants WHERE id = ?').get(req.params.id);
  if (!tenant) return res.status(404).json({ error: 'Tenant not found' });

  let stats = {};
  try {
    const tdb = getTenantDb(tenant.slug);
    stats.candidates  = tdb.prepare("SELECT COUNT(*) as c FROM candidates").get().c;
    stats.active_candidates = tdb.prepare("SELECT COUNT(*) as c FROM candidates WHERE status='active'").get().c;
    stats.clients     = tdb.prepare("SELECT COUNT(*) as c FROM clients").get().c;
    stats.invoices    = tdb.prepare("SELECT COUNT(*) as c FROM invoices").get().c;
    stats.revenue     = tdb.prepare("SELECT COALESCE(SUM(total_amount),0) as t FROM invoices WHERE status='paid'").get().t;
    stats.pending_timesheets = tdb.prepare("SELECT COUNT(*) as c FROM time_entries WHERE status='pending'").get().c;
    stats.users       = tdb.prepare("SELECT COUNT(*) as c FROM users").get().c;
  } catch (err) {
    stats.error = err.message;
  }

  res.json({ ...tenant, stats });
});

// ── POST /api/super-admin/tenants ─────────────────────────────────────────────
// Provision a brand-new tenant with its own isolated database.
router.post('/tenants', (req, res) => {
  const {
    company_name, contact_email, contact_phone,
    plan = 'standard', max_candidates = 100, max_clients = 50,
    admin_name, admin_email, admin_password = 'Admin@123',
    slug: customSlug,
  } = req.body;

  if (!company_name) return res.status(400).json({ error: 'company_name is required' });
  if (!admin_email)  return res.status(400).json({ error: 'admin_email is required' });

  // Generate unique slug
  let slug = customSlug ? toSlug(customSlug) : toSlug(company_name);
  const existing = masterDb.prepare('SELECT id FROM tenants WHERE slug = ?').get(slug);
  if (existing) {
    slug = `${slug}-${Date.now().toString(36)}`;
  }

  // DB file path
  const dbFileName = `${slug}.db`;
  const dbPath = path.join(TENANTS_DIR, dbFileName);

  if (fs.existsSync(dbPath)) {
    return res.status(409).json({ error: `Database file already exists for slug '${slug}'` });
  }

  try {
    // Provision tenant database
    provisionTenantDb(dbPath, admin_name || company_name + ' Admin', admin_email, admin_password);

    // Register tenant in master DB
    const result = masterDb.prepare(`
      INSERT INTO tenants
        (slug, company_name, contact_email, contact_phone, db_path,
         plan, max_candidates, max_clients, admin_email)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      slug, company_name,
      contact_email || null, contact_phone || null,
      dbPath, plan,
      parseInt(max_candidates) || 100,
      parseInt(max_clients)    || 50,
      admin_email.toLowerCase().trim()
    );

    const newTenant = masterDb.prepare('SELECT * FROM tenants WHERE id = ?').get(result.lastInsertRowid);

    // Seed default modules for the new tenant
    seedDefaultModulesForTenant(slug);

    console.log(`✅ Tenant provisioned: ${company_name} (${slug})`);

    res.status(201).json({
      ...newTenant,
      admin_login: {
        company_code: slug,
        email: admin_email,
        temporary_password: admin_password,
      },
    });
  } catch (err) {
    // Clean up DB file if creation failed mid-way
    if (fs.existsSync(dbPath)) {
      try { fs.unlinkSync(dbPath); } catch {}
    }
    console.error('Tenant provisioning failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── PATCH /api/super-admin/tenants/:id ───────────────────────────────────────
router.patch('/tenants/:id', (req, res) => {
  const tenant = masterDb.prepare('SELECT * FROM tenants WHERE id = ?').get(req.params.id);
  if (!tenant) return res.status(404).json({ error: 'Tenant not found' });

  const {
    company_name, company_logo, contact_email, contact_phone,
    status, plan, max_candidates, max_clients,
  } = req.body;

  masterDb.prepare(`
    UPDATE tenants SET
      company_name   = COALESCE(?, company_name),
      company_logo   = COALESCE(?, company_logo),
      contact_email  = COALESCE(?, contact_email),
      contact_phone  = COALESCE(?, contact_phone),
      status         = COALESCE(?, status),
      plan           = COALESCE(?, plan),
      max_candidates = COALESCE(?, max_candidates),
      max_clients    = COALESCE(?, max_clients),
      updated_at     = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(
    company_name || null, company_logo || null,
    contact_email || null, contact_phone || null,
    status || null, plan || null,
    max_candidates ? parseInt(max_candidates) : null,
    max_clients    ? parseInt(max_clients)    : null,
    tenant.id
  );

  // If suspending, evict from cache
  if (status === 'suspended') evictTenantFromCache(tenant.slug);

  const updated = masterDb.prepare('SELECT * FROM tenants WHERE id = ?').get(tenant.id);
  res.json(updated);
});

// ── POST /api/super-admin/tenants/:id/reset-admin ────────────────────────────
router.post('/tenants/:id/reset-admin', (req, res) => {
  const { new_password } = req.body;
  if (!new_password || new_password.length < 6) {
    return res.status(400).json({ error: 'new_password must be at least 6 characters' });
  }

  const tenant = masterDb.prepare('SELECT * FROM tenants WHERE id = ?').get(req.params.id);
  if (!tenant) return res.status(404).json({ error: 'Tenant not found' });

  try {
    const tdb = getTenantDb(tenant.slug);
    const admin = tdb.prepare("SELECT id FROM users WHERE role = 'admin' LIMIT 1").get();
    if (!admin) return res.status(404).json({ error: 'No admin user found in tenant DB' });

    const hash = bcrypt.hashSync(new_password, 10);
    tdb.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, admin.id);
    res.json({ message: 'Admin password reset successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /api/super-admin/tenants/:id ──────────────────────────────────────
// Soft-delete: sets status to 'suspended'. Hard delete must be done manually.
router.delete('/tenants/:id', (req, res) => {
  const tenant = masterDb.prepare('SELECT * FROM tenants WHERE id = ?').get(req.params.id);
  if (!tenant) return res.status(404).json({ error: 'Tenant not found' });

  masterDb.prepare(
    "UPDATE tenants SET status = 'suspended', updated_at = CURRENT_TIMESTAMP WHERE id = ?"
  ).run(tenant.id);

  evictTenantFromCache(tenant.slug);
  res.json({ message: `Tenant '${tenant.company_name}' suspended successfully` });
});

// ── GET /api/super-admin/stats ────────────────────────────────────────────────
router.get('/stats', (req, res) => {
  const tenants = masterDb.prepare('SELECT * FROM tenants').all();
  const total   = tenants.length;
  const active  = tenants.filter(t => t.status === 'active').length;
  const suspended = tenants.filter(t => t.status === 'suspended').length;
  const trial   = tenants.filter(t => t.status === 'trial').length;

  let totalCandidates = 0, totalClients = 0, totalInvoices = 0;
  for (const t of tenants.filter(t => t.status === 'active')) {
    try {
      const tdb = getTenantDb(t.slug);
      totalCandidates += tdb.prepare("SELECT COUNT(*) as c FROM candidates WHERE status='active'").get().c;
      totalClients    += tdb.prepare("SELECT COUNT(*) as c FROM clients").get().c;
      totalInvoices   += tdb.prepare("SELECT COUNT(*) as c FROM invoices").get().c;
    } catch {}
  }

  res.json({ total, active, suspended, trial, totalCandidates, totalClients, totalInvoices });
});

// ─────────────────────────────────────────────────────────────────────────────
// MODULE MANAGEMENT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/super-admin/tenants/:id/modules
 * Returns all modules with enabled/disabled state for a tenant.
 */
router.get('/tenants/:id/modules', (req, res) => {
  const tenant = masterDb.prepare('SELECT * FROM tenants WHERE id = ?').get(req.params.id);
  if (!tenant) return res.status(404).json({ error: 'Tenant not found' });

  // Ensure modules are seeded
  seedDefaultModulesForTenant(tenant.slug);

  const rows = masterDb.prepare(
    'SELECT module_key, enabled, enabled_at FROM tenant_modules WHERE tenant_slug = ?'
  ).all(tenant.slug);

  const enabledMap = Object.fromEntries(rows.map(r => [r.module_key, { enabled: !!r.enabled, enabled_at: r.enabled_at }]));

  // Merge with full registry so the UI always sees every module
  const modules = MODULE_REGISTRY.map(m => ({
    ...m,
    enabled:    enabledMap[m.key]?.enabled ?? m.default,
    enabled_at: enabledMap[m.key]?.enabled_at ?? null,
  }));

  res.json({ tenant: { id: tenant.id, slug: tenant.slug, company_name: tenant.company_name }, modules });
});

/**
 * PUT /api/super-admin/tenants/:id/modules
 * Bulk-update module states for a tenant.
 * Body: { modules: { [key]: boolean } }
 */
router.put('/tenants/:id/modules', (req, res) => {
  const tenant = masterDb.prepare('SELECT * FROM tenants WHERE id = ?').get(req.params.id);
  if (!tenant) return res.status(404).json({ error: 'Tenant not found' });

  const { modules } = req.body;
  if (!modules || typeof modules !== 'object') {
    return res.status(400).json({ error: 'modules object required: { module_key: boolean }' });
  }

  const validKeys = new Set(MODULE_REGISTRY.map(m => m.key));

  masterDb.exec('BEGIN');
  try {
    for (const [key, enabled] of Object.entries(modules)) {
      if (!validKeys.has(key)) continue;
      masterDb.prepare(`
        INSERT INTO tenant_modules (tenant_slug, module_key, enabled, enabled_at)
        VALUES (?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(tenant_slug, module_key) DO UPDATE SET
          enabled    = excluded.enabled,
          enabled_at = CURRENT_TIMESTAMP
      `).run(tenant.slug, key, enabled ? 1 : 0);
    }
    masterDb.exec('COMMIT');
  } catch (err) {
    masterDb.exec('ROLLBACK');
    return res.status(500).json({ error: err.message });
  }

  // Return updated list
  const rows = masterDb.prepare(
    'SELECT module_key, enabled, enabled_at FROM tenant_modules WHERE tenant_slug = ?'
  ).all(tenant.slug);
  const enabledMap = Object.fromEntries(rows.map(r => [r.module_key, { enabled: !!r.enabled, enabled_at: r.enabled_at }]));
  const result = MODULE_REGISTRY.map(m => ({
    ...m,
    enabled:    enabledMap[m.key]?.enabled ?? m.default,
    enabled_at: enabledMap[m.key]?.enabled_at ?? null,
  }));

  res.json({ message: 'Modules updated', modules: result });
});

/**
 * PATCH /api/super-admin/tenants/:id/modules/:key
 * Toggle a single module on/off.
 */
router.patch('/tenants/:id/modules/:key', (req, res) => {
  const tenant = masterDb.prepare('SELECT * FROM tenants WHERE id = ?').get(req.params.id);
  if (!tenant) return res.status(404).json({ error: 'Tenant not found' });

  const moduleKey = req.params.key;
  const moduleDef = MODULE_REGISTRY.find(m => m.key === moduleKey);
  if (!moduleDef) return res.status(404).json({ error: `Module '${moduleKey}' not found in registry` });

  const { enabled } = req.body;
  if (typeof enabled !== 'boolean') {
    return res.status(400).json({ error: 'enabled (boolean) is required' });
  }

  masterDb.prepare(`
    INSERT INTO tenant_modules (tenant_slug, module_key, enabled, enabled_at)
    VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(tenant_slug, module_key) DO UPDATE SET
      enabled    = excluded.enabled,
      enabled_at = CURRENT_TIMESTAMP
  `).run(tenant.slug, moduleKey, enabled ? 1 : 0);

  res.json({
    module: moduleKey,
    enabled,
    tenant: tenant.slug,
    message: `Module '${moduleDef.name}' ${enabled ? 'enabled' : 'disabled'} for ${tenant.company_name}`,
  });
});

/**
 * GET /api/super-admin/modules
 * Returns the full module registry (for the UI to display without a specific tenant).
 */
router.get('/modules', (req, res) => {
  res.json(MODULE_REGISTRY);
});

// ── Platform AI Config ────────────────────────────────────────────────────────

const { PROVIDER_MODELS } = require('../services/llmService');

router.get('/ai-config', (req, res) => {
  try {
    const cfg = masterDb.prepare('SELECT * FROM platform_ai_config WHERE id=1').get() || {};
    res.json({
      provider:           cfg.provider           || 'anthropic',
      model:              cfg.model              || 'claude-haiku-4-5-20251001',
      has_api_key:        !!cfg.api_key,
      allow_tenant_keys:  cfg.allow_tenant_keys !== 0,
      available_providers: PROVIDER_MODELS,
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/ai-config', (req, res) => {
  const { provider, model, api_key, clear_api_key, allow_tenant_keys } = req.body;

  const validProviders = Object.keys(PROVIDER_MODELS);
  if (provider && !validProviders.includes(provider)) {
    return res.status(400).json({ error: `Invalid provider. Must be one of: ${validProviders.join(', ')}` });
  }
  if (model && provider) {
    const models = PROVIDER_MODELS[provider].map(m => m.id);
    if (!models.includes(model)) {
      return res.status(400).json({ error: `Invalid model for provider ${provider}` });
    }
  }

  try {
    const updates = []; const params = [];
    if (provider !== undefined)          { updates.push('provider=?');          params.push(provider); }
    if (model !== undefined)             { updates.push('model=?');              params.push(model); }
    if (allow_tenant_keys !== undefined) { updates.push('allow_tenant_keys=?'); params.push(allow_tenant_keys ? 1 : 0); }
    if (api_key)                         { updates.push('api_key=?');            params.push(api_key); }
    if (clear_api_key)                   { updates.push('api_key=NULL'); }
    if (updates.length) {
      updates.push('updated_at=CURRENT_TIMESTAMP');
      params.push(1);
      masterDb.prepare(`UPDATE platform_ai_config SET ${updates.join(',')} WHERE id=?`).run(...params);
    }
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
