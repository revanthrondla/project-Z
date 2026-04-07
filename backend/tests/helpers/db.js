/**
 * In-memory SQLite database factory for tests.
 *
 * Creates a fully isolated, schema-complete SQLite :memory: database per test
 * suite.  No files are written; each call to createTestDb() returns a fresh
 * instance with no shared state.
 *
 * Usage:
 *   const { createTestDb, seedTenantData } = require('../helpers/db');
 *   let db, ids;
 *   beforeAll(() => { db = createTestDb(); ids = seedTenantData(db); });
 */
'use strict';

const { DatabaseSync } = require('node:sqlite');
const bcrypt = require('bcryptjs');

// ── Normalize BigInt / null-prototype objects (mirrors database.js) ──────────
function normalize(val) {
  if (val === null || val === undefined) return val;
  if (typeof val === 'bigint') return Number(val);
  if (Array.isArray(val)) return val.map(normalize);
  if (typeof val === 'object') {
    const plain = {};
    for (const k of Object.keys(val)) plain[k] = normalize(val[k]);
    return plain;
  }
  return val;
}

function createDbWrapper(raw) {
  /**
   * Returns a callable function (mirrors better-sqlite3 API).
   * Usage:  db.transaction(fn)()          — same as calling fn() inside a tx
   *         db.transaction(fn)(arg1, ...) — passes args to fn
   *
   * This matches how routes/invoices.js calls db.transaction(fn)()
   */
  function transaction(fn) {
    return function transactionFn(...args) {
      raw.exec('BEGIN');
      try {
        const r = fn(...args);
        raw.exec('COMMIT');
        return r;
      } catch (err) {
        raw.exec('ROLLBACK');
        throw err;
      }
    };
  }
  return {
    prepare(sql) {
      const stmt = raw.prepare(sql);
      return {
        run(...args)  { return stmt.run(...args); },
        get(...args)  { return normalize(stmt.get(...args)); },
        all(...args)  { return normalize(stmt.all(...args)); },
      };
    },
    exec(sql)   { return raw.exec(sql); },
    transaction,
    _raw: raw,
  };
}

// ── Full tenant DB schema (mirrors database.js + all migrations) ─────────────
const TENANT_SCHEMA = `
  CREATE TABLE users (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    name                 TEXT NOT NULL,
    email                TEXT UNIQUE NOT NULL,
    password_hash        TEXT NOT NULL,
    role                 TEXT NOT NULL CHECK(role IN ('admin','candidate','client')),
    must_change_password INTEGER NOT NULL DEFAULT 0,
    created_at           DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE clients (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    name           TEXT NOT NULL,
    contact_name   TEXT,
    contact_email  TEXT,
    address        TEXT,
    billing_currency TEXT DEFAULT 'USD',
    user_id        INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at     DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE candidates (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id       INTEGER UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    name          TEXT NOT NULL,
    email         TEXT NOT NULL,
    phone         TEXT,
    role          TEXT NOT NULL,
    hourly_rate   REAL NOT NULL DEFAULT 0,
    client_id     INTEGER REFERENCES clients(id) ON DELETE SET NULL,
    start_date    TEXT,
    end_date      TEXT,
    status        TEXT DEFAULT 'active' CHECK(status IN ('active','inactive','pending')),
    contract_type TEXT DEFAULT 'contractor',
    deleted_at    DATETIME DEFAULT NULL,
    created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE time_entries (
    id                    INTEGER PRIMARY KEY AUTOINCREMENT,
    candidate_id          INTEGER NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
    date                  TEXT NOT NULL,
    hours                 REAL NOT NULL,
    description           TEXT,
    project               TEXT,
    status                TEXT DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
    approved_by           INTEGER REFERENCES users(id) ON DELETE SET NULL,
    approved_at           DATETIME,
    client_approval_status TEXT DEFAULT NULL,
    client_approval_note  TEXT,
    client_approved_at    DATETIME,
    client_approved_by    INTEGER,
    created_at            DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at            DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE invoices (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_number TEXT UNIQUE NOT NULL,
    candidate_id   INTEGER NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
    client_id      INTEGER REFERENCES clients(id) ON DELETE SET NULL,
    period_start   TEXT NOT NULL,
    period_end     TEXT NOT NULL,
    total_hours    REAL NOT NULL DEFAULT 0,
    hourly_rate    REAL NOT NULL DEFAULT 0,
    total_amount   REAL NOT NULL DEFAULT 0,
    status         TEXT DEFAULT 'draft'
      CHECK(status IN ('draft','sent','paid','overdue','cancelled','client_approved')),
    due_date       TEXT,
    notes          TEXT,
    client_notes   TEXT,
    created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at     DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE invoice_line_items (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    date       TEXT NOT NULL,
    description TEXT,
    hours      REAL NOT NULL,
    rate       REAL NOT NULL,
    amount     REAL NOT NULL
  );
  CREATE TABLE invoice_payments (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_id       INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    amount           REAL NOT NULL,
    payment_date     TEXT NOT NULL,
    payment_method   TEXT NOT NULL DEFAULT 'bank_transfer',
    reference_number TEXT,
    notes            TEXT,
    recorded_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at       DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE notifications (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type           TEXT NOT NULL,
    title          TEXT NOT NULL,
    message        TEXT NOT NULL,
    reference_id   INTEGER,
    reference_type TEXT,
    is_read        INTEGER DEFAULT 0,
    created_at     DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE audit_log (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER,
    user_email TEXT,
    action     TEXT NOT NULL,
    table_name TEXT NOT NULL,
    record_id  INTEGER,
    old_values TEXT,
    new_values TEXT,
    ip_address TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE email_settings (
    id             INTEGER PRIMARY KEY DEFAULT 1,
    provider       TEXT NOT NULL DEFAULT 'gmail',
    imap_host      TEXT,
    imap_port      INTEGER DEFAULT 993,
    imap_user      TEXT,
    imap_password  TEXT,
    imap_folder    TEXT NOT NULL DEFAULT 'INBOX',
    search_subject TEXT NOT NULL DEFAULT 'payment',
    poll_interval  INTEGER NOT NULL DEFAULT 30,
    enabled        INTEGER NOT NULL DEFAULT 0,
    last_polled_at DATETIME,
    last_uid       INTEGER NOT NULL DEFAULT 0,
    created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at     DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`;

/**
 * Create a fresh in-memory tenant database with the full schema.
 * Returns a dbWrapper (same interface as the production wrapper).
 */
function createTestDb() {
  const raw = new DatabaseSync(':memory:');
  raw.exec('PRAGMA foreign_keys = ON');
  raw.exec(TENANT_SCHEMA);
  return createDbWrapper(raw);
}

/**
 * Seed a standard set of test fixtures into a tenant DB.
 * Returns an object with the IDs of every seeded record.
 *
 * Seeded structure:
 *   admin user                   (email: admin@test.com, pw: AdminPass123!)
 *   client1 (Acme Corp)
 *   client2 (Beta LLC)
 *   candidate1 / alice@test.com  → client1, hourly_rate=100
 *   candidate2 / bob@test.com    → client2, hourly_rate=80
 *   clientUser1 / john@client.com → linked to client1
 */
function seedTenantData(db) {
  const adminHash = bcrypt.hashSync('AdminPass123!', 10);
  const candHash  = bcrypt.hashSync('CandPass123!', 10);
  const cliHash   = bcrypt.hashSync('CliPass123!', 10);

  // Admin
  const adminRow = db.prepare(
    'INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)'
  ).run('Test Admin', 'admin@test.com', adminHash, 'admin');

  // Clients
  const c1 = db.prepare(
    'INSERT INTO clients (name, contact_name, contact_email) VALUES (?, ?, ?)'
  ).run('Acme Corp', 'Corp Contact', 'contact@acme.com');

  const c2 = db.prepare(
    'INSERT INTO clients (name, contact_name, contact_email) VALUES (?, ?, ?)'
  ).run('Beta LLC', 'Beta Contact', 'contact@beta.com');

  // Candidate 1 → Acme (rate: $100/h)
  const cu1 = db.prepare(
    'INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)'
  ).run('Alice Smith', 'alice@test.com', candHash, 'candidate');

  const cand1 = db.prepare(
    `INSERT INTO candidates (user_id, name, email, role, hourly_rate, client_id, status)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(cu1.lastInsertRowid, 'Alice Smith', 'alice@test.com', 'Developer', 100, c1.lastInsertRowid, 'active');

  // Candidate 2 → Beta (rate: $80/h)
  const cu2 = db.prepare(
    'INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)'
  ).run('Bob Jones', 'bob@test.com', candHash, 'candidate');

  const cand2 = db.prepare(
    `INSERT INTO candidates (user_id, name, email, role, hourly_rate, client_id, status)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(cu2.lastInsertRowid, 'Bob Jones', 'bob@test.com', 'Designer', 80, c2.lastInsertRowid, 'active');

  // Client portal user → linked to client1
  const clu1 = db.prepare(
    'INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)'
  ).run('John Client', 'john@client.com', cliHash, 'client');
  db.prepare('UPDATE clients SET user_id = ? WHERE id = ?').run(clu1.lastInsertRowid, c1.lastInsertRowid);

  return {
    adminId:      adminRow.lastInsertRowid,
    client1Id:    c1.lastInsertRowid,
    client2Id:    c2.lastInsertRowid,
    candUser1Id:  cu1.lastInsertRowid,
    cand1Id:      cand1.lastInsertRowid,
    candUser2Id:  cu2.lastInsertRowid,
    cand2Id:      cand2.lastInsertRowid,
    clientUser1Id: clu1.lastInsertRowid,
  };
}

// ── Master DB (for auth login tests) ─────────────────────────────────────────
const MASTER_SCHEMA = `
  CREATE TABLE super_admins (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT NOT NULL,
    email         TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE tenants (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    slug           TEXT NOT NULL UNIQUE,
    company_name   TEXT NOT NULL,
    db_path        TEXT NOT NULL,
    status         TEXT NOT NULL DEFAULT 'active',
    plan           TEXT NOT NULL DEFAULT 'standard',
    admin_email    TEXT,
    max_candidates INTEGER DEFAULT 100,
    max_clients    INTEGER DEFAULT 50,
    created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at     DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE tenant_modules (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_slug TEXT NOT NULL,
    module_key  TEXT NOT NULL,
    enabled     INTEGER NOT NULL DEFAULT 1,
    UNIQUE(tenant_slug, module_key)
  );
`;

/**
 * Create a fresh in-memory master database.
 * Seeds one super-admin and one test tenant.
 */
function createMasterTestDb() {
  const raw = new DatabaseSync(':memory:');
  raw.exec('PRAGMA foreign_keys = ON');
  raw.exec(MASTER_SCHEMA);

  const db = createDbWrapper(raw);

  const superHash = bcrypt.hashSync('SuperPass123!', 10);
  db.prepare('INSERT INTO super_admins (name, email, password_hash) VALUES (?, ?, ?)')
    .run('Super Admin', 'super@test.com', superHash);

  db.prepare(`
    INSERT INTO tenants (slug, company_name, db_path, status, admin_email)
    VALUES (?, ?, ?, ?, ?)
  `).run('testco', 'Test Company', '/irrelevant/testco.db', 'active', 'admin@test.com');

  db.prepare(`
    INSERT INTO tenants (slug, company_name, db_path, status, admin_email)
    VALUES (?, ?, ?, ?, ?)
  `).run('suspended', 'Suspended Co', '/irrelevant/sus.db', 'suspended', 'sus@test.com');

  return db;
}

module.exports = { createTestDb, seedTenantData, createMasterTestDb, createDbWrapper };
