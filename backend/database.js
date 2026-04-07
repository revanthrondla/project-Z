const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const bcrypt = require('bcryptjs');
const fs = require('fs');

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

// ── Creates a fully-featured wrapper around a raw DatabaseSync instance ───────
function createDbWrapper(rawDb) {
  /**
   * Returns a callable function — mirrors better-sqlite3's transaction API.
   * Usage:  db.transaction(fn)()        — executes fn() inside BEGIN/COMMIT
   *         db.transaction(fn)(a, b)    — passes args to fn
   *
   * Routes call db.transaction(fn)() so the wrapper must return a function,
   * not execute immediately.
   */
  function transaction(fn) {
    return function transactionFn(...args) {
      rawDb.exec('BEGIN');
      try {
        const result = fn(...args);
        rawDb.exec('COMMIT');
        return result;
      } catch (err) {
        rawDb.exec('ROLLBACK');
        throw err;
      }
    };
  }

  return {
    prepare(sql) {
      const stmt = rawDb.prepare(sql);
      return {
        run(...args)  { return stmt.run(...args); },
        get(...args)  { return normalize(stmt.get(...args)); },
        all(...args)  { return normalize(stmt.all(...args)); },
      };
    },
    exec(sql)   { return rawDb.exec(sql); },
    transaction,
    _raw: rawDb,  // expose raw instance for migrations
  };
}

// ── Open and bootstrap a SQLite database at the given path ───────────────────
function openDatabase(dbPath) {
  const raw = new DatabaseSync(dbPath);
  // WAL mode is a performance optimisation; skip silently on filesystems
  // that don't support it (e.g. certain FUSE mounts in dev/CI environments).
  try { raw.exec('PRAGMA journal_mode = WAL'); } catch { /* ignore */ }
  raw.exec('PRAGMA foreign_keys = ON');
  return raw;
}

// ── Default (legacy) database ─────────────────────────────────────────────────
// Used by the default tenant and for backward-compat during migration.
const DB_PATH = process.env.HIREIQ_DB_PATH || path.join(__dirname, 'hireiq.db');
const _defaultRaw = openDatabase(DB_PATH);
const defaultDbWrapper = createDbWrapper(_defaultRaw);

function initializeDatabase(wrapper, raw) {
  raw.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('admin', 'candidate', 'client')),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS clients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      contact_name TEXT,
      contact_email TEXT,
      address TEXT,
      billing_currency TEXT DEFAULT 'USD',
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS candidates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      phone TEXT,
      role TEXT NOT NULL,
      hourly_rate REAL NOT NULL DEFAULT 0,
      client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL,
      start_date TEXT, end_date TEXT,
      status TEXT DEFAULT 'active' CHECK(status IN ('active','inactive','pending')),
      contract_type TEXT DEFAULT 'contractor' CHECK(contract_type IN ('contractor','employee','part-time')),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS time_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      candidate_id INTEGER NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
      date TEXT NOT NULL,
      hours REAL NOT NULL CHECK(hours > 0 AND hours <= 24),
      description TEXT, project TEXT,
      status TEXT DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
      approved_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      approved_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS absences (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      candidate_id INTEGER NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
      start_date TEXT NOT NULL, end_date TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('vacation','sick','personal','public_holiday','other')),
      status TEXT DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
      notes TEXT,
      approved_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      approved_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS invoices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_number TEXT UNIQUE NOT NULL,
      candidate_id INTEGER NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
      client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL,
      period_start TEXT NOT NULL, period_end TEXT NOT NULL,
      total_hours REAL NOT NULL DEFAULT 0,
      hourly_rate REAL NOT NULL DEFAULT 0,
      total_amount REAL NOT NULL DEFAULT 0,
      status TEXT DEFAULT 'draft'
        CHECK(status IN ('draft','sent','paid','overdue','cancelled','client_approved')),
      due_date TEXT, notes TEXT, client_notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS invoice_line_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
      date TEXT NOT NULL, description TEXT,
      hours REAL NOT NULL, rate REAL NOT NULL, amount REAL NOT NULL
    );
    CREATE TABLE IF NOT EXISTS job_postings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL, description TEXT, skills TEXT,
      client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL,
      location TEXT,
      contract_type TEXT DEFAULT 'contractor'
        CHECK(contract_type IN ('contractor','employee','part-time')),
      hourly_rate_min REAL, hourly_rate_max REAL,
      status TEXT DEFAULT 'open' CHECK(status IN ('open','closed','draft')),
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS job_applications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id INTEGER NOT NULL REFERENCES job_postings(id) ON DELETE CASCADE,
      candidate_id INTEGER NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
      status TEXT DEFAULT 'applied'
        CHECK(status IN ('applied','reviewing','shortlisted','rejected','hired')),
      cover_letter TEXT,
      applied_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(job_id, candidate_id)
    );
    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type TEXT NOT NULL, title TEXT NOT NULL, message TEXT NOT NULL,
      reference_id INTEGER, reference_type TEXT,
      is_read INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Seed default admin only if no admin exists
  const adminExists = wrapper.prepare("SELECT id FROM users WHERE role = 'admin' LIMIT 1").get();
  if (!adminExists) {
    // Always create the admin account — must_change_password=1 forces a password
    // change on first login so the hardcoded default is never used in production.
    const hash = bcrypt.hashSync('admin123', 10);
    wrapper.prepare(
      'INSERT INTO users (name, email, password_hash, role, must_change_password) VALUES (?, ?, ?, ?, ?)'
    ).run('Admin User', 'admin@hireiq.com', hash, 'admin', 1);

    // ── Demo data: only created in non-production environments ───────────────
    if (process.env.NODE_ENV !== 'production') {
      const adminResult = wrapper.prepare("SELECT id FROM users WHERE role = 'admin' LIMIT 1").get();

      const c1 = wrapper.prepare('INSERT INTO clients (name, contact_name, contact_email, address) VALUES (?, ?, ?, ?)').run('Acme Corporation', 'John Smith', 'john@acme.com', '123 Main St, New York');
      const c2 = wrapper.prepare('INSERT INTO clients (name, contact_name, contact_email, address) VALUES (?, ?, ?, ?)').run('Tech Solutions Ltd', 'Jane Doe', 'jane@techsolutions.com', '456 Tech Ave, San Francisco');
      wrapper.prepare('INSERT INTO clients (name, contact_name, contact_email, address) VALUES (?, ?, ?, ?)').run('Global Ventures', 'Bob Johnson', 'bob@globalventures.com', '789 Biz Blvd, Chicago');

      // Demo candidates seeded with must_change_password=1
      const pwHash = bcrypt.hashSync('candidate123', 10);
      const u1 = wrapper.prepare('INSERT INTO users (name, email, password_hash, role, must_change_password) VALUES (?, ?, ?, ?, ?)').run('Alice Johnson', 'alice@hireiq.com', pwHash, 'candidate', 1);
      const a1 = wrapper.prepare('INSERT INTO candidates (user_id, name, email, phone, role, hourly_rate, client_id, start_date, status, contract_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(u1.lastInsertRowid, 'Alice Johnson', 'alice@hireiq.com', '+1-555-0101', 'Senior Developer', 95, c1.lastInsertRowid, '2025-01-15', 'active', 'contractor');

      const u2 = wrapper.prepare('INSERT INTO users (name, email, password_hash, role, must_change_password) VALUES (?, ?, ?, ?, ?)').run('Bob Williams', 'bob@hireiq.com', pwHash, 'candidate', 1);
      wrapper.prepare('INSERT INTO candidates (user_id, name, email, phone, role, hourly_rate, client_id, start_date, status, contract_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(u2.lastInsertRowid, 'Bob Williams', 'bob@hireiq.com', '+1-555-0102', 'UX Designer', 75, c2.lastInsertRowid, '2025-02-01', 'active', 'contractor');

      const u3 = wrapper.prepare('INSERT INTO users (name, email, password_hash, role, must_change_password) VALUES (?, ?, ?, ?, ?)').run('Carol Davis', 'carol@hireiq.com', pwHash, 'candidate', 1);
      wrapper.prepare('INSERT INTO candidates (user_id, name, email, phone, role, hourly_rate, client_id, start_date, status, contract_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(u3.lastInsertRowid, 'Carol Davis', 'carol@hireiq.com', '+1-555-0103', 'Project Manager', 85, c1.lastInsertRowid, '2025-01-01', 'active', 'employee');

      const aliceId = a1.lastInsertRowid;
      const insertTime = wrapper.prepare('INSERT INTO time_entries (candidate_id, date, hours, description, project, status) VALUES (?, ?, ?, ?, ?, ?)');
      insertTime.run(aliceId, '2026-03-03', 8, 'API development', 'Backend API', 'approved');
      insertTime.run(aliceId, '2026-03-04', 7.5, 'Frontend integration', 'Backend API', 'approved');
      insertTime.run(aliceId, '2026-03-10', 8, 'New feature development', 'Mobile App', 'pending');

      wrapper.prepare('INSERT INTO invoices (invoice_number, candidate_id, client_id, period_start, period_end, total_hours, hourly_rate, total_amount, status, due_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run('INV-2026-001', aliceId, c1.lastInsertRowid, '2026-02-01', '2026-02-28', 152, 95, 14440, 'paid', '2026-03-15');

      console.log('✅ Database seeded with demo data (development only)');
    } else {
      console.log('✅ Admin account created (production — no demo data seeded)');
      console.log('⚠️  First-login password change is required for admin@hireiq.com');
    }
  }
}

function getDb() {
  const { runMigrations } = require('./migrate');
  initializeDatabase(defaultDbWrapper, _defaultRaw);
  runMigrations(defaultDbWrapper, _defaultRaw);
  return defaultDbWrapper;
}

// ── Per-tenant DB cache ───────────────────────────────────────────────────────
const _tenantCache = new Map();   // slug → dbWrapper

/**
 * Open (and cache) a tenant's database by its slug.
 * The db_path is fetched from master.db.
 */
function getTenantDb(slug) {
  if (_tenantCache.has(slug)) return _tenantCache.get(slug);

  const { masterDb } = require('./masterDatabase');
  const tenant = masterDb.prepare('SELECT db_path, status FROM tenants WHERE slug = ?').get(slug);
  if (!tenant) throw Object.assign(new Error(`Tenant '${slug}' not found`), { status: 404 });
  if (tenant.status === 'suspended') throw Object.assign(new Error('This organization account is suspended'), { status: 403 });

  // The db_path stored in master.db is an absolute path set at provisioning time.
  // If it no longer exists (e.g. server was moved to a different machine or the
  // path was seeded in a different environment), fall back to the conventional
  // location: backend/<slug>.db — the same directory as this module.
  let resolvedPath = tenant.db_path;
  if (!fs.existsSync(resolvedPath)) {
    const fallback = path.join(__dirname, `${slug}.db`);
    if (fs.existsSync(fallback)) {
      resolvedPath = fallback;
      // Update master.db so future lookups use the correct path
      masterDb.prepare('UPDATE tenants SET db_path = ? WHERE slug = ?').run(resolvedPath, slug);
      console.log(`[DB] Corrected tenant db_path for '${slug}' → ${resolvedPath}`);
    } else {
      throw Object.assign(new Error(`Tenant database file missing for '${slug}' (tried: ${tenant.db_path}, ${fallback})`), { status: 500 });
    }
  }

  const raw = openDatabase(resolvedPath);
  const wrapper = createDbWrapper(raw);
  const { runMigrations } = require('./migrate');
  runMigrations(wrapper, raw);

  _tenantCache.set(slug, wrapper);
  return wrapper;
}

/**
 * Provision a brand-new tenant database, initialize schema, and seed an admin user.
 * Returns the dbWrapper.
 */
function provisionTenantDb(dbPath, adminName, adminEmail, adminPassword) {
  const raw = openDatabase(dbPath);
  const wrapper = createDbWrapper(raw);
  initializeDatabase(wrapper, raw);
  const { runMigrations } = require('./migrate');
  runMigrations(wrapper, raw);

  // Override the seeded default admin with the provided credentials.
  // must_change_password = 0: admin set their own password during provisioning.
  const hash = bcrypt.hashSync(adminPassword, 10);
  const existingAdmin = wrapper.prepare("SELECT id FROM users WHERE role = 'admin' LIMIT 1").get();
  if (existingAdmin) {
    wrapper.prepare('UPDATE users SET name = ?, email = ?, password_hash = ?, must_change_password = 0 WHERE id = ?').run(adminName, adminEmail.toLowerCase().trim(), hash, existingAdmin.id);
  } else {
    wrapper.prepare('INSERT INTO users (name, email, password_hash, role, must_change_password) VALUES (?, ?, ?, ?, ?)').run(adminName, adminEmail.toLowerCase().trim(), hash, 'admin', 0);
  }

  return wrapper;
}

/** Evict a tenant from the cache (call after suspend/delete) */
function evictTenantFromCache(slug) {
  _tenantCache.delete(slug);
}

const defaultDb = getDb();

module.exports = {
  db: defaultDb,
  transaction: defaultDb.transaction,
  getTenantDb,
  provisionTenantDb,
  evictTenantFromCache,
  createDbWrapper,
};
