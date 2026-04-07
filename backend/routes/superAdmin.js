/**
 * Super-Admin Routes — Tenant Provisioning & Management
 * All routes require role: super_admin
 */
const express = require('express');
const bcrypt  = require('bcryptjs');

const { authenticate, requireSuperAdmin } = require('../middleware/auth');
const { masterDb, seedDefaultModulesForTenant } = require('../masterDatabase');
const { provisionTenantDb, getTenantDb } = require('../database');
const { MODULE_REGISTRY } = require('../moduleRegistry');

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
router.get('/tenants', async (req, res) => {
  try {
    const tenants = await masterDb.prepare(`
      SELECT id, slug, company_name, company_logo, contact_email, contact_phone,
             status, plan, max_candidates, max_clients, admin_email,
             created_at, updated_at
      FROM tenants ORDER BY created_at DESC
    `).all();

    // Attach live counts from each tenant DB (best-effort — skip on error)
    const enriched = await Promise.all(tenants.map(async (t) => {
      try {
        const tdb = await getTenantDb(t.slug);
        const [candidates, clients, users] = await Promise.all([
          tdb.prepare("SELECT COUNT(*)::int AS c FROM candidates WHERE status='active'").get(),
          tdb.prepare("SELECT COUNT(*)::int AS c FROM clients").get(),
          tdb.prepare("SELECT COUNT(*)::int AS c FROM users").get(),
        ]);
        return { ...t, candidate_count: candidates.c, client_count: clients.c, user_count: users.c };
      } catch {
        return { ...t, candidate_count: 0, client_count: 0, user_count: 0 };
      }
    }));

    res.json(enriched);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/super-admin/tenants/:id ─────────────────────────────────────────
router.get('/tenants/:id', async (req, res) => {
  try {
    const tenant = await masterDb.prepare('SELECT * FROM tenants WHERE id = $1').get(req.params.id);
    if (!tenant) return res.status(404).json({ error: 'Tenant not found' });

    let stats = {};
    try {
      const tdb = await getTenantDb(tenant.slug);
      const [cand, activeCand, clients, invoices, revenue, timesheets, users] = await Promise.all([
        tdb.prepare("SELECT COUNT(*)::int AS c FROM candidates").get(),
        tdb.prepare("SELECT COUNT(*)::int AS c FROM candidates WHERE status='active'").get(),
        tdb.prepare("SELECT COUNT(*)::int AS c FROM clients").get(),
        tdb.prepare("SELECT COUNT(*)::int AS c FROM invoices").get(),
        tdb.prepare("SELECT COALESCE(SUM(total_amount),0) AS t FROM invoices WHERE status='paid'").get(),
        tdb.prepare("SELECT COUNT(*)::int AS c FROM time_entries WHERE status='pending'").get(),
        tdb.prepare("SELECT COUNT(*)::int AS c FROM users").get(),
      ]);
      stats = {
        candidates:          cand.c,
        active_candidates:   activeCand.c,
        clients:             clients.c,
        invoices:            invoices.c,
        revenue:             revenue.t,
        pending_timesheets:  timesheets.c,
        users:               users.c,
      };
    } catch (err) {
      stats.error = err.message;
    }

    res.json({ ...tenant, stats });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/super-admin/tenants ─────────────────────────────────────────────
router.post('/tenants', async (req, res) => {
  const {
    company_name, contact_email, contact_phone,
    plan = 'standard', max_candidates = 100, max_clients = 50,
    admin_name, admin_email, admin_password = 'Admin@123',
    slug: customSlug,
  } = req.body;

  if (!company_name) return res.status(400).json({ error: 'company_name is required' });
  if (!admin_email)  return res.status(400).json({ error: 'admin_email is required' });

  try {
    // Generate unique slug
    let slug = customSlug ? toSlug(customSlug) : toSlug(company_name);
    const existing = await masterDb.prepare('SELECT id FROM tenants WHERE slug = $1').get(slug);
    if (existing) slug = `${slug}-${Date.now().toString(36)}`;

    // Provision tenant schema + seed data
    await provisionTenantDb(slug, admin_name || company_name + ' Admin', admin_email, admin_password);

    // Register tenant in master DB
    const result = await masterDb.prepare(`
      INSERT INTO tenants
        (slug, company_name, contact_email, contact_phone,
         plan, max_candidates, max_clients, admin_email)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `).run(
      slug, company_name,
      contact_email || null, contact_phone || null,
      plan,
      parseInt(max_candidates) || 100,
      parseInt(max_clients)    || 50,
      admin_email.toLowerCase().trim()
    );

    const newTenant = await masterDb.prepare('SELECT * FROM tenants WHERE id = $1').get(result.lastInsertRowid);

    // Seed default modules for the new tenant
    await seedDefaultModulesForTenant(slug);

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
    console.error('Tenant provisioning failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── PATCH /api/super-admin/tenants/:id ───────────────────────────────────────
router.patch('/tenants/:id', async (req, res) => {
  try {
    const tenant = await masterDb.prepare('SELECT * FROM tenants WHERE id = $1').get(req.params.id);
    if (!tenant) return res.status(404).json({ error: 'Tenant not found' });

    const {
      company_name, company_logo, contact_email, contact_phone,
      status, plan, max_candidates, max_clients,
    } = req.body;

    await masterDb.prepare(`
      UPDATE tenants SET
        company_name   = COALESCE($1, company_name),
        company_logo   = COALESCE($2, company_logo),
        contact_email  = COALESCE($3, contact_email),
        contact_phone  = COALESCE($4, contact_phone),
        status         = COALESCE($5, status),
        plan           = COALESCE($6, plan),
        max_candidates = COALESCE($7, max_candidates),
        max_clients    = COALESCE($8, max_clients),
        updated_at     = NOW()
      WHERE id = $9
    `).run(
      company_name  || null, company_logo   || null,
      contact_email || null, contact_phone  || null,
      status        || null, plan           || null,
      max_candidates ? parseInt(max_candidates) : null,
      max_clients    ? parseInt(max_clients)    : null,
      tenant.id
    );

    const updated = await masterDb.prepare('SELECT * FROM tenants WHERE id = $1').get(tenant.id);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/super-admin/tenants/:id/reset-admin ────────────────────────────
router.post('/tenants/:id/reset-admin', async (req, res) => {
  const { new_password } = req.body;
  if (!new_password || new_password.length < 6) {
    return res.status(400).json({ error: 'new_password must be at least 6 characters' });
  }

  try {
    const tenant = await masterDb.prepare('SELECT * FROM tenants WHERE id = $1').get(req.params.id);
    if (!tenant) return res.status(404).json({ error: 'Tenant not found' });

    const tdb   = await getTenantDb(tenant.slug);
    const admin = await tdb.prepare("SELECT id FROM users WHERE role = 'admin' LIMIT 1").get();
    if (!admin) return res.status(404).json({ error: 'No admin user found in tenant DB' });

    const hash = await bcrypt.hash(new_password, 10);
    await tdb.prepare('UPDATE users SET password_hash = $1 WHERE id = $2').run(hash, admin.id);
    res.json({ message: 'Admin password reset successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /api/super-admin/tenants/:id ──────────────────────────────────────
// Soft-delete: sets status to 'suspended'. Hard delete must be done manually.
router.delete('/tenants/:id', async (req, res) => {
  try {
    const tenant = await masterDb.prepare('SELECT * FROM tenants WHERE id = $1').get(req.params.id);
    if (!tenant) return res.status(404).json({ error: 'Tenant not found' });

    await masterDb.prepare(
      "UPDATE tenants SET status = 'suspended', updated_at = NOW() WHERE id = $1"
    ).run(tenant.id);

    res.json({ message: `Tenant '${tenant.company_name}' suspended successfully` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/super-admin/stats ────────────────────────────────────────────────
router.get('/stats', async (req, res) => {
  try {
    const tenants  = await masterDb.prepare('SELECT * FROM tenants').all();
    const total    = tenants.length;
    const active   = tenants.filter(t => t.status === 'active').length;
    const suspended = tenants.filter(t => t.status === 'suspended').length;
    const trial    = tenants.filter(t => t.status === 'trial').length;

    let totalCandidates = 0, totalClients = 0, totalInvoices = 0;
    for (const t of tenants.filter(t => t.status === 'active')) {
      try {
        const tdb = await getTenantDb(t.slug);
        const [cand, cli, inv] = await Promise.all([
          tdb.prepare("SELECT COUNT(*)::int AS c FROM candidates WHERE status='active'").get(),
          tdb.prepare("SELECT COUNT(*)::int AS c FROM clients").get(),
          tdb.prepare("SELECT COUNT(*)::int AS c FROM invoices").get(),
        ]);
        totalCandidates += cand.c;
        totalClients    += cli.c;
        totalInvoices   += inv.c;
      } catch {}
    }

    res.json({ total, active, suspended, trial, totalCandidates, totalClients, totalInvoices });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── MODULE MANAGEMENT ─────────────────────────────────────────────────────────

router.get('/tenants/:id/modules', async (req, res) => {
  try {
    const tenant = await masterDb.prepare('SELECT * FROM tenants WHERE id = $1').get(req.params.id);
    if (!tenant) return res.status(404).json({ error: 'Tenant not found' });

    await seedDefaultModulesForTenant(tenant.slug);

    const rows = await masterDb.prepare(
      'SELECT module_key, enabled, enabled_at FROM tenant_modules WHERE tenant_slug = $1'
    ).all(tenant.slug);

    const enabledMap = Object.fromEntries(rows.map(r => [r.module_key, { enabled: !!r.enabled, enabled_at: r.enabled_at }]));
    const modules = MODULE_REGISTRY.map(m => ({
      ...m,
      enabled:    enabledMap[m.key]?.enabled ?? m.default,
      enabled_at: enabledMap[m.key]?.enabled_at ?? null,
    }));

    res.json({ tenant: { id: tenant.id, slug: tenant.slug, company_name: tenant.company_name }, modules });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/tenants/:id/modules', async (req, res) => {
  try {
    const tenant = await masterDb.prepare('SELECT * FROM tenants WHERE id = $1').get(req.params.id);
    if (!tenant) return res.status(404).json({ error: 'Tenant not found' });

    const { modules } = req.body;
    if (!modules || typeof modules !== 'object') {
      return res.status(400).json({ error: 'modules object required: { module_key: boolean }' });
    }

    const validKeys = new Set(MODULE_REGISTRY.map(m => m.key));

    await masterDb.transaction(async (tx) => {
      for (const [key, enabled] of Object.entries(modules)) {
        if (!validKeys.has(key)) continue;
        await tx.prepare(`
          INSERT INTO tenant_modules (tenant_slug, module_key, enabled, enabled_at)
          VALUES ($1, $2, $3, NOW())
          ON CONFLICT(tenant_slug, module_key) DO UPDATE SET
            enabled    = excluded.enabled,
            enabled_at = NOW()
        `).run(tenant.slug, key, enabled ? true : false);
      }
    });

    const rows = await masterDb.prepare(
      'SELECT module_key, enabled, enabled_at FROM tenant_modules WHERE tenant_slug = $1'
    ).all(tenant.slug);
    const enabledMap = Object.fromEntries(rows.map(r => [r.module_key, { enabled: !!r.enabled, enabled_at: r.enabled_at }]));
    const result = MODULE_REGISTRY.map(m => ({
      ...m,
      enabled:    enabledMap[m.key]?.enabled ?? m.default,
      enabled_at: enabledMap[m.key]?.enabled_at ?? null,
    }));

    res.json({ message: 'Modules updated', modules: result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/tenants/:id/modules/:key', async (req, res) => {
  try {
    const tenant = await masterDb.prepare('SELECT * FROM tenants WHERE id = $1').get(req.params.id);
    if (!tenant) return res.status(404).json({ error: 'Tenant not found' });

    const moduleKey = req.params.key;
    const moduleDef = MODULE_REGISTRY.find(m => m.key === moduleKey);
    if (!moduleDef) return res.status(404).json({ error: `Module '${moduleKey}' not found in registry` });

    const { enabled } = req.body;
    if (typeof enabled !== 'boolean') {
      return res.status(400).json({ error: 'enabled (boolean) is required' });
    }

    await masterDb.prepare(`
      INSERT INTO tenant_modules (tenant_slug, module_key, enabled, enabled_at)
      VALUES ($1, $2, $3, NOW())
      ON CONFLICT(tenant_slug, module_key) DO UPDATE SET
        enabled    = excluded.enabled,
        enabled_at = NOW()
    `).run(tenant.slug, moduleKey, enabled ? true : false);

    res.json({
      module: moduleKey,
      enabled,
      tenant: tenant.slug,
      message: `Module '${moduleDef.name}' ${enabled ? 'enabled' : 'disabled'} for ${tenant.company_name}`,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/modules', async (req, res) => {
  res.json(MODULE_REGISTRY);
});

// ── Platform AI Config ────────────────────────────────────────────────────────
const { PROVIDER_MODELS } = require('../services/llmService');

router.get('/ai-config', async (req, res) => {
  try {
    const cfg = await masterDb.prepare('SELECT * FROM platform_ai_config WHERE id = 1').get() || {};
    res.json({
      provider:            cfg.provider           || 'anthropic',
      model:               cfg.model              || 'claude-haiku-4-5-20251001',
      has_api_key:         !!cfg.api_key,
      allow_tenant_keys:   cfg.allow_tenant_keys !== false,
      available_providers: PROVIDER_MODELS,
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/ai-config', async (req, res) => {
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
    if (provider !== undefined)          { updates.push('provider=$' + (params.push(provider))); }
    if (model !== undefined)             { updates.push('model=$'    + (params.push(model))); }
    if (allow_tenant_keys !== undefined) { updates.push('allow_tenant_keys=$' + (params.push(allow_tenant_keys ? true : false))); }
    if (api_key)                         { updates.push('api_key=$'  + (params.push(api_key))); }
    if (clear_api_key)                   { updates.push('api_key=NULL'); }
    if (updates.length) {
      updates.push('updated_at=NOW()');
      params.push(1);
      await masterDb.prepare(`UPDATE platform_ai_config SET ${updates.join(', ')} WHERE id=$${params.length}`).run(...params);
    }
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
