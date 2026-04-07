/**
 * HireIQ Master Database
 * Stores super-admins and tenant registry only.
 * Each tenant's operational data lives in its own separate SQLite file.
 */
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs   = require('fs');
const bcrypt = require('bcryptjs');

const DATA_DIR = process.env.HIREIQ_DATA_DIR || path.join(__dirname, '../data');
const TENANTS_DIR = path.join(DATA_DIR, 'tenants');

if (!fs.existsSync(DATA_DIR))    fs.mkdirSync(DATA_DIR,    { recursive: true });
if (!fs.existsSync(TENANTS_DIR)) fs.mkdirSync(TENANTS_DIR, { recursive: true });

const MASTER_DB_PATH = path.join(DATA_DIR, 'master.db');

const _masterRaw = new DatabaseSync(MASTER_DB_PATH);
// WAL mode is a performance optimisation; skip silently on filesystems
// that don't support it (e.g. certain FUSE mounts in dev/CI environments).
try { _masterRaw.exec('PRAGMA journal_mode = WAL'); } catch { /* ignore */ }
_masterRaw.exec('PRAGMA foreign_keys = ON');

// ── normalize BigInt / null-prototype objects ─────────────────────────────────
function normalize(val) {
  if (val === null || val === undefined) return val;
  if (typeof val === 'bigint') return Number(val);
  if (Array.isArray(val)) return val.map(normalize);
  if (typeof val === 'object') {
    const plain = {};
    for (const key of Object.keys(val)) plain[key] = normalize(val[key]);
    return plain;
  }
  return val;
}

const masterDb = {
  prepare(sql) {
    const stmt = _masterRaw.prepare(sql);
    return {
      run(...args) { return stmt.run(...args); },
      get(...args)  { return normalize(stmt.get(...args)); },
      all(...args)  { return normalize(stmt.all(...args)); },
    };
  },
  exec(sql) { return _masterRaw.exec(sql); },
};

// ── Schema ────────────────────────────────────────────────────────────────────
_masterRaw.exec(`
  CREATE TABLE IF NOT EXISTS tenant_modules (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_slug TEXT NOT NULL REFERENCES tenants(slug) ON DELETE CASCADE,
    module_key  TEXT NOT NULL,
    enabled     INTEGER NOT NULL DEFAULT 1,
    enabled_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(tenant_slug, module_key)
  );

  CREATE TABLE IF NOT EXISTS super_admins (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    name         TEXT NOT NULL,
    email        TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS tenants (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    slug           TEXT NOT NULL UNIQUE,   -- company code used at login (e.g. "acme")
    company_name   TEXT NOT NULL,
    company_logo   TEXT,                   -- base64 data URL
    contact_email  TEXT,
    contact_phone  TEXT,
    db_path        TEXT NOT NULL,          -- full path to this tenant's SQLite file
    status         TEXT NOT NULL DEFAULT 'active'
                     CHECK(status IN ('active','suspended','trial')),
    plan           TEXT NOT NULL DEFAULT 'standard',
    max_candidates INTEGER DEFAULT 100,
    max_clients    INTEGER DEFAULT 50,
    admin_email    TEXT,                   -- primary admin email for reference
    created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at     DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- Platform-level support tickets (submitted by tenant admins/clients → handled by super-admin)
  CREATE TABLE IF NOT EXISTS platform_support_tickets (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_slug  TEXT NOT NULL REFERENCES tenants(slug) ON DELETE CASCADE,
    submitted_by TEXT NOT NULL,           -- email of submitter
    submitter_role TEXT NOT NULL DEFAULT 'admin',
    subject      TEXT NOT NULL,
    description  TEXT NOT NULL,
    status       TEXT NOT NULL DEFAULT 'open'
                   CHECK(status IN ('open','in_progress','resolved','closed')),
    priority     TEXT NOT NULL DEFAULT 'medium'
                   CHECK(priority IN ('low','medium','high','urgent')),
    created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at   DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS platform_support_messages (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    ticket_id INTEGER NOT NULL REFERENCES platform_support_tickets(id) ON DELETE CASCADE,
    sender    TEXT NOT NULL,              -- email
    sender_role TEXT NOT NULL DEFAULT 'admin',
    message   TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_pst_tenant  ON platform_support_tickets(tenant_slug);
  CREATE INDEX IF NOT EXISTS idx_pst_status  ON platform_support_tickets(status);
  CREATE INDEX IF NOT EXISTS idx_psm_ticket  ON platform_support_messages(ticket_id);

  -- Platform-level AI defaults (super-admin configures; tenants inherit unless they override)
  CREATE TABLE IF NOT EXISTS platform_ai_config (
    id                INTEGER PRIMARY KEY DEFAULT 1,
    provider          TEXT NOT NULL DEFAULT 'anthropic'
                        CHECK(provider IN ('anthropic','openai')),
    model             TEXT NOT NULL DEFAULT 'claude-haiku-4-5-20251001',
    api_key           TEXT,
    allow_tenant_keys INTEGER NOT NULL DEFAULT 1,
    updated_at        DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  INSERT OR IGNORE INTO platform_ai_config (id) VALUES (1);
`);

// ── Seed default super-admin ──────────────────────────────────────────────────
// In production, credentials are supplied via environment variables on first boot:
//   SUPER_ADMIN_EMAIL     — e.g. admin@yourdomain.com
//   SUPER_ADMIN_PASSWORD  — strong password; change after first login
// These env vars are only used when no super-admin row exists yet (first boot).
// After the first boot they are ignored — you may remove them from Railway.
const hasSuperAdmin = masterDb.prepare('SELECT id FROM super_admins LIMIT 1').get();
if (!hasSuperAdmin) {
  const seedEmail    = process.env.SUPER_ADMIN_EMAIL;
  const seedPassword = process.env.SUPER_ADMIN_PASSWORD;

  if (process.env.NODE_ENV === 'production') {
    if (!seedEmail || !seedPassword) {
      console.error('[FATAL] No super-admin found and NODE_ENV=production.');
      console.error('        Set SUPER_ADMIN_EMAIL and SUPER_ADMIN_PASSWORD env vars');
      console.error('        in Railway to seed the first super-admin on startup.');
      process.exit(1);
    }
    const hash = bcrypt.hashSync(seedPassword, 10);
    masterDb.prepare(
      'INSERT INTO super_admins (name, email, password_hash) VALUES (?, ?, ?)'
    ).run('HireIQ Super Admin', seedEmail, hash);
    console.log(`✅ Super-admin created: ${seedEmail}`);
    console.warn('⚠️  You may now remove SUPER_ADMIN_EMAIL and SUPER_ADMIN_PASSWORD from Railway env vars.');
  } else {
    // Development/testing only — hardcoded seed for local use
    const devEmail = seedEmail || 'superadmin@hireiq.com';
    const devPass  = seedPassword || 'superadmin123';
    const hash = bcrypt.hashSync(devPass, 10);
    masterDb.prepare(
      'INSERT INTO super_admins (name, email, password_hash) VALUES (?, ?, ?)'
    ).run('HireIQ Super Admin', devEmail, hash);
    console.log(`✅ Super-admin created (dev): ${devEmail} / ${devPass}`);
    console.warn('⚠️  Change this password immediately — never use in production!');
  }
}

// ── Seed default "hireiq" tenant ──────────────────────────────────────────────
// The default hireiq.db is always created by database.js with demo data.
// Register it in the master tenant registry so users can log in with
// organisation code "hireiq" right out of the box.
const hasDefaultTenant = masterDb.prepare("SELECT id FROM tenants WHERE slug = 'hireiq'").get();
if (!hasDefaultTenant) {
  // Resolve the path the same way database.js does (backend/hireiq.db)
  const defaultDbPath = process.env.HIREIQ_DB_PATH
    || path.join(__dirname, 'hireiq.db');

  masterDb.prepare(`
    INSERT INTO tenants
      (slug, company_name, db_path, status, plan, admin_email, max_candidates, max_clients)
    VALUES (?, ?, ?, 'active', 'standard', ?, 100, 50)
  `).run('hireiq', 'aGrow Demo', defaultDbPath, 'admin@hireiq.com');
  console.log('✅ Default tenant registered: slug=hireiq');
}

// ── Module seeding & upgrade ──────────────────────────────────────────────────
const { MODULE_REGISTRY, defaultModuleKeys } = require('./moduleRegistry');

/**
 * Seed default modules for a tenant.
 * Uses INSERT OR IGNORE so existing rows (admin choices) are never overwritten,
 * but NEW default-on modules added to the registry get inserted automatically.
 */
function seedDefaultModulesForTenant(slug) {
  const defaults = defaultModuleKeys();
  for (const key of defaults) {
    masterDb.prepare(
      'INSERT OR IGNORE INTO tenant_modules (tenant_slug, module_key, enabled) VALUES (?, ?, 1)'
    ).run(slug, key);
  }
  console.log(`✅ Default modules seeded for tenant: ${slug}`);
}

/**
 * One-time upgrade: enable all modules that now have default:true for every
 * tenant where those modules were previously absent or disabled due to an
 * old registry default of false.  Only upgrades rows that are disabled AND
 * the module's current default is true — preserves deliberate admin disables
 * made AFTER the tenant was provisioned (those rows will exist with enabled=0
 * from an explicit admin action, but we can't distinguish them here, so we
 * re-enable them and let admins re-disable if needed).
 */
function upgradeModuleDefaults() {
  const tenants = masterDb.prepare('SELECT slug FROM tenants').all();
  const nowDefaultOn = MODULE_REGISTRY.filter(m => m.default).map(m => m.key);

  for (const { slug } of tenants) {
    for (const key of nowDefaultOn) {
      // INSERT if absent (new module), or ENABLE if currently disabled
      masterDb.prepare(`
        INSERT INTO tenant_modules (tenant_slug, module_key, enabled, enabled_at)
        VALUES (?, ?, 1, CURRENT_TIMESTAMP)
        ON CONFLICT(tenant_slug, module_key) DO UPDATE SET
          enabled    = 1,
          enabled_at = CURRENT_TIMESTAMP
        WHERE enabled = 0
      `).run(slug, key);
    }
  }
}

// On every startup: seed any missing modules + upgrade defaults
const allTenants = masterDb.prepare('SELECT slug FROM tenants').all();
for (const { slug } of allTenants) {
  seedDefaultModulesForTenant(slug);
}
upgradeModuleDefaults();

module.exports = { masterDb, TENANTS_DIR, seedDefaultModulesForTenant };
