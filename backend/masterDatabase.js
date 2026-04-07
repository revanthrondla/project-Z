/**
 * HireIQ Master Database (PostgreSQL version)
 *
 * Uses the 'master' schema in the shared PostgreSQL database.
 * Stores: super_admins, tenants, tenant_modules, platform support, AI config.
 */
const pool = require('./db/pool');
const { createWrapper, createScopedWrapper } = require('./db/wrapper');
const bcrypt = require('bcryptjs');

// Master DB wrapper — scoped to the 'master' schema.
// All master-level queries use this (synchronous-looking but async under hood).
let masterDb = null;

const MASTER_DDL = `
  CREATE TABLE IF NOT EXISTS super_admins (
    id            BIGSERIAL PRIMARY KEY,
    name          TEXT NOT NULL,
    email         TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at    TIMESTAMPTZ DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS tenants (
    id             BIGSERIAL PRIMARY KEY,
    slug           TEXT NOT NULL UNIQUE,
    company_name   TEXT NOT NULL,
    company_logo   TEXT,
    contact_email  TEXT,
    contact_phone  TEXT,
    status         TEXT NOT NULL DEFAULT 'active'
                   CHECK(status IN ('active','suspended','trial')),
    plan           TEXT NOT NULL DEFAULT 'standard',
    max_candidates INTEGER DEFAULT 100,
    max_clients    INTEGER DEFAULT 50,
    admin_email    TEXT,
    created_at     TIMESTAMPTZ DEFAULT NOW(),
    updated_at     TIMESTAMPTZ DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS tenant_modules (
    id          BIGSERIAL PRIMARY KEY,
    tenant_slug TEXT NOT NULL REFERENCES tenants(slug) ON DELETE CASCADE,
    module_key  TEXT NOT NULL,
    enabled     BOOLEAN NOT NULL DEFAULT TRUE,
    enabled_at  TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(tenant_slug, module_key)
  );

  CREATE TABLE IF NOT EXISTS platform_support_tickets (
    id             BIGSERIAL PRIMARY KEY,
    tenant_slug    TEXT NOT NULL REFERENCES tenants(slug) ON DELETE CASCADE,
    submitted_by   TEXT NOT NULL,
    submitter_role TEXT NOT NULL DEFAULT 'admin',
    subject        TEXT NOT NULL,
    description    TEXT NOT NULL,
    status         TEXT NOT NULL DEFAULT 'open'
                   CHECK(status IN ('open','in_progress','resolved','closed')),
    priority       TEXT NOT NULL DEFAULT 'medium'
                   CHECK(priority IN ('low','medium','high','urgent')),
    created_at     TIMESTAMPTZ DEFAULT NOW(),
    updated_at     TIMESTAMPTZ DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS platform_support_messages (
    id          BIGSERIAL PRIMARY KEY,
    ticket_id   BIGINT NOT NULL REFERENCES platform_support_tickets(id) ON DELETE CASCADE,
    sender      TEXT NOT NULL,
    sender_role TEXT NOT NULL DEFAULT 'admin',
    message     TEXT NOT NULL,
    created_at  TIMESTAMPTZ DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS platform_ai_config (
    id                 BIGSERIAL PRIMARY KEY,
    provider           TEXT NOT NULL DEFAULT 'anthropic'
                       CHECK(provider IN ('anthropic','openai')),
    model              TEXT NOT NULL DEFAULT 'claude-haiku-4-5-20251001',
    api_key            TEXT,
    allow_tenant_keys  BOOLEAN NOT NULL DEFAULT TRUE,
    updated_at         TIMESTAMPTZ DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS audit_logs (
    id         BIGSERIAL PRIMARY KEY,
    table_name TEXT NOT NULL,
    record_id  BIGINT,
    action     TEXT NOT NULL CHECK(action IN ('INSERT','UPDATE','DELETE')),
    changed_by BIGINT,
    changed_at TIMESTAMPTZ DEFAULT NOW(),
    old_values JSONB,
    new_values JSONB,
    ip_address TEXT,
    user_agent TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_tenants_slug       ON tenants(slug);
  CREATE INDEX IF NOT EXISTS idx_tenant_modules_key ON tenant_modules(tenant_slug, module_key);
  CREATE INDEX IF NOT EXISTS idx_pst_tenant         ON platform_support_tickets(tenant_slug);
  CREATE INDEX IF NOT EXISTS idx_pst_status         ON platform_support_tickets(status);
  CREATE INDEX IF NOT EXISTS idx_psm_ticket         ON platform_support_messages(ticket_id);
`;

/**
 * Initialise the master schema and tables.
 * Called once at server startup. Idempotent.
 */
async function initMaster() {
  const client = await pool.connect();
  try {
    // Create the master schema
    await client.query('CREATE SCHEMA IF NOT EXISTS master');
    await client.query('SET search_path TO master');
    await client.query(MASTER_DDL);

    // Seed platform_ai_config default row
    await client.query(`
      INSERT INTO platform_ai_config (provider, model, allow_tenant_keys)
      VALUES ('anthropic', 'claude-haiku-4-5-20251001', TRUE)
      ON CONFLICT DO NOTHING
    `);

    console.log('✅ Master schema ready');
  } finally {
    client.release();
  }

  // Create the reusable masterDb wrapper
  const { wrapper } = await createScopedWrapper(pool, 'master');
  masterDb = wrapper;

  await seedSuperAdmin();
  await seedDefaultTenant();
  await runModuleUpgrades();
}

async function seedSuperAdmin() {
  const existing = await masterDb.prepare('SELECT id FROM super_admins LIMIT 1').get();
  if (existing) return;

  const seedEmail    = process.env.SUPER_ADMIN_EMAIL;
  const seedPassword = process.env.SUPER_ADMIN_PASSWORD;

  if (process.env.NODE_ENV === 'production') {
    if (!seedEmail || !seedPassword) {
      console.error('[FATAL] No super-admin found and NODE_ENV=production.');
      console.error('        Set SUPER_ADMIN_EMAIL and SUPER_ADMIN_PASSWORD env vars in Railway.');
      process.exit(1);
    }
    const hash = await bcrypt.hash(seedPassword, 10);
    await masterDb.prepare(
      'INSERT INTO super_admins (name, email, password_hash) VALUES ($1, $2, $3)'
    ).run('HireIQ Super Admin', seedEmail, hash);
    console.log(`✅ Super-admin created: ${seedEmail}`);
    console.warn('⚠️  Remove SUPER_ADMIN_EMAIL and SUPER_ADMIN_PASSWORD from Railway after first login.');
  } else {
    const devEmail = seedEmail || 'superadmin@hireiq.com';
    const devPass  = seedPassword || 'superadmin123';
    const hash = await bcrypt.hash(devPass, 10);
    await masterDb.prepare(
      'INSERT INTO super_admins (name, email, password_hash) VALUES ($1, $2, $3)'
    ).run('HireIQ Super Admin', devEmail, hash);
    console.log(`✅ Super-admin created (dev): ${devEmail} / ${devPass}`);
  }
}

async function seedDefaultTenant() {
  const { bootstrapDefaultTenant, createTenantSchema } = require('./database');

  const existing = await masterDb.prepare("SELECT id FROM tenants WHERE slug = 'hireiq'").get();
  if (!existing) {
    await masterDb.prepare(`
      INSERT INTO tenants (slug, company_name, status, plan, admin_email, max_candidates, max_clients)
      VALUES ($1, $2, 'active', 'standard', $3, 100, 50)
    `).run('hireiq', 'HireIQ Demo', 'admin@hireiq.com');
    console.log('✅ Default tenant registered: slug=hireiq');
  }

  // Ensure the tenant schema + tables + seed data exist
  try {
    await createTenantSchema('hireiq');
    const { initializeTenantData } = require('./database');
    await initializeTenantData('hireiq');
  } catch (err) {
    // Schema may already exist — that's fine
    if (!err.message?.includes('already exists')) {
      console.error('[seedDefaultTenant]', err.message);
    }
  }
}

async function runModuleUpgrades() {
  const { MODULE_REGISTRY, defaultModuleKeys } = require('./moduleRegistry');

  const tenants = await masterDb.prepare('SELECT slug FROM tenants').all();
  for (const { slug } of tenants) {
    await seedDefaultModulesForTenant(slug);
  }

  // Enable any newly-default modules for all tenants
  const nowDefaultOn = MODULE_REGISTRY.filter(m => m.default).map(m => m.key);
  for (const { slug } of tenants) {
    for (const key of nowDefaultOn) {
      await masterDb.prepare(`
        INSERT INTO tenant_modules (tenant_slug, module_key, enabled)
        VALUES ($1, $2, TRUE)
        ON CONFLICT (tenant_slug, module_key) DO UPDATE
          SET enabled = TRUE, enabled_at = NOW()
          WHERE tenant_modules.enabled = FALSE
      `).run(slug, key);
    }
  }
}

async function seedDefaultModulesForTenant(slug) {
  const { defaultModuleKeys } = require('./moduleRegistry');
  const defaults = defaultModuleKeys();
  for (const key of defaults) {
    await masterDb.prepare(`
      INSERT INTO tenant_modules (tenant_slug, module_key, enabled)
      VALUES ($1, $2, TRUE)
      ON CONFLICT (tenant_slug, module_key) DO NOTHING
    `).run(slug, key);
  }
}

/**
 * getMasterDb() — returns the master schema wrapper.
 * Throws if initMaster() hasn't been called yet.
 */
function getMasterDb() {
  if (!masterDb) throw new Error('Master DB not initialised — call initMaster() first');
  return masterDb;
}

// Proxy object so `require('./masterDatabase').masterDb.prepare(...)` works
// the same way as before, without callers needing to await getMasterDb().
const masterDbProxy = new Proxy({}, {
  get(_, prop) {
    const db = getMasterDb();
    return db[prop];
  }
});

module.exports = {
  get masterDb() { return getMasterDb(); },
  initMaster,
  seedDefaultModulesForTenant,
  getMasterDb,
};
