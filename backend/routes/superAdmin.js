/**
 * Super-Admin Routes — Tenant Provisioning & Management
 * All routes require role: super_admin
 */
const express = require('express');
const bcrypt  = require('bcryptjs');

const { authenticate, requireSuperAdmin, invalidateTenantStatusCache } = require('../middleware/auth');
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
    const result = await masterDb.query(`
      SELECT id, slug, company_name, company_logo, contact_email, contact_phone,
             status, plan, max_candidates, max_clients, admin_email,
             created_at, updated_at
      FROM tenants ORDER BY created_at DESC
    `);
    const tenants = result.rows;

    // Attach live counts from each tenant DB (best-effort — skip on error)
    const enriched = await Promise.all(tenants.map(async (t) => {
      let rel;
      try {
        const { wrapper: tdb, release } = await getTenantDb(t.slug);
        rel = release;
        const [candidates, clients, users] = await Promise.all([
          (async () => {
            const res = await tdb.query("SELECT COUNT(*)::int AS c FROM employees WHERE status='active'");
            return res.rows[0];
          })(),
          (async () => {
            const res = await tdb.query("SELECT COUNT(*)::int AS c FROM clients");
            return res.rows[0];
          })(),
          (async () => {
            const res = await tdb.query("SELECT COUNT(*)::int AS c FROM users");
            return res.rows[0];
          })(),
        ]);
        return { ...t, candidate_count: employees.c, client_count: clients.c, user_count: users.c };
      } catch {
        return { ...t, candidate_count: 0, client_count: 0, user_count: 0 };
      } finally {
        if (rel) rel();
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
    const result = await masterDb.query('SELECT * FROM tenants WHERE id = $1', [req.params.id]);
    const tenant = result.rows[0];
    if (!tenant) return res.status(404).json({ error: 'Tenant not found' });

    let stats = {};
    let statsRel;
    try {
      const { wrapper: tdb, release } = await getTenantDb(tenant.slug);
      statsRel = release;
      const [cand, activeCand, clients, invoices, revenue, timesheets, users] = await Promise.all([
        (async () => {
          const res = await tdb.query("SELECT COUNT(*)::int AS c FROM employees");
          return res.rows[0];
        })(),
        (async () => {
          const res = await tdb.query("SELECT COUNT(*)::int AS c FROM employees WHERE status='active'");
          return res.rows[0];
        })(),
        (async () => {
          const res = await tdb.query("SELECT COUNT(*)::int AS c FROM clients");
          return res.rows[0];
        })(),
        (async () => {
          const res = await tdb.query("SELECT COUNT(*)::int AS c FROM invoices");
          return res.rows[0];
        })(),
        (async () => {
          const res = await tdb.query("SELECT COALESCE(SUM(total_amount),0) AS t FROM invoices WHERE status='paid'");
          return res.rows[0];
        })(),
        (async () => {
          const res = await tdb.query("SELECT COUNT(*)::int AS c FROM time_entries WHERE status='pending'");
          return res.rows[0];
        })(),
        (async () => {
          const res = await tdb.query("SELECT COUNT(*)::int AS c FROM users");
          return res.rows[0];
        })(),
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
    } finally {
      if (statsRel) statsRel();
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
    const existingResult = await masterDb.query('SELECT id FROM tenants WHERE slug = $1', [slug]);
    const existing = existingResult.rows[0];
    if (existing) slug = `${slug}-${Date.now().toString(36)}`;

    // Provision tenant schema + seed data
    await provisionTenantDb(slug, admin_name || company_name + ' Admin', admin_email, admin_password);

    // Register tenant in master DB
    const insertResult = await masterDb.query(`
      INSERT INTO tenants
        (slug, company_name, contact_email, contact_phone,
         plan, max_candidates, max_clients, admin_email)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING id
    `, [
      slug, company_name,
      contact_email || null, contact_phone || null,
      plan,
      parseInt(max_candidates) || 100,
      parseInt(max_clients)    || 50,
      admin_email.toLowerCase().trim()
    ]);
    const newTenantId = insertResult.rows[0].id;

    const newTenantResult = await masterDb.query('SELECT * FROM tenants WHERE id = $1', [newTenantId]);
    const newTenant = newTenantResult.rows[0];

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
    const tenantResult = await masterDb.query('SELECT * FROM tenants WHERE id = $1', [req.params.id]);
    const tenant = tenantResult.rows[0];
    if (!tenant) return res.status(404).json({ error: 'Tenant not found' });

    const {
      company_name, company_logo, contact_email, contact_phone,
      status, plan, max_candidates, max_clients,
    } = req.body;

    await masterDb.query(`
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
    `, [
      company_name  || null, company_logo   || null,
      contact_email || null, contact_phone  || null,
      status        || null, plan           || null,
      max_candidates ? parseInt(max_candidates) : null,
      max_clients    ? parseInt(max_clients)    : null,
      tenant.id
    ]);

    const updatedResult = await masterDb.query('SELECT * FROM tenants WHERE id = $1', [tenant.id]);
    const updated = updatedResult.rows[0];

    // If status changed, evict the tenant from the auth middleware's status cache
    // so the new status takes effect on the next request (within 1 minute at most).
    if (status && status !== tenant.status) {
      invalidateTenantStatusCache(tenant.slug);
    }

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
    const tenantResult = await masterDb.query('SELECT * FROM tenants WHERE id = $1', [req.params.id]);
    const tenant = tenantResult.rows[0];
    if (!tenant) return res.status(404).json({ error: 'Tenant not found' });

    let resetRel;
    try {
      const { wrapper: tdb, release } = await getTenantDb(tenant.slug);
      resetRel = release;
      const adminResult = await tdb.query("SELECT id FROM users WHERE role = 'admin' LIMIT 1");
      const admin = adminResult.rows[0];
      if (!admin) return res.status(404).json({ error: 'No admin user found in tenant DB' });

      const hash = await bcrypt.hash(new_password, 10);
      await tdb.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, admin.id]);
      res.json({ message: 'Admin password reset successfully' });
    } finally {
      if (resetRel) resetRel();
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /api/super-admin/tenants/:id ──────────────────────────────────────
// Soft-delete: sets status to 'suspended'. Hard delete must be done manually.
router.delete('/tenants/:id', async (req, res) => {
  try {
    const tenantResult = await masterDb.query('SELECT * FROM tenants WHERE id = $1', [req.params.id]);
    const tenant = tenantResult.rows[0];
    if (!tenant) return res.status(404).json({ error: 'Tenant not found' });

    await masterDb.query(
      "UPDATE tenants SET status = 'suspended', updated_at = NOW() WHERE id = $1",
      [tenant.id]
    );

    res.json({ message: `Tenant '${tenant.company_name}' suspended successfully` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/super-admin/stats ────────────────────────────────────────────────
router.get('/stats', async (req, res) => {
  try {
    const tenantsResult = await masterDb.query('SELECT * FROM tenants');
    const tenants = tenantsResult.rows;
    const total = tenants.length;
    const active = tenants.filter(t => t.status === 'active').length;
    const suspended = tenants.filter(t => t.status === 'suspended').length;
    const trial = tenants.filter(t => t.status === 'trial').length;

    let totalCandidates = 0, totalClients = 0, totalInvoices = 0;
    for (const t of tenants.filter(t => t.status === 'active')) {
      let sRel;
      try {
        const { wrapper: tdb, release } = await getTenantDb(t.slug);
        sRel = release;
        const [cand, cli, inv] = await Promise.all([
          (async () => {
            const res = await tdb.query("SELECT COUNT(*)::int AS c FROM employees WHERE status='active'");
            return res.rows[0];
          })(),
          (async () => {
            const res = await tdb.query("SELECT COUNT(*)::int AS c FROM clients");
            return res.rows[0];
          })(),
          (async () => {
            const res = await tdb.query("SELECT COUNT(*)::int AS c FROM invoices");
            return res.rows[0];
          })(),
        ]);
        totalCandidates += cand.c;
        totalClients    += cli.c;
        totalInvoices   += inv.c;
      } catch {} finally {
        if (sRel) sRel();
      }
    }

    res.json({ total, active, suspended, trial, totalCandidates, totalClients, totalInvoices });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── MODULE MANAGEMENT ─────────────────────────────────────────────────────────

router.get('/tenants/:id/modules', async (req, res) => {
  try {
    const tenantResult = await masterDb.query('SELECT * FROM tenants WHERE id = $1', [req.params.id]);
    const tenant = tenantResult.rows[0];
    if (!tenant) return res.status(404).json({ error: 'Tenant not found' });

    await seedDefaultModulesForTenant(tenant.slug);

    const rowsResult = await masterDb.query(
      'SELECT module_key, enabled, enabled_at FROM tenant_modules WHERE tenant_slug = $1',
      [tenant.slug]
    );
    const rows = rowsResult.rows;

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
    const tenantResult = await masterDb.query('SELECT * FROM tenants WHERE id = $1', [req.params.id]);
    const tenant = tenantResult.rows[0];
    if (!tenant) return res.status(404).json({ error: 'Tenant not found' });

    const { modules } = req.body;
    if (!modules || typeof modules !== 'object') {
      return res.status(400).json({ error: 'modules object required: { module_key: boolean }' });
    }

    const validKeys = new Set(MODULE_REGISTRY.map(m => m.key));

    // Use the wrapper's built-in transaction() — handles BEGIN/COMMIT/ROLLBACK
    // and checks out a dedicated pg client for the duration.
    await masterDb.transaction(async (tx) => {
      for (const [key, enabled] of Object.entries(modules)) {
        if (!validKeys.has(key)) continue;
        await tx.query(`
          INSERT INTO tenant_modules (tenant_slug, module_key, enabled, enabled_at)
          VALUES ($1, $2, $3, NOW())
          ON CONFLICT(tenant_slug, module_key) DO UPDATE SET
            enabled    = excluded.enabled,
            enabled_at = NOW()
        `, [tenant.slug, key, enabled ? true : false]);
      }
    });

    const rowsResult = await masterDb.query(
      'SELECT module_key, enabled, enabled_at FROM tenant_modules WHERE tenant_slug = $1',
      [tenant.slug]
    );
    const rows = rowsResult.rows;
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
    const tenantResult = await masterDb.query('SELECT * FROM tenants WHERE id = $1', [req.params.id]);
    const tenant = tenantResult.rows[0];
    if (!tenant) return res.status(404).json({ error: 'Tenant not found' });

    const moduleKey = req.params.key;
    const moduleDef = MODULE_REGISTRY.find(m => m.key === moduleKey);
    if (!moduleDef) return res.status(404).json({ error: `Module '${moduleKey}' not found in registry` });

    const { enabled } = req.body;
    if (typeof enabled !== 'boolean') {
      return res.status(400).json({ error: 'enabled (boolean) is required' });
    }

    await masterDb.query(`
      INSERT INTO tenant_modules (tenant_slug, module_key, enabled, enabled_at)
      VALUES ($1, $2, $3, NOW())
      ON CONFLICT(tenant_slug, module_key) DO UPDATE SET
        enabled    = excluded.enabled,
        enabled_at = NOW()
    `, [tenant.slug, moduleKey, enabled ? true : false]);

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
    const cfgResult = await masterDb.query('SELECT * FROM platform_ai_config WHERE id = 1');
    const cfg = cfgResult.rows[0] || {};
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
    let paramIndex = 1;
    if (provider !== undefined)          { updates.push(`provider=$${paramIndex++}`); params.push(provider); }
    if (model !== undefined)             { updates.push(`model=$${paramIndex++}`); params.push(model); }
    if (allow_tenant_keys !== undefined) { updates.push(`allow_tenant_keys=$${paramIndex++}`); params.push(allow_tenant_keys ? true : false); }
    if (api_key)                         { updates.push(`api_key=$${paramIndex++}`); params.push(api_key); }
    if (clear_api_key)                   { updates.push('api_key=NULL'); }
    if (updates.length) {
      updates.push('updated_at=NOW()');
      params.push(1);
      await masterDb.query(`UPDATE platform_ai_config SET ${updates.join(', ')} WHERE id=$${paramIndex}`, params);
    }
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Demo Requests (Leads) ──────────────────────────────────────────────────────
// Mount the shared demo-request router at /demo-requests under the super-admin
// middleware chain so all endpoints are already auth-gated.
const demoRequestRouter = require('./demoRequests');
router.use('/demo-requests', demoRequestRouter);

module.exports = router;
