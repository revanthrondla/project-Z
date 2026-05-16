/**
 * Flow Master Database (PostgreSQL version)
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
    mfa_enabled   BOOLEAN NOT NULL DEFAULT FALSE,
    mfa_secret    TEXT,
    mfa_backup_codes JSONB DEFAULT '[]',
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
    sso_enabled    BOOLEAN NOT NULL DEFAULT FALSE,
    sso_provider   TEXT DEFAULT 'google',
    sso_domain     TEXT,
    mfa_required   BOOLEAN NOT NULL DEFAULT FALSE,  -- legacy, superseded by mfa_policy
    mfa_policy     TEXT NOT NULL DEFAULT 'off'
                   CHECK(mfa_policy IN ('off','optional','required','admin_required')),
    mfa_methods    JSONB NOT NULL DEFAULT '["totp"]',
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

  CREATE TABLE IF NOT EXISTS demo_requests (
    id           BIGSERIAL PRIMARY KEY,
    name         TEXT NOT NULL,
    email        TEXT NOT NULL,
    company      TEXT,
    phone        TEXT,
    message      TEXT,
    status       TEXT NOT NULL DEFAULT 'new'
                 CHECK(status IN ('new','contacted','qualified','disqualified','converted')),
    source       TEXT NOT NULL DEFAULT 'homepage',
    ip_address   TEXT,
    created_at   TIMESTAMPTZ DEFAULT NOW(),
    updated_at   TIMESTAMPTZ DEFAULT NOW()
  );

  -- Fast email → tenant lookup for seamless login (no org code required)
  CREATE TABLE IF NOT EXISTS user_tenant_index (
    email       TEXT NOT NULL,
    tenant_slug TEXT NOT NULL,
    PRIMARY KEY (email, tenant_slug)
  );

  -- ── SOC 2: Account lockout tracking (CC6.1) ───────────────────────────────
  -- Tracks failed login attempts per email+tenant. Accounts are locked for
  -- LOCKOUT_DURATION_MINUTES after MAX_FAILED_ATTEMPTS consecutive failures.
  CREATE TABLE IF NOT EXISTS login_attempts (
    id              BIGSERIAL PRIMARY KEY,
    email           TEXT NOT NULL,
    tenant_slug     TEXT,                     -- NULL for super-admin attempts
    attempts        INTEGER NOT NULL DEFAULT 0,
    locked_until    TIMESTAMPTZ,
    last_attempt_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(email, tenant_slug)
  );

  -- ── SOC 2: Token revocation list (CC6.1) ─────────────────────────────────
  -- JTI (JWT ID) of tokens that have been explicitly revoked (logout, admin
  -- revoke, password change). Checked on every authenticated request.
  -- Expired entries are purged by the nightly retention job.
  CREATE TABLE IF NOT EXISTS token_revocations (
    jti         TEXT PRIMARY KEY,
    tenant_slug TEXT,
    user_id     BIGINT,
    revoked_at  TIMESTAMPTZ DEFAULT NOW(),
    expires_at  TIMESTAMPTZ NOT NULL,         -- when the original JWT would have expired
    reason      TEXT NOT NULL DEFAULT 'logout'
  );

  -- ── SOC 2: Immutable audit log (CC7.2) ───────────────────────────────────
  -- Centralised across all tenants so tenant admins cannot tamper with their
  -- own logs. Includes tenant_slug for tenant-scoped views.
  -- (Supersedes per-tenant audit_logs tables which remain for legacy reads.)
  CREATE TABLE IF NOT EXISTS security_audit_logs (
    id          BIGSERIAL PRIMARY KEY,
    tenant_slug TEXT,
    table_name  TEXT NOT NULL,
    record_id   TEXT,
    action      TEXT NOT NULL,
    changed_by  BIGINT,
    changed_at  TIMESTAMPTZ DEFAULT NOW(),
    old_values  JSONB,
    new_values  JSONB,
    ip_address  TEXT,
    user_agent  TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_tenants_slug         ON tenants(slug);
  CREATE INDEX IF NOT EXISTS idx_tenant_modules_key   ON tenant_modules(tenant_slug, module_key);
  CREATE INDEX IF NOT EXISTS idx_demo_requests_status ON demo_requests(status);
  CREATE INDEX IF NOT EXISTS idx_demo_requests_email  ON demo_requests(email);
  CREATE INDEX IF NOT EXISTS idx_pst_tenant           ON platform_support_tickets(tenant_slug);
  CREATE INDEX IF NOT EXISTS idx_pst_status           ON platform_support_tickets(status);
  CREATE INDEX IF NOT EXISTS idx_psm_ticket           ON platform_support_messages(ticket_id);
  CREATE INDEX IF NOT EXISTS idx_uti_email            ON user_tenant_index(email);
  CREATE INDEX IF NOT EXISTS idx_login_attempts_email ON login_attempts(email, tenant_slug);
  CREATE INDEX IF NOT EXISTS idx_token_rev_jti        ON token_revocations(jti);
  CREATE INDEX IF NOT EXISTS idx_token_rev_expires    ON token_revocations(expires_at);
  CREATE INDEX IF NOT EXISTS idx_sal_tenant           ON security_audit_logs(tenant_slug, changed_at DESC);
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

    // ── Column migrations (idempotent — safe to run on every start) ────────────
    // MFA columns on super_admins
    await client.query(`ALTER TABLE super_admins ADD COLUMN IF NOT EXISTS mfa_enabled BOOLEAN NOT NULL DEFAULT FALSE`);
    await client.query(`ALTER TABLE super_admins ADD COLUMN IF NOT EXISTS mfa_secret TEXT`);
    await client.query(`ALTER TABLE super_admins ADD COLUMN IF NOT EXISTS mfa_backup_codes JSONB DEFAULT '[]'`);
    // SSO + MFA enforcement on tenants
    await client.query(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS sso_enabled BOOLEAN NOT NULL DEFAULT FALSE`);
    await client.query(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS sso_provider TEXT NOT NULL DEFAULT 'google'`);
    await client.query(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS sso_domain TEXT`);
    await client.query(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS mfa_required BOOLEAN NOT NULL DEFAULT FALSE`);
    await client.query(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS mfa_policy TEXT NOT NULL DEFAULT 'off'`);
    await client.query(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS mfa_methods JSONB NOT NULL DEFAULT '["totp"]'`);

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
  const seedEmail    = process.env.SUPER_ADMIN_EMAIL;
  const seedPassword = process.env.SUPER_ADMIN_PASSWORD;

  // If env vars are present, always upsert the super-admin with those credentials.
  // This allows password recovery: set the env vars in Railway, redeploy, then
  // optionally clear them again after logging in.
  if (seedEmail && seedPassword) {
    const hash = await bcrypt.hash(seedPassword, 10);
    await masterDb.prepare(`
      INSERT INTO super_admins (name, email, password_hash)
      VALUES ($1, $2, $3)
      ON CONFLICT (email) DO UPDATE
        SET password_hash = EXCLUDED.password_hash
    `).run('Flow Super Admin', seedEmail.toLowerCase().trim(), hash);
    console.log(`✅ Super-admin upserted: ${seedEmail}`);
    return;
  }

  // No env vars — only create a default row if none exists at all.
  const existing = await masterDb.prepare('SELECT id FROM super_admins LIMIT 1').get();
  if (existing) return;

  if (process.env.NODE_ENV === 'production') {
    console.error('[FATAL] No super-admin found and NODE_ENV=production.');
    console.error('        Set SUPER_ADMIN_EMAIL and SUPER_ADMIN_PASSWORD env vars in Railway and redeploy.');
    process.exit(1);
  } else {
    const devEmail = 'superadmin@hireiq.com';
    const devPass  = 'superadmin123';
    const hash = await bcrypt.hash(devPass, 10);
    await masterDb.prepare(
      'INSERT INTO super_admins (name, email, password_hash) VALUES ($1, $2, $3)'
    ).run('Flow Super Admin', devEmail, hash);
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
    `).run('hireiq', 'Flow Demo', 'admin@hireiq.com');
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

/**
 * masterDbProxy — a stable object reference that routes can safely destructure
 * at module-load time (before initMaster() runs).
 *
 * Why a proxy instead of a getter:
 *   `const { masterDb } = require('../masterDatabase')` calls any property
 *   getter on the exports object immediately at destructure time.  If initMaster()
 *   hasn't run yet that throws "Master DB not initialised".
 *
 *   A Proxy is an ordinary object — destructuring just copies the reference.
 *   The `get` trap only fires when a property is READ on that object (e.g.
 *   `masterDb.prepare`), which only happens inside route handlers, by which
 *   point initMaster() has always completed (enforced by the dbReady gate in
 *   server.js that returns 503 for all API routes until dbReady = true).
 */
const masterDbProxy = new Proxy({}, {
  get(_, prop) {
    if (!masterDb) throw new Error('Master DB not initialised — call initMaster() first');
    const val = masterDb[prop];
    return typeof val === 'function' ? val.bind(masterDb) : val;
  },
  has(_, prop) {
    return masterDb ? prop in masterDb : false;
  },
});

/**
 * indexUserEmail(email, tenantSlug)
 *
 * Upserts a row into user_tenant_index so the email→tenant mapping is
 * available for seamless login (no org-code required).
 *
 * Call this immediately after any INSERT INTO users in a tenant schema.
 * Safe to call multiple times — idempotent ON CONFLICT DO NOTHING.
 */
async function indexUserEmail(email, tenantSlug) {
  try {
    if (!masterDb) return; // Called before initMaster — skip silently
    await masterDb.query(
      `INSERT INTO user_tenant_index (email, tenant_slug)
       VALUES ($1, $2)
       ON CONFLICT (email, tenant_slug) DO NOTHING`,
      [email.toLowerCase().trim(), tenantSlug]
    );
  } catch (err) {
    // Never throw — index failure must not break user creation
    console.error('[indexUserEmail] Failed to index user email:', err.message);
  }
}

/**
 * removeUserEmailIndex(email, tenantSlug)
 *
 * Removes an email from the index when a user is deleted from a tenant.
 */
async function removeUserEmailIndex(email, tenantSlug) {
  try {
    if (!masterDb) return;
    await masterDb.query(
      'DELETE FROM user_tenant_index WHERE email = $1 AND tenant_slug = $2',
      [email.toLowerCase().trim(), tenantSlug]
    );
  } catch (err) {
    console.error('[removeUserEmailIndex] Failed to remove index entry:', err.message);
  }
}

// ── SOC 2: Account lockout helpers ───────────────────────────────────────────
const MAX_FAILED_ATTEMPTS   = 5;
const LOCKOUT_MINUTES       = 30;

/**
 * Check if an email+tenant combination is currently locked out.
 * Returns { locked: true, lockedUntil } or { locked: false }.
 */
async function checkLoginLockout(email, tenantSlug) {
  try {
    const key = email.toLowerCase().trim();
    const row = await masterDb.prepare(
      'SELECT attempts, locked_until FROM login_attempts WHERE email = $1 AND tenant_slug IS NOT DISTINCT FROM $2'
    ).get(key, tenantSlug ?? null);

    if (!row) return { locked: false };
    if (row.locked_until && new Date(row.locked_until) > new Date()) {
      return { locked: true, lockedUntil: row.locked_until };
    }
    return { locked: false };
  } catch (err) {
    console.error('[lockout check]', err.message);
    return { locked: false }; // fail-open so a DB hiccup doesn't lock everyone out
  }
}

/**
 * Record a failed login attempt. Locks the account after MAX_FAILED_ATTEMPTS.
 */
async function recordFailedLogin(email, tenantSlug) {
  try {
    const key = email.toLowerCase().trim();
    await masterDb.query(`
      INSERT INTO login_attempts (email, tenant_slug, attempts, last_attempt_at)
      VALUES ($1, $2, 1, NOW())
      ON CONFLICT (email, tenant_slug) DO UPDATE
        SET attempts        = login_attempts.attempts + 1,
            last_attempt_at = NOW(),
            locked_until    = CASE
              WHEN login_attempts.attempts + 1 >= $3
              THEN NOW() + ($4 || ' minutes')::INTERVAL
              ELSE login_attempts.locked_until
            END
    `, [key, tenantSlug ?? null, MAX_FAILED_ATTEMPTS, LOCKOUT_MINUTES]);
  } catch (err) {
    console.error('[recordFailedLogin]', err.message);
  }
}

/** Reset failed attempts on successful login. */
async function clearLoginAttempts(email, tenantSlug) {
  try {
    const key = email.toLowerCase().trim();
    await masterDb.query(
      'DELETE FROM login_attempts WHERE email = $1 AND tenant_slug IS NOT DISTINCT FROM $2',
      [key, tenantSlug ?? null]
    );
  } catch (err) {
    console.error('[clearLoginAttempts]', err.message);
  }
}

// ── SOC 2: Token revocation helpers ──────────────────────────────────────────

/** Revoke a JWT by its jti claim. */
async function revokeToken(jti, expiresAt, tenantSlug, userId, reason = 'logout') {
  try {
    await masterDb.query(`
      INSERT INTO token_revocations (jti, tenant_slug, user_id, expires_at, reason)
      VALUES ($1, $2, $3, to_timestamp($4), $5)
      ON CONFLICT (jti) DO NOTHING
    `, [jti, tenantSlug ?? null, userId ?? null, expiresAt, reason]);
  } catch (err) {
    console.error('[revokeToken]', err.message);
  }
}

/** Returns true if the jti has been revoked. */
async function isTokenRevoked(jti) {
  try {
    const row = await masterDb.prepare(
      'SELECT 1 FROM token_revocations WHERE jti = $1 AND expires_at > NOW()'
    ).get(jti);
    return !!row;
  } catch (err) {
    console.error('[isTokenRevoked]', err.message);
    return false; // fail-open
  }
}

/** Purge expired revocation records (run nightly). */
async function purgeExpiredRevocations() {
  try {
    const res = await masterDb.query('DELETE FROM token_revocations WHERE expires_at < NOW()');
    if (res.rowCount > 0) console.log(`🧹 Purged ${res.rowCount} expired token revocations`);
  } catch (err) {
    console.error('[purgeExpiredRevocations]', err.message);
  }
}

// ── SOC 2: Centralised audit log writer ───────────────────────────────────────

/** Write an audit record to the tamper-resistant master security_audit_logs. */
async function writeSecurityAuditLog({ tenantSlug, tableName, recordId, action, changedBy, oldValues, newValues, ipAddress, userAgent }) {
  try {
    await masterDb.query(`
      INSERT INTO security_audit_logs
        (tenant_slug, table_name, record_id, action, changed_by, old_values, new_values, ip_address, user_agent)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
    `, [
      tenantSlug   ?? null,
      tableName,
      recordId     ? String(recordId) : null,
      action,
      changedBy    ?? null,
      oldValues    ? JSON.stringify(oldValues) : null,
      newValues    ? JSON.stringify(newValues) : null,
      ipAddress    ?? null,
      userAgent    ? String(userAgent).slice(0, 255) : null,
    ]);
  } catch (err) {
    console.error('[writeSecurityAuditLog]', err.message);
  }
}

module.exports = {
  masterDb: masterDbProxy,   // safe to destructure at module level — no getter
  initMaster,
  seedDefaultModulesForTenant,
  getMasterDb,
  indexUserEmail,
  removeUserEmailIndex,
  // SOC 2 helpers
  checkLoginLockout,
  recordFailedLogin,
  clearLoginAttempts,
  revokeToken,
  isTokenRevoked,
  purgeExpiredRevocations,
  writeSecurityAuditLog,
};
