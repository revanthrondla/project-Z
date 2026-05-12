/**
 * Flow — PostgreSQL tenant database layer
 *
 * Replaces the SQLite node:sqlite implementation.
 * Each tenant lives in its own PostgreSQL schema: tenant_{slug}
 *
 * Responsibilities:
 *  - createTenantSchema(slug)    — creates schema + all tables + indexes
 *  - seedTenantAdmin(...)         — seeds the admin user for a new tenant
 *  - getTenantDb(slug)            — returns a scoped db wrapper for a tenant
 *  - provisionTenantDb(...)       — full setup: schema + seed admin
 */

const pool = require('./db/pool');
const { createScopedWrapper, createWrapper } = require('./db/wrapper');
const bcrypt = require('bcryptjs');

// ── DDL: all tables in a tenant schema ───────────────────────────────────────
// Called with search_path already set to the tenant schema.
// Column names are kept in sync with what every route file actually uses.
const TENANT_DDL = `

  -- ═══════════════════════════════════════════════════════════════════════════
  -- CORE IDENTITY & ACCESS
  -- ═══════════════════════════════════════════════════════════════════════════

  -- Roles: admin (tenant admin), candidate (employee), client (external client)
  CREATE TABLE IF NOT EXISTS users (
    id                   BIGSERIAL PRIMARY KEY,
    name                 TEXT NOT NULL,
    email                TEXT UNIQUE NOT NULL,
    password_hash        TEXT NOT NULL,
    role                 TEXT NOT NULL CHECK(role IN ('admin','candidate','client')),
    must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
    mfa_enabled          BOOLEAN NOT NULL DEFAULT FALSE,
    mfa_secret           TEXT,
    mfa_backup_codes     JSONB DEFAULT '[]',
    mfa_method           TEXT DEFAULT 'totp' CHECK(mfa_method IN ('totp','email_otp')),
    created_at           TIMESTAMPTZ DEFAULT NOW(),
    updated_at           TIMESTAMPTZ DEFAULT NOW()
  );

  -- ═══════════════════════════════════════════════════════════════════════════
  -- CLIENTS
  -- ═══════════════════════════════════════════════════════════════════════════

  CREATE TABLE IF NOT EXISTS clients (
    id               BIGSERIAL PRIMARY KEY,
    name             TEXT NOT NULL,
    contact_name     TEXT,
    contact_email    TEXT,
    contact_phone    TEXT,
    address          TEXT,
    billing_currency TEXT DEFAULT 'GBP',
    notes            TEXT,
    status           TEXT DEFAULT 'active' CHECK(status IN ('active','inactive')),
    user_id          BIGINT REFERENCES users(id) ON DELETE SET NULL,
    created_at       TIMESTAMPTZ DEFAULT NOW(),
    updated_at       TIMESTAMPTZ DEFAULT NOW()
  );

  -- ═══════════════════════════════════════════════════════════════════════════
  -- EMPLOYEES
  -- ═══════════════════════════════════════════════════════════════════════════

  CREATE TABLE IF NOT EXISTS employees (
    id            BIGSERIAL PRIMARY KEY,
    user_id       BIGINT UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    name          TEXT NOT NULL,
    email         TEXT NOT NULL,
    phone         TEXT,
    role          TEXT NOT NULL,                 -- job title / position
    hourly_rate   NUMERIC(12,2) NOT NULL DEFAULT 0,
    client_id     BIGINT REFERENCES clients(id) ON DELETE SET NULL,
    start_date    DATE,
    end_date      DATE,
    status        TEXT DEFAULT 'active' CHECK(status IN ('active','inactive','pending')),
    contract_type TEXT DEFAULT 'contractor'
                  CHECK(contract_type IN ('contractor','employee','part-time')),
    deleted_at    TIMESTAMPTZ,                   -- soft-delete
    created_at    TIMESTAMPTZ DEFAULT NOW(),
    updated_at    TIMESTAMPTZ DEFAULT NOW()
  );

  -- Resume builder (one per employee, JSON arrays for sections)
  CREATE TABLE IF NOT EXISTS candidate_resumes (
    id             BIGSERIAL PRIMARY KEY,
    candidate_id   BIGINT UNIQUE NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    headline       TEXT,
    summary        TEXT,
    experience     JSONB DEFAULT '[]',
    education      JSONB DEFAULT '[]',
    skills         JSONB DEFAULT '[]',
    certifications JSONB DEFAULT '[]',
    languages      JSONB DEFAULT '[]',
    created_at     TIMESTAMPTZ DEFAULT NOW(),
    updated_at     TIMESTAMPTZ DEFAULT NOW()
  );

  -- ═══════════════════════════════════════════════════════════════════════════
  -- TIME TRACKING
  -- ═══════════════════════════════════════════════════════════════════════════

  CREATE TABLE IF NOT EXISTS time_entries (
    id            BIGSERIAL PRIMARY KEY,
    candidate_id  BIGINT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    date          DATE NOT NULL,
    hours         NUMERIC(5,2) NOT NULL CHECK(hours > 0 AND hours <= 24),
    description   TEXT,
    project       TEXT,
    status        TEXT DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
    approved_by   BIGINT REFERENCES users(id) ON DELETE SET NULL,
    approved_at   TIMESTAMPTZ,
    created_at    TIMESTAMPTZ DEFAULT NOW(),
    updated_at    TIMESTAMPTZ DEFAULT NOW()
  );

  -- ═══════════════════════════════════════════════════════════════════════════
  -- ABSENCE MANAGEMENT
  -- ═══════════════════════════════════════════════════════════════════════════

  CREATE TABLE IF NOT EXISTS absences (
    id            BIGSERIAL PRIMARY KEY,
    candidate_id  BIGINT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    start_date    DATE NOT NULL,
    end_date      DATE NOT NULL,
    type          TEXT NOT NULL
                  CHECK(type IN ('vacation','sick','personal','public_holiday','other')),
    status        TEXT DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
    notes         TEXT,
    approved_by   BIGINT REFERENCES users(id) ON DELETE SET NULL,
    approved_at   TIMESTAMPTZ,
    created_at    TIMESTAMPTZ DEFAULT NOW(),
    updated_at    TIMESTAMPTZ DEFAULT NOW()
  );

  -- ═══════════════════════════════════════════════════════════════════════════
  -- INVOICING
  -- ═══════════════════════════════════════════════════════════════════════════

  CREATE TABLE IF NOT EXISTS invoices (
    id             BIGSERIAL PRIMARY KEY,
    invoice_number TEXT UNIQUE NOT NULL,
    candidate_id   BIGINT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    client_id      BIGINT REFERENCES clients(id) ON DELETE SET NULL,
    period_start   DATE NOT NULL,
    period_end     DATE NOT NULL,
    total_hours    NUMERIC(10,2) NOT NULL DEFAULT 0,
    hourly_rate    NUMERIC(12,2) NOT NULL DEFAULT 0,
    total_amount   NUMERIC(14,2) NOT NULL DEFAULT 0,
    status         TEXT DEFAULT 'draft'
                   CHECK(status IN ('draft','sent','approved','client_approved',
                                    'paid','overdue','cancelled')),
    due_date       DATE,
    notes          TEXT,
    client_notes   TEXT,
    created_at     TIMESTAMPTZ DEFAULT NOW(),
    updated_at     TIMESTAMPTZ DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS invoice_line_items (
    id          BIGSERIAL PRIMARY KEY,
    invoice_id  BIGINT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    date        DATE NOT NULL,
    description TEXT,
    hours       NUMERIC(5,2) NOT NULL,
    rate        NUMERIC(12,2) NOT NULL,
    amount      NUMERIC(14,2) NOT NULL
  );

  CREATE TABLE IF NOT EXISTS invoice_payments (
    id               BIGSERIAL PRIMARY KEY,
    invoice_id       BIGINT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    amount           NUMERIC(14,2) NOT NULL,
    payment_date     DATE NOT NULL,
    payment_method   TEXT DEFAULT 'bank_transfer',
    reference_number TEXT,
    notes            TEXT,
    recorded_by      BIGINT REFERENCES users(id) ON DELETE SET NULL,
    created_at       TIMESTAMPTZ DEFAULT NOW()
  );

  -- ═══════════════════════════════════════════════════════════════════════════
  -- JOBS & RECRUITMENT
  -- ═══════════════════════════════════════════════════════════════════════════

  CREATE TABLE IF NOT EXISTS job_postings (
    id              BIGSERIAL PRIMARY KEY,
    title           TEXT NOT NULL,
    description     TEXT,
    skills          TEXT,
    client_id       BIGINT REFERENCES clients(id) ON DELETE SET NULL,
    location        TEXT,
    contract_type   TEXT DEFAULT 'contractor'
                    CHECK(contract_type IN ('contractor','employee','part-time')),
    hourly_rate_min NUMERIC(12,2),
    hourly_rate_max NUMERIC(12,2),
    status          TEXT DEFAULT 'open' CHECK(status IN ('open','closed','draft')),
    created_by      BIGINT REFERENCES users(id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS job_applications (
    id           BIGSERIAL PRIMARY KEY,
    job_id       BIGINT NOT NULL REFERENCES job_postings(id) ON DELETE CASCADE,
    candidate_id BIGINT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    status       TEXT DEFAULT 'applied'
                 CHECK(status IN ('applied','reviewing','shortlisted','rejected','hired')),
    cover_letter TEXT,
    applied_at   TIMESTAMPTZ DEFAULT NOW(),
    updated_at   TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(job_id, candidate_id)
  );

  -- ═══════════════════════════════════════════════════════════════════════════
  -- NOTIFICATIONS
  -- ═══════════════════════════════════════════════════════════════════════════

  CREATE TABLE IF NOT EXISTS notifications (
    id             BIGSERIAL PRIMARY KEY,
    user_id        BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type           TEXT NOT NULL,
    title          TEXT NOT NULL,
    message        TEXT NOT NULL,
    reference_id   BIGINT,
    reference_type TEXT,
    link           TEXT,
    is_read        BOOLEAN DEFAULT FALSE,
    created_at     TIMESTAMPTZ DEFAULT NOW()
  );

  -- ═══════════════════════════════════════════════════════════════════════════
  -- DOCUMENTS & SIGNATURES
  -- ═══════════════════════════════════════════════════════════════════════════

  CREATE TABLE IF NOT EXISTS documents (
    id               BIGSERIAL PRIMARY KEY,
    title            TEXT NOT NULL,             -- was: name
    description      TEXT,
    file_name        TEXT NOT NULL,             -- original filename
    file_path        TEXT NOT NULL,
    file_size        BIGINT,
    mime_type        TEXT,                      -- was: file_type
    category         TEXT DEFAULT 'general',
    signature_type   TEXT DEFAULT 'none'
                     CHECK(signature_type IN ('none','single','two_way','three_way')),
    required_signers TEXT,                      -- comma-separated roles
    status           TEXT DEFAULT 'pending'
                     CHECK(status IN ('pending','partial','completed','voided')),
    uploaded_by      BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    candidate_id     BIGINT REFERENCES employees(id) ON DELETE CASCADE,
    client_id        BIGINT REFERENCES clients(id) ON DELETE CASCADE,
    notes            TEXT,
    created_at       TIMESTAMPTZ DEFAULT NOW(),
    updated_at       TIMESTAMPTZ DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS document_signatures (
    id           BIGSERIAL PRIMARY KEY,
    document_id  BIGINT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    signer_role  TEXT NOT NULL,
    signer_id    BIGINT REFERENCES users(id) ON DELETE SET NULL,
    status       TEXT DEFAULT 'pending' CHECK(status IN ('pending','signed','rejected')),
    signed_at    TIMESTAMPTZ,
    ip_address   TEXT,
    created_at   TIMESTAMPTZ DEFAULT NOW()
  );

  -- ═══════════════════════════════════════════════════════════════════════════
  -- SETTINGS (tenant key-value config)
  -- ═══════════════════════════════════════════════════════════════════════════

  CREATE TABLE IF NOT EXISTS settings (
    id         BIGSERIAL PRIMARY KEY,
    key        TEXT UNIQUE NOT NULL,
    value      TEXT,
    updated_at TIMESTAMPTZ DEFAULT NOW()
  );

  -- ═══════════════════════════════════════════════════════════════════════════
  -- SUPPORT TICKETS (tenant-level, employee/client → admin)
  -- ═══════════════════════════════════════════════════════════════════════════

  CREATE TABLE IF NOT EXISTS support_tickets (
    id          BIGSERIAL PRIMARY KEY,
    user_id     BIGINT REFERENCES users(id) ON DELETE SET NULL,  -- submitter
    subject     TEXT NOT NULL,
    description TEXT,
    category    TEXT DEFAULT 'general',
    status      TEXT DEFAULT 'open'
                CHECK(status IN ('open','in_progress','resolved','closed')),
    priority    TEXT DEFAULT 'medium'
                CHECK(priority IN ('low','medium','high','urgent')),
    assigned_to BIGINT REFERENCES users(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_at  TIMESTAMPTZ DEFAULT NOW()
  );

  -- Renamed from support_messages → support_ticket_messages (matches routes)
  CREATE TABLE IF NOT EXISTS support_ticket_messages (
    id         BIGSERIAL PRIMARY KEY,
    ticket_id  BIGINT NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
    user_id    BIGINT REFERENCES users(id) ON DELETE SET NULL,
    message    TEXT NOT NULL,
    is_staff   BOOLEAN DEFAULT FALSE,   -- TRUE = admin reply, FALSE = user message
    created_at TIMESTAMPTZ DEFAULT NOW()
  );

  -- ═══════════════════════════════════════════════════════════════════════════
  -- EMAIL / PAYMENT POLLING
  -- ═══════════════════════════════════════════════════════════════════════════

  CREATE TABLE IF NOT EXISTS email_settings (
    id                    BIGSERIAL PRIMARY KEY,
    enabled               BOOLEAN DEFAULT FALSE,
    imap_host             TEXT,
    imap_port             INTEGER DEFAULT 993,
    imap_user             TEXT,
    imap_password         TEXT,                -- encrypted at rest
    poll_interval         INTEGER DEFAULT 30,  -- minutes
    last_polled_at        TIMESTAMPTZ,
    created_at            TIMESTAMPTZ DEFAULT NOW(),
    updated_at            TIMESTAMPTZ DEFAULT NOW()
  );

  -- Renamed from email_payment_events → email_payment_imports (matches routes)
  CREATE TABLE IF NOT EXISTS email_payment_imports (
    id                   BIGSERIAL PRIMARY KEY,
    email_uid            TEXT UNIQUE,          -- IMAP UID, prevents duplicate processing
    email_subject        TEXT,
    email_from           TEXT,
    email_date           TIMESTAMPTZ,
    raw_body             TEXT,
    parsed_amount        NUMERIC(14,2),
    parsed_payment_date  DATE,
    parsed_reference     TEXT,
    parsed_employee_names JSONB DEFAULT '[]',
    matched_invoice_id   BIGINT REFERENCES invoices(id) ON DELETE SET NULL,
    mismatch_flags       JSONB DEFAULT '[]',
    status               TEXT DEFAULT 'pending'
                         CHECK(status IN ('pending','confirmed','rejected','ignored')),
    confirmed_by         BIGINT REFERENCES users(id) ON DELETE SET NULL,
    confirmed_at         TIMESTAMPTZ,
    notes                TEXT,
    created_at           TIMESTAMPTZ DEFAULT NOW()
  );

  -- ═══════════════════════════════════════════════════════════════════════════
  -- PAYROLL
  -- ═══════════════════════════════════════════════════════════════════════════

  CREATE TABLE IF NOT EXISTS payroll_runs (
    id           BIGSERIAL PRIMARY KEY,
    pay_period   TEXT,
    period_start DATE NOT NULL,
    period_end   DATE NOT NULL,
    status       TEXT DEFAULT 'draft'
                 CHECK(status IN ('draft','processing','completed','cancelled','approved','paid')),
    total_gross  NUMERIC(14,2) DEFAULT 0,
    total_net    NUMERIC(14,2) DEFAULT 0,
    total_amount NUMERIC(14,2) DEFAULT 0,    -- alias kept for backward compat
    created_by   BIGINT REFERENCES users(id) ON DELETE SET NULL,
    approved_by  BIGINT REFERENCES users(id) ON DELETE SET NULL,
    approved_at  TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at   TIMESTAMPTZ DEFAULT NOW(),
    updated_at   TIMESTAMPTZ DEFAULT NOW()
  );

  -- Unified as payroll_items (was payroll_entries in old DDL)
  CREATE TABLE IF NOT EXISTS payroll_items (
    id               BIGSERIAL PRIMARY KEY,
    payroll_run_id   BIGINT NOT NULL REFERENCES payroll_runs(id) ON DELETE CASCADE,
    candidate_id     BIGINT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    hours_worked     NUMERIC(8,2) DEFAULT 0,
    hourly_rate      NUMERIC(10,2) DEFAULT 0,
    gross_pay        NUMERIC(12,2) DEFAULT 0,
    deductions       NUMERIC(12,2) DEFAULT 0,
    net_pay          NUMERIC(12,2) DEFAULT 0,
    notes            TEXT,
    created_at       TIMESTAMPTZ DEFAULT NOW()
  );

  -- ═══════════════════════════════════════════════════════════════════════════
  -- EMPLOYEE PROFILE — EXTENDED CONTACT
  -- ═══════════════════════════════════════════════════════════════════════════

  CREATE TABLE IF NOT EXISTS employee_contact_ext (
    id               BIGSERIAL PRIMARY KEY,
    candidate_id     BIGINT UNIQUE NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    alt_phone        TEXT,
    personal_email   TEXT,
    home_street      TEXT,
    home_city        TEXT,
    home_state       TEXT,
    home_postcode    TEXT,
    home_country     TEXT,
    linkedin_url     TEXT,
    emergency_notes  TEXT,
    updated_at       TIMESTAMPTZ DEFAULT NOW()
  );

  -- ═══════════════════════════════════════════════════════════════════════════
  -- EMPLOYEE PROFILE — EMERGENCY CONTACTS
  -- ═══════════════════════════════════════════════════════════════════════════

  -- phone1/phone2 match what the routes actually insert/update
  CREATE TABLE IF NOT EXISTS emergency_contacts (
    id               BIGSERIAL PRIMARY KEY,
    candidate_id     BIGINT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    name             TEXT NOT NULL,
    relationship     TEXT,
    phone1           TEXT NOT NULL,   -- was: phone
    phone2           TEXT,            -- was: alt_phone
    email            TEXT,
    address          TEXT,
    is_primary       BOOLEAN DEFAULT FALSE,
    created_at       TIMESTAMPTZ DEFAULT NOW(),
    updated_at       TIMESTAMPTZ DEFAULT NOW()
  );

  -- ═══════════════════════════════════════════════════════════════════════════
  -- EMPLOYEE PROFILE — EMPLOYMENT HISTORY (effective-dated)
  -- ═══════════════════════════════════════════════════════════════════════════

  -- position_title / start_date / end_date match the route column names
  CREATE TABLE IF NOT EXISTS employment_history (
    id              BIGSERIAL PRIMARY KEY,
    candidate_id    BIGINT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    position_title  TEXT NOT NULL,    -- was: job_title
    department      TEXT,
    employment_type TEXT DEFAULT 'full_time'
                    CHECK(employment_type IN
                      ('full_time','part_time','contract','freelance','intern')),
    start_date      DATE,             -- human-readable period start
    end_date        DATE,             -- NULL = current role
    remuneration    NUMERIC(14,2),    -- was: salary
    currency        TEXT DEFAULT 'GBP',
    frequency       TEXT DEFAULT 'annual'
                    CHECK(frequency IN ('hourly','daily','weekly','monthly','annual')),
    hourly_rate     NUMERIC(12,2),
    manager_name    TEXT,
    location        TEXT,
    notes           TEXT,
    effective_from  DATE NOT NULL DEFAULT CURRENT_DATE,
    effective_to    DATE,            -- NULL = currently active record
    changed_by      BIGINT REFERENCES users(id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT chk_eh_dates CHECK (effective_to IS NULL OR effective_to > effective_from)
  );

  -- ═══════════════════════════════════════════════════════════════════════════
  -- EMPLOYEE PROFILE — BANK ACCOUNTS
  -- ═══════════════════════════════════════════════════════════════════════════

  CREATE TABLE IF NOT EXISTS bank_accounts (
    id               BIGSERIAL PRIMARY KEY,
    candidate_id     BIGINT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    bank_name        TEXT NOT NULL,
    account_name     TEXT NOT NULL,
    account_number   TEXT NOT NULL,   -- stored in full; API responses mask all but last 4
    routing_number   TEXT,            -- ABA / BSB sort code
    swift_code       TEXT,
    iban             TEXT,
    country          TEXT DEFAULT 'GB',
    is_primary       BOOLEAN DEFAULT FALSE,
    created_at       TIMESTAMPTZ DEFAULT NOW(),
    updated_at       TIMESTAMPTZ DEFAULT NOW()
  );

  -- ═══════════════════════════════════════════════════════════════════════════
  -- EMPLOYEE PROFILE — LEAVE BALANCES
  -- ═══════════════════════════════════════════════════════════════════════════

  CREATE TABLE IF NOT EXISTS leave_balances (
    id               BIGSERIAL PRIMARY KEY,
    candidate_id     BIGINT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    leave_type       TEXT NOT NULL,
    entitlement_days NUMERIC(5,1) DEFAULT 0,   -- was: entitled_days
    used_days        NUMERIC(5,1) DEFAULT 0,
    carry_over_days  NUMERIC(5,1) DEFAULT 0,
    year             INTEGER NOT NULL DEFAULT EXTRACT(YEAR FROM NOW())::INTEGER,
    notes            TEXT,
    created_at       TIMESTAMPTZ DEFAULT NOW(),
    updated_at       TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(candidate_id, leave_type, year)
  );

  -- ═══════════════════════════════════════════════════════════════════════════
  -- EMPLOYEE PROFILE — ASSETS ON LOAN
  -- ═══════════════════════════════════════════════════════════════════════════

  CREATE TABLE IF NOT EXISTS employee_assets (
    id            BIGSERIAL PRIMARY KEY,
    candidate_id  BIGINT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    category      TEXT NOT NULL DEFAULT 'other', -- was: asset_type
    description   TEXT NOT NULL,
    serial_number TEXT,
    checkout_date DATE,              -- was: assigned_date
    checkin_date  DATE,              -- was: returned_date
    photo_url     TEXT,
    notes         TEXT,
    status        TEXT DEFAULT 'on_loan'
                  CHECK(status IN ('on_loan','returned','lost','damaged')),
    created_at    TIMESTAMPTZ DEFAULT NOW(),
    updated_at    TIMESTAMPTZ DEFAULT NOW()
  );

  -- ═══════════════════════════════════════════════════════════════════════════
  -- EMPLOYEE PROFILE — BENEFITS
  -- ═══════════════════════════════════════════════════════════════════════════

  CREATE TABLE IF NOT EXISTS employee_benefits (
    id             BIGSERIAL PRIMARY KEY,
    candidate_id   BIGINT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    benefit_type   TEXT NOT NULL,
    provider       TEXT,
    value          NUMERIC(12,2),
    currency       TEXT DEFAULT 'GBP',
    access_details TEXT,
    notes          TEXT,
    effective_date DATE,             -- was: effective_from
    end_date       DATE,
    created_at     TIMESTAMPTZ DEFAULT NOW(),
    updated_at     TIMESTAMPTZ DEFAULT NOW()
  );

  -- ═══════════════════════════════════════════════════════════════════════════
  -- EMPLOYEE PROFILE — PERFORMANCE REVIEWS
  -- ═══════════════════════════════════════════════════════════════════════════

  CREATE TABLE IF NOT EXISTS performance_reviews (
    id            BIGSERIAL PRIMARY KEY,
    candidate_id  BIGINT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    review_date   DATE NOT NULL,
    reviewer_id   BIGINT REFERENCES users(id) ON DELETE SET NULL,
    reviewer_name TEXT,
    overall_score INTEGER CHECK(overall_score BETWEEN 1 AND 5),
    evaluation    TEXT,              -- was: strengths/improvements merged
    next_steps    TEXT,              -- was: goals
    notes         TEXT,
    created_at    TIMESTAMPTZ DEFAULT NOW(),
    updated_at    TIMESTAMPTZ DEFAULT NOW()
  );

  -- ═══════════════════════════════════════════════════════════════════════════
  -- EMPLOYEE PROFILE — TRAINING
  -- ═══════════════════════════════════════════════════════════════════════════

  CREATE TABLE IF NOT EXISTS training_records (
    id              BIGSERIAL PRIMARY KEY,
    candidate_id    BIGINT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    training_date   DATE,            -- was: completion_date
    name            TEXT NOT NULL,   -- was: training_name
    content         TEXT,            -- course content / description
    results         TEXT,            -- pass/fail/score
    certificate_url TEXT,
    expiry_date     DATE,
    status          TEXT DEFAULT 'completed'
                    CHECK(status IN ('planned','in_progress','completed','expired')),
    notes           TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
  );

  -- ═══════════════════════════════════════════════════════════════════════════
  -- EMPLOYEE PROFILE — LICENCES
  -- ═══════════════════════════════════════════════════════════════════════════

  CREATE TABLE IF NOT EXISTS employee_licenses (
    id                   BIGSERIAL PRIMARY KEY,
    candidate_id         BIGINT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    document_type        TEXT NOT NULL,   -- licence type / name
    license_number       TEXT,
    issuing_authority    TEXT,
    issue_date           DATE,
    expiry_date          DATE,
    reminder_days_before INTEGER DEFAULT 30,
    reminded_at          TIMESTAMPTZ,
    status               TEXT DEFAULT 'active'
                         CHECK(status IN ('active','expired','suspended','pending')),
    notes                TEXT,
    created_at           TIMESTAMPTZ DEFAULT NOW(),
    updated_at           TIMESTAMPTZ DEFAULT NOW()
  );

  -- ═══════════════════════════════════════════════════════════════════════════
  -- AUDIT LOG
  -- ═══════════════════════════════════════════════════════════════════════════

  CREATE TABLE IF NOT EXISTS audit_logs (
    id          BIGSERIAL PRIMARY KEY,
    table_name  TEXT NOT NULL,
    record_id   BIGINT,
    action      TEXT NOT NULL CHECK(action IN ('INSERT','UPDATE','DELETE')),
    changed_by  BIGINT,              -- NULL = system action
    changed_at  TIMESTAMPTZ DEFAULT NOW(),
    old_values  JSONB,               -- NULL for INSERT
    new_values  JSONB,               -- NULL for DELETE
    ip_address  TEXT,
    user_agent  TEXT
  );

  -- ═══════════════════════════════════════════════════════════════════════════
  -- AI / CHAT
  -- ═══════════════════════════════════════════════════════════════════════════

  -- Tenant-level AI provider settings (singleton row id=1)
  CREATE TABLE IF NOT EXISTS ai_settings (
    id                   BIGSERIAL PRIMARY KEY,
    provider             TEXT DEFAULT 'anthropic'
                         CHECK(provider IN ('anthropic','openai')),
    model                TEXT DEFAULT 'claude-haiku-4-5-20251001',
    api_key              TEXT,
    system_prompt_suffix TEXT,
    allow_tenant_keys    BOOLEAN DEFAULT TRUE,
    updated_by           BIGINT REFERENCES users(id) ON DELETE SET NULL,
    updated_at           TIMESTAMPTZ DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS ai_conversations (
    id         BIGSERIAL PRIMARY KEY,
    user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title      TEXT NOT NULL DEFAULT 'New Conversation',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS ai_messages (
    id              BIGSERIAL PRIMARY KEY,
    conversation_id BIGINT NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
    role            TEXT NOT NULL CHECK(role IN ('user','assistant','system')),
    content         TEXT NOT NULL,
    tokens_used     INTEGER,
    tool_data       JSONB,           -- serialised tool call/result pairs for this turn
    created_at      TIMESTAMPTZ DEFAULT NOW()
  );

  -- Knowledge base documents (uploaded by admin, used by AI assistant)
  CREATE TABLE IF NOT EXISTS ai_documents (
    id             BIGSERIAL PRIMARY KEY,
    title          TEXT NOT NULL,
    file_name      TEXT,            -- original uploaded filename
    file_type      TEXT,            -- MIME type (e.g. application/pdf)
    file_size      BIGINT,          -- bytes
    file_path      TEXT,            -- server-side storage path (optional)
    content        TEXT,
    search_vector  TSVECTOR GENERATED ALWAYS AS (to_tsvector('english', coalesce(title,'') || ' ' || coalesce(content,''))) STORED,
    uploaded_by    BIGINT REFERENCES users(id) ON DELETE SET NULL,
    created_at     TIMESTAMPTZ DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS ai_document_chunks (
    id          BIGSERIAL PRIMARY KEY,
    document_id BIGINT NOT NULL REFERENCES ai_documents(id) ON DELETE CASCADE,
    chunk_index INTEGER NOT NULL,
    content     TEXT NOT NULL,
    embedding   TEXT,
    created_at  TIMESTAMPTZ DEFAULT NOW()
  );

  -- ═══════════════════════════════════════════════════════════════════════════
  -- AGROW MODULE (agricultural workforce management)
  -- ═══════════════════════════════════════════════════════════════════════════

  CREATE TABLE IF NOT EXISTS ag_languages (
    id            BIGSERIAL PRIMARY KEY,
    language_name TEXT NOT NULL,
    language_code TEXT UNIQUE NOT NULL,
    is_default    BOOLEAN DEFAULT FALSE,
    created_at    TIMESTAMPTZ DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS ag_custom_field_definitions (
    id          BIGSERIAL PRIMARY KEY,
    field_name  TEXT NOT NULL,
    field_type  TEXT NOT NULL CHECK(field_type IN ('text','number','date','boolean','select')),
    applies_to  TEXT DEFAULT 'all',
    options     JSONB,              -- array of values for 'select' type
    required    BOOLEAN DEFAULT FALSE,
    sort_order  INTEGER DEFAULT 0,
    created_at  TIMESTAMPTZ DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS ag_employees (
    id              BIGSERIAL PRIMARY KEY,
    employee_name   TEXT NOT NULL,
    employee_number TEXT UNIQUE NOT NULL,
    crew_name       TEXT,
    entity_name     TEXT,
    ranch           TEXT,
    badge_number    TEXT,
    email           TEXT,
    gender          TEXT,
    start_date      DATE,
    end_date        DATE,
    custom_fields   JSONB DEFAULT '{}',
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS ag_products (
    id                    BIGSERIAL PRIMARY KEY,
    commodity             TEXT,
    ranch                 TEXT,
    entity                TEXT,
    location              TEXT,
    crate_count           INTEGER DEFAULT 0,
    metric                TEXT,
    start_time            TEXT,
    end_time              TEXT,
    picking_average       NUMERIC(10,3),
    highest_picking_speed NUMERIC(10,3),
    lowest_picking_speed  NUMERIC(10,3),
    custom_fields         JSONB DEFAULT '{}',
    created_at            TIMESTAMPTZ DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS ag_scanned_products (
    id                    BIGSERIAL PRIMARY KEY,
    product_name          TEXT NOT NULL,
    quantity              NUMERIC(10,3) DEFAULT 0,
    unit                  TEXT DEFAULT 'items',
    user_name             TEXT,
    entity_name           TEXT,
    crew_name             TEXT,
    ranch                 TEXT,
    picking_average       NUMERIC(10,3),
    highest_picking_speed NUMERIC(10,3),
    lowest_picking_speed  NUMERIC(10,3),
    scanned_at            TIMESTAMPTZ DEFAULT NOW(),
    synced                BOOLEAN DEFAULT TRUE,
    custom_fields         JSONB DEFAULT '{}',
    created_at            TIMESTAMPTZ DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS ag_analytics_snapshots (
    id               BIGSERIAL PRIMARY KEY,
    snapshot_date    DATE NOT NULL DEFAULT CURRENT_DATE,
    harvesting_data  JSONB DEFAULT '{}',
    metrics          JSONB DEFAULT '{}',
    created_at       TIMESTAMPTZ DEFAULT NOW()
  );

  -- ═══════════════════════════════════════════════════════════════════════════
  -- INDEXES
  -- ═══════════════════════════════════════════════════════════════════════════

  CREATE INDEX IF NOT EXISTS idx_employees_user_id      ON employees(user_id);
  CREATE INDEX IF NOT EXISTS idx_employees_client_id    ON employees(client_id);
  CREATE INDEX IF NOT EXISTS idx_employees_status       ON employees(status);
  CREATE INDEX IF NOT EXISTS idx_time_entries_candidate  ON time_entries(candidate_id);
  CREATE INDEX IF NOT EXISTS idx_time_entries_date       ON time_entries(date);
  CREATE INDEX IF NOT EXISTS idx_time_entries_status     ON time_entries(status);
  CREATE INDEX IF NOT EXISTS idx_absences_candidate      ON absences(candidate_id);
  CREATE INDEX IF NOT EXISTS idx_absences_status         ON absences(status);
  CREATE INDEX IF NOT EXISTS idx_invoices_candidate      ON invoices(candidate_id);
  CREATE INDEX IF NOT EXISTS idx_invoices_status         ON invoices(status);
  CREATE INDEX IF NOT EXISTS idx_invoice_payments_invoice ON invoice_payments(invoice_id);
  CREATE INDEX IF NOT EXISTS idx_notifications_user      ON notifications(user_id);
  CREATE INDEX IF NOT EXISTS idx_notifications_read      ON notifications(user_id, is_read);
  CREATE INDEX IF NOT EXISTS idx_support_tickets_user    ON support_tickets(user_id);
  CREATE INDEX IF NOT EXISTS idx_support_tickets_status  ON support_tickets(status);
  CREATE INDEX IF NOT EXISTS idx_stm_ticket              ON support_ticket_messages(ticket_id);
  CREATE INDEX IF NOT EXISTS idx_email_imports_status    ON email_payment_imports(status);
  CREATE INDEX IF NOT EXISTS idx_payroll_items_run       ON payroll_items(payroll_run_id);
  CREATE INDEX IF NOT EXISTS idx_payroll_items_candidate ON payroll_items(candidate_id);
  CREATE INDEX IF NOT EXISTS idx_employment_history_eff  ON employment_history(candidate_id, effective_from, effective_to);
  CREATE INDEX IF NOT EXISTS idx_employment_history_curr ON employment_history(candidate_id) WHERE effective_to IS NULL;
  CREATE INDEX IF NOT EXISTS idx_bank_accounts_candidate ON bank_accounts(candidate_id);
  CREATE INDEX IF NOT EXISTS idx_leave_balances_cand_yr  ON leave_balances(candidate_id, year);
  CREATE INDEX IF NOT EXISTS idx_licenses_candidate      ON employee_licenses(candidate_id);
  CREATE INDEX IF NOT EXISTS idx_licenses_expiry         ON employee_licenses(expiry_date);
  CREATE INDEX IF NOT EXISTS idx_audit_logs_table        ON audit_logs(table_name, record_id);
  CREATE INDEX IF NOT EXISTS idx_audit_logs_changed_by   ON audit_logs(changed_by);
  CREATE INDEX IF NOT EXISTS idx_audit_logs_changed_at   ON audit_logs(changed_at DESC);
  CREATE INDEX IF NOT EXISTS idx_ai_docs_fts             ON ai_documents USING GIN(search_vector);
  CREATE INDEX IF NOT EXISTS idx_ai_conv_user            ON ai_conversations(user_id);
  CREATE INDEX IF NOT EXISTS idx_ag_employees_number     ON ag_employees(employee_number);
  CREATE INDEX IF NOT EXISTS idx_ag_scanned_at           ON ag_scanned_products(scanned_at DESC);

  -- ═══════════════════════════════════════════════════════════════════════════
  -- RECRUITERS
  -- ═══════════════════════════════════════════════════════════════════════════

  CREATE TABLE IF NOT EXISTS recruiters (
    id           BIGSERIAL PRIMARY KEY,
    user_id      BIGINT UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name         TEXT NOT NULL,
    email        TEXT NOT NULL,
    specialties  JSONB DEFAULT '[]',
    created_at   TIMESTAMPTZ DEFAULT NOW(),
    updated_at   TIMESTAMPTZ DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS recruiter_assignments (
    id           BIGSERIAL PRIMARY KEY,
    recruiter_id BIGINT NOT NULL REFERENCES recruiters(id) ON DELETE CASCADE,
    candidate_id BIGINT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    notes        TEXT,
    assigned_at  TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(recruiter_id, candidate_id)
  );

  CREATE TABLE IF NOT EXISTS c2c_job_cache (
    id           BIGSERIAL PRIMARY KEY,
    search_hash  TEXT UNIQUE NOT NULL,
    query        TEXT NOT NULL,
    results      JSONB NOT NULL DEFAULT '[]',
    result_count INTEGER DEFAULT 0,
    created_at   TIMESTAMPTZ DEFAULT NOW(),
    expires_at   TIMESTAMPTZ NOT NULL
  );

  -- ── MFA email OTP codes (short-lived, per user) ─────────────────────────────
  CREATE TABLE IF NOT EXISTS mfa_otp_codes (
    id         BIGSERIAL PRIMARY KEY,
    user_id    BIGINT NOT NULL,
    code_hash  TEXT NOT NULL,
    purpose    TEXT NOT NULL DEFAULT 'login',
    expires_at TIMESTAMPTZ NOT NULL,
    used       BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_mfa_otp_user ON mfa_otp_codes(user_id, expires_at);
  CREATE INDEX IF NOT EXISTS idx_recruiter_assignments_rec ON recruiter_assignments(recruiter_id);
  CREATE INDEX IF NOT EXISTS idx_recruiter_assignments_cand ON recruiter_assignments(candidate_id);
  CREATE INDEX IF NOT EXISTS idx_c2c_cache_hash ON c2c_job_cache(search_hash);
  CREATE INDEX IF NOT EXISTS idx_c2c_cache_expires ON c2c_job_cache(expires_at);
`;

/**
 * Create the tenant schema and all its tables.
 * Idempotent — safe to call on an existing schema.
 */
async function createTenantSchema(slug) {
  const client = await pool.connect();
  try {
    const schema = `tenant_${slug}`;
    await client.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
    await client.query(`SET search_path TO "${schema}"`);
    await client.query(TENANT_DDL);

    // ── Column migrations (idempotent) ─────────────────────────────────────────
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_enabled BOOLEAN NOT NULL DEFAULT FALSE`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_secret TEXT`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_backup_codes JSONB DEFAULT '[]'`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_method TEXT DEFAULT 'totp'`);
    // mfa_otp_codes table for email OTP (CREATE TABLE IF NOT EXISTS handles existing schemas)
    await client.query(`
      CREATE TABLE IF NOT EXISTS mfa_otp_codes (
        id         BIGSERIAL PRIMARY KEY,
        user_id    BIGINT NOT NULL,
        code_hash  TEXT NOT NULL,
        purpose    TEXT NOT NULL DEFAULT 'login',
        expires_at TIMESTAMPTZ NOT NULL,
        used       BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_mfa_otp_user ON mfa_otp_codes(user_id, expires_at)`);

    // ── Recruiter & Market Status migrations ────────────────────────────────────
    // 1. Add market_status + available_date + market_notes to employees
    await client.query(`ALTER TABLE employees ADD COLUMN IF NOT EXISTS market_status TEXT DEFAULT 'employed' CHECK(market_status IN ('employed','in_market','about_to_be_in_market'))`);
    await client.query(`ALTER TABLE employees ADD COLUMN IF NOT EXISTS available_date DATE`);
    await client.query(`ALTER TABLE employees ADD COLUMN IF NOT EXISTS market_notes TEXT`);

    // 2. Expand users.role to include 'recruiter'
    await client.query(`ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check`);
    await client.query(`ALTER TABLE users ADD CONSTRAINT users_role_check CHECK(role IN ('admin','candidate','client','recruiter'))`);

    // 3. recruiters table
    await client.query(`
      CREATE TABLE IF NOT EXISTS recruiters (
        id           BIGSERIAL PRIMARY KEY,
        user_id      BIGINT UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name         TEXT NOT NULL,
        email        TEXT NOT NULL,
        specialties  JSONB DEFAULT '[]',
        created_at   TIMESTAMPTZ DEFAULT NOW(),
        updated_at   TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // 4. recruiter_assignments table
    await client.query(`
      CREATE TABLE IF NOT EXISTS recruiter_assignments (
        id           BIGSERIAL PRIMARY KEY,
        recruiter_id BIGINT NOT NULL REFERENCES recruiters(id) ON DELETE CASCADE,
        candidate_id BIGINT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
        notes        TEXT,
        assigned_at  TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(recruiter_id, candidate_id)
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_recruiter_assignments_rec ON recruiter_assignments(recruiter_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_recruiter_assignments_cand ON recruiter_assignments(candidate_id)`);

    // 5. c2c_job_cache table
    await client.query(`
      CREATE TABLE IF NOT EXISTS c2c_job_cache (
        id           BIGSERIAL PRIMARY KEY,
        search_hash  TEXT UNIQUE NOT NULL,
        query        TEXT NOT NULL,
        results      JSONB NOT NULL DEFAULT '[]',
        result_count INTEGER DEFAULT 0,
        created_at   TIMESTAMPTZ DEFAULT NOW(),
        expires_at   TIMESTAMPTZ NOT NULL
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_c2c_cache_hash ON c2c_job_cache(search_hash)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_c2c_cache_expires ON c2c_job_cache(expires_at)`);

    // 6. Tenant custom field definitions (max 10 per tenant, admin-configurable)
    await client.query(`
      CREATE TABLE IF NOT EXISTS employee_custom_field_defs (
        id            BIGSERIAL PRIMARY KEY,
        field_key     TEXT NOT NULL UNIQUE,
        label         TEXT NOT NULL,
        field_type    TEXT NOT NULL DEFAULT 'text'
                      CHECK(field_type IN ('text','rich_text','number','date','select','radio','checkbox','multi_checkbox')),
        options       JSONB NOT NULL DEFAULT '[]',
        validation    JSONB NOT NULL DEFAULT '{}',
        formula       TEXT,
        placeholder   TEXT,
        help_text     TEXT,
        display_order INTEGER NOT NULL DEFAULT 0,
        is_active     BOOLEAN NOT NULL DEFAULT TRUE,
        created_at    TIMESTAMPTZ DEFAULT NOW(),
        updated_at    TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // 7. Per-candidate custom field values
    await client.query(`
      CREATE TABLE IF NOT EXISTS employee_custom_field_values (
        candidate_id  BIGINT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
        field_key     TEXT NOT NULL,
        value_text    TEXT,
        value_json    JSONB,
        updated_at    TIMESTAMPTZ DEFAULT NOW(),
        PRIMARY KEY   (candidate_id, field_key)
      )
    `);

    await client.query(`CREATE INDEX IF NOT EXISTS idx_ecfv_candidate ON employee_custom_field_values(candidate_id)`);

    // ── 8. Organisation setup ─────────────────────────────────────────────────

    // 8a. Singleton org profile (one row per tenant — upsert pattern)
    await client.query(`
      CREATE TABLE IF NOT EXISTS org_profile (
        id                        BIGSERIAL PRIMARY KEY,
        -- Company profile
        legal_name                TEXT,
        trading_name              TEXT,
        description               TEXT,
        industry                  TEXT,
        website                   TEXT,
        -- Tax & legal
        tax_id_label              TEXT NOT NULL DEFAULT 'Tax ID',
        tax_id                    TEXT,
        vat_number                TEXT,
        registration_number       TEXT,
        -- Address (primary / registered office)
        address_line1             TEXT,
        address_line2             TEXT,
        city                      TEXT,
        state                     TEXT,
        postcode                  TEXT,
        country                   TEXT NOT NULL DEFAULT 'US',
        -- Workweek
        week_start_day            TEXT NOT NULL DEFAULT 'monday'
                                  CHECK(week_start_day IN ('monday','sunday','saturday')),
        standard_hours_per_day    NUMERIC(4,2) NOT NULL DEFAULT 8,
        standard_hours_per_week   NUMERIC(5,2) NOT NULL DEFAULT 40,
        -- Time zone & locale
        default_timezone          TEXT NOT NULL DEFAULT 'UTC',
        date_format               TEXT NOT NULL DEFAULT 'YYYY-MM-DD',
        -- Currency
        default_currency          TEXT NOT NULL DEFAULT 'USD',
        currency_symbol           TEXT NOT NULL DEFAULT '$',
        currency_position         TEXT NOT NULL DEFAULT 'before'
                                  CHECK(currency_position IN ('before','after')),
        -- Invoice numbering
        invoice_prefix            TEXT NOT NULL DEFAULT 'INV',
        invoice_separator         TEXT NOT NULL DEFAULT '-',
        invoice_next_number       INTEGER NOT NULL DEFAULT 1001,
        invoice_padding           INTEGER NOT NULL DEFAULT 4,
        -- Pay periods
        default_pay_period        TEXT NOT NULL DEFAULT 'weekly'
                                  CHECK(default_pay_period IN ('weekly','fortnightly','semi_monthly','monthly')),
        pay_period_anchor_date    DATE,
        -- Document retention
        doc_retention_years       INTEGER NOT NULL DEFAULT 7,
        doc_retention_policy      TEXT,
        updated_at                TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // 8b. Locations (many per tenant)
    await client.query(`
      CREATE TABLE IF NOT EXISTS org_locations (
        id            BIGSERIAL PRIMARY KEY,
        name          TEXT NOT NULL,
        address_line1 TEXT,
        address_line2 TEXT,
        city          TEXT,
        state         TEXT,
        postcode      TEXT,
        country       TEXT NOT NULL DEFAULT 'US',
        timezone      TEXT NOT NULL DEFAULT 'UTC',
        phone         TEXT,
        is_primary    BOOLEAN NOT NULL DEFAULT FALSE,
        is_active     BOOLEAN NOT NULL DEFAULT TRUE,
        display_order INTEGER NOT NULL DEFAULT 0,
        created_at    TIMESTAMPTZ DEFAULT NOW(),
        updated_at    TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_org_locations_active ON org_locations(is_active)`);

    // 8c. Departments (many per tenant)
    await client.query(`
      CREATE TABLE IF NOT EXISTS org_departments (
        id            BIGSERIAL PRIMARY KEY,
        name          TEXT NOT NULL,
        code          TEXT,
        cost_center   TEXT,
        description   TEXT,
        parent_id     BIGINT REFERENCES org_departments(id) ON DELETE SET NULL,
        is_active     BOOLEAN NOT NULL DEFAULT TRUE,
        display_order INTEGER NOT NULL DEFAULT 0,
        created_at    TIMESTAMPTZ DEFAULT NOW(),
        updated_at    TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_org_departments_active ON org_departments(is_active)`);

    // Add department_id to employees if not exists (migration-safe)
    await client.query(`ALTER TABLE employees ADD COLUMN IF NOT EXISTS department_id BIGINT REFERENCES org_departments(id) ON DELETE SET NULL`);
    await client.query(`ALTER TABLE employees ADD COLUMN IF NOT EXISTS location_id   BIGINT REFERENCES org_locations(id)   ON DELETE SET NULL`);

    // ═══════════════════════════════════════════════════════════════════════════
    // CONSULTING / PROFESSIONAL SERVICES SCHEMA
    // ═══════════════════════════════════════════════════════════════════════════

    // 9a. Projects — linked to clients, with billing model and budget
    await client.query(`
      CREATE TABLE IF NOT EXISTS projects (
        id                   BIGSERIAL PRIMARY KEY,
        client_id            BIGINT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
        name                 TEXT NOT NULL,
        code                 TEXT,
        description          TEXT,
        billing_model        TEXT DEFAULT 'hourly'
                             CHECK(billing_model IN ('hourly','retainer','fixed_fee','milestone')),
        budget_hours         NUMERIC(10,2),
        budget_amount        NUMERIC(14,2),
        retainer_amount      NUMERIC(14,2),
        retainer_period      TEXT DEFAULT 'monthly' CHECK(retainer_period IN ('weekly','monthly','quarterly')),
        po_number            TEXT,
        contract_start       DATE,
        contract_end         DATE,
        project_manager_id   BIGINT REFERENCES users(id) ON DELETE SET NULL,
        status               TEXT DEFAULT 'active'
                             CHECK(status IN ('active','on_hold','completed','cancelled')),
        tags                 TEXT,
        notes                TEXT,
        created_at           TIMESTAMPTZ DEFAULT NOW(),
        updated_at           TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // 9b. Project tasks (optional breakdown within a project)
    await client.query(`
      CREATE TABLE IF NOT EXISTS project_tasks (
        id              BIGSERIAL PRIMARY KEY,
        project_id      BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        name            TEXT NOT NULL,
        description     TEXT,
        estimated_hours NUMERIC(8,2),
        is_billable     BOOLEAN DEFAULT TRUE,
        status          TEXT DEFAULT 'active'
                        CHECK(status IN ('active','completed','cancelled')),
        sort_order      INTEGER DEFAULT 0,
        created_at      TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // 9c. Rate cards — hierarchical: person > project > role > client_default
    await client.query(`
      CREATE TABLE IF NOT EXISTS rate_cards (
        id                 BIGSERIAL PRIMARY KEY,
        name               TEXT NOT NULL,
        rate_type          TEXT NOT NULL
                           CHECK(rate_type IN ('person','role','project','client_default')),
        candidate_id       BIGINT REFERENCES employees(id) ON DELETE CASCADE,
        client_id          BIGINT REFERENCES clients(id) ON DELETE CASCADE,
        project_id         BIGINT REFERENCES projects(id) ON DELETE CASCADE,
        role_name          TEXT,
        bill_rate          NUMERIC(12,2) NOT NULL,
        cost_rate          NUMERIC(12,2),
        overtime_bill_rate NUMERIC(12,2),
        currency           TEXT DEFAULT 'USD',
        effective_from     DATE DEFAULT CURRENT_DATE,
        effective_to       DATE,
        notes              TEXT,
        created_at         TIMESTAMPTZ DEFAULT NOW(),
        updated_at         TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // 9d. Expenses — reimbursable/billable, receipt, approval, invoice pass-through
    await client.query(`
      CREATE TABLE IF NOT EXISTS expenses (
        id              BIGSERIAL PRIMARY KEY,
        candidate_id    BIGINT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
        client_id       BIGINT REFERENCES clients(id) ON DELETE SET NULL,
        project_id      BIGINT REFERENCES projects(id) ON DELETE SET NULL,
        task_id         BIGINT REFERENCES project_tasks(id) ON DELETE SET NULL,
        expense_date    DATE NOT NULL,
        category        TEXT NOT NULL
                        CHECK(category IN ('travel','mileage','per_diem','software',
                                           'hardware','meals','accommodation','other')),
        description     TEXT NOT NULL,
        amount          NUMERIC(12,2),
        mileage_miles   NUMERIC(8,2),
        mileage_rate    NUMERIC(6,4) DEFAULT 0.670,
        currency        TEXT DEFAULT 'USD',
        is_billable     BOOLEAN DEFAULT TRUE,
        is_reimbursable BOOLEAN DEFAULT TRUE,
        receipt_url     TEXT,
        status          TEXT DEFAULT 'pending'
                        CHECK(status IN ('pending','approved','rejected','invoiced')),
        approved_by     BIGINT REFERENCES users(id) ON DELETE SET NULL,
        approved_at     TIMESTAMPTZ,
        rejected_reason TEXT,
        invoice_id      BIGINT REFERENCES invoices(id) ON DELETE SET NULL,
        notes           TEXT,
        created_at      TIMESTAMPTZ DEFAULT NOW(),
        updated_at      TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Indexes for consulting tables
    await client.query(`CREATE INDEX IF NOT EXISTS idx_projects_client      ON projects(client_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_projects_status      ON projects(status)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_project_tasks_proj   ON project_tasks(project_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_rate_cards_candidate ON rate_cards(candidate_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_rate_cards_project   ON rate_cards(project_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_expenses_candidate   ON expenses(candidate_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_expenses_project     ON expenses(project_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_expenses_status      ON expenses(status)`);

    // Migration-safe ALTERs on existing tables for consulting fields

    // time_entries: project FK, task FK, billable flag, billing notes, timer, rejection reason
    await client.query(`ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS project_id     BIGINT REFERENCES projects(id) ON DELETE SET NULL`);
    await client.query(`ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS task_id        BIGINT REFERENCES project_tasks(id) ON DELETE SET NULL`);
    await client.query(`ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS is_billable    BOOLEAN DEFAULT TRUE`);
    await client.query(`ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS billing_notes  TEXT`);
    await client.query(`ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS timer_start    TIMESTAMPTZ`);
    await client.query(`ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS rejected_reason TEXT`);

    // clients: extended profile fields
    await client.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS po_number      TEXT`);
    await client.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS billing_address TEXT`);
    await client.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS tax_id         TEXT`);
    await client.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS currency       TEXT DEFAULT 'USD'`);
    await client.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS payment_terms  INTEGER DEFAULT 30`);
    await client.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS website        TEXT`);
    await client.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS notes          TEXT`);

    // invoices: project link, expense total, billing model, timestamps
    await client.query(`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS project_id        BIGINT REFERENCES projects(id) ON DELETE SET NULL`);
    await client.query(`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS expense_total     NUMERIC(14,2) DEFAULT 0`);
    await client.query(`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS billing_model     TEXT DEFAULT 'hourly'`);
    await client.query(`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS sent_at           TIMESTAMPTZ`);
    await client.query(`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS client_approved_at TIMESTAMPTZ`);
    await client.query(`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS payment_terms     INTEGER DEFAULT 30`);
    await client.query(`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS tax_rate          NUMERIC(5,4) DEFAULT 0`);
    await client.query(`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS discount_amount   NUMERIC(12,2) DEFAULT 0`);

    // employees: contractor management fields + utilization target
    await client.query(`ALTER TABLE employees ADD COLUMN IF NOT EXISTS w9_collected          BOOLEAN DEFAULT FALSE`);
    await client.query(`ALTER TABLE employees ADD COLUMN IF NOT EXISTS classification_status TEXT DEFAULT 'employee' CHECK(classification_status IN ('employee','contractor','pending_review'))`);
    await client.query(`ALTER TABLE employees ADD COLUMN IF NOT EXISTS classification_notes  TEXT`);
    await client.query(`ALTER TABLE employees ADD COLUMN IF NOT EXISTS sow_url               TEXT`);
    await client.query(`ALTER TABLE employees ADD COLUMN IF NOT EXISTS target_utilization    NUMERIC(5,2) DEFAULT 80`);

    // ══════════════════════════════════════════════════════════════════════════
    // PAY RULES ENGINE  (FLSA overtime, minimum wage, rounding, breaks)
    // ══════════════════════════════════════════════════════════════════════════
    await client.query(`
      CREATE TABLE IF NOT EXISTS pay_rules (
        id                    BIGSERIAL PRIMARY KEY,
        name                  TEXT NOT NULL,
        is_default            BOOLEAN NOT NULL DEFAULT FALSE,
        -- Workweek anchor
        workweek_start        TEXT NOT NULL DEFAULT 'monday'
                              CHECK(workweek_start IN ('monday','tuesday','wednesday','thursday','friday','saturday','sunday')),
        -- Overtime thresholds (FLSA daily + weekly)
        daily_ot_threshold    NUMERIC(5,2),            -- null = no daily OT
        weekly_ot_threshold   NUMERIC(5,2) DEFAULT 40, -- FLSA standard
        double_time_threshold NUMERIC(5,2),            -- CA-style DT
        ot_multiplier         NUMERIC(4,2) DEFAULT 1.5,
        dt_multiplier         NUMERIC(4,2) DEFAULT 2.0,
        -- Minimum wage (USD/hr; override at location level if needed)
        minimum_wage          NUMERIC(8,2) DEFAULT 7.25,
        -- Time rounding: 'none' | '6min' | '15min' | 'nearest_quarter'
        time_rounding         TEXT NOT NULL DEFAULT 'none'
                              CHECK(time_rounding IN ('none','6min','15min','nearest_quarter')),
        -- Break rules (minutes)
        break_threshold_hours NUMERIC(4,2) DEFAULT 6,  -- hours worked before break required
        break_duration_min    INTEGER DEFAULT 30,       -- length of required unpaid break
        paid_breaks           BOOLEAN DEFAULT FALSE,
        -- Location / scope
        location_id           BIGINT REFERENCES org_locations(id) ON DELETE SET NULL,
        notes                 TEXT,
        created_at            TIMESTAMPTZ DEFAULT NOW(),
        updated_at            TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_pay_rules_default ON pay_rules(is_default) WHERE is_default = TRUE`);

    // Candidate-to-rule assignment (override default)
    await client.query(`ALTER TABLE employees ADD COLUMN IF NOT EXISTS pay_rule_id BIGINT REFERENCES pay_rules(id) ON DELETE SET NULL`);

    // ── Seed one FLSA-compliant default rule ─────────────────────────────────
    await client.query(`
      INSERT INTO pay_rules (name, is_default, workweek_start, weekly_ot_threshold, ot_multiplier, minimum_wage, time_rounding)
      SELECT 'FLSA Standard', TRUE, 'monday', 40, 1.5, 7.25, 'none'
      WHERE NOT EXISTS (SELECT 1 FROM pay_rules WHERE is_default = TRUE)
    `);

    // ══════════════════════════════════════════════════════════════════════════
    // PRIVACY / DATA REQUEST CENTER
    // ══════════════════════════════════════════════════════════════════════════
    await client.query(`
      CREATE TABLE IF NOT EXISTS data_requests (
        id             BIGSERIAL PRIMARY KEY,
        candidate_id   BIGINT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
        request_type   TEXT NOT NULL CHECK(request_type IN ('export','delete','correct','opt_out')),
        status         TEXT NOT NULL DEFAULT 'pending'
                       CHECK(status IN ('pending','in_progress','completed','rejected')),
        requested_by   BIGINT REFERENCES users(id) ON DELETE SET NULL,
        processed_by   BIGINT REFERENCES users(id) ON DELETE SET NULL,
        request_notes  TEXT,
        response_notes TEXT,
        legal_basis    TEXT,
        completed_at   TIMESTAMPTZ,
        created_at     TIMESTAMPTZ DEFAULT NOW(),
        updated_at     TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_data_requests_candidate ON data_requests(candidate_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_data_requests_status    ON data_requests(status)`);

    // Legal hold flag on employees + soft delete
    await client.query(`ALTER TABLE employees ADD COLUMN IF NOT EXISTS legal_hold     BOOLEAN DEFAULT FALSE`);
    await client.query(`ALTER TABLE employees ADD COLUMN IF NOT EXISTS legal_hold_reason TEXT`);
    await client.query(`ALTER TABLE employees ADD COLUMN IF NOT EXISTS deleted_at     TIMESTAMPTZ`);

    // ══════════════════════════════════════════════════════════════════════════
    // WEBHOOK & TENANT API KEY TABLE
    // ══════════════════════════════════════════════════════════════════════════
    await client.query(`
      CREATE TABLE IF NOT EXISTS api_keys (
        id           BIGSERIAL PRIMARY KEY,
        name         TEXT NOT NULL,
        key_prefix   TEXT NOT NULL,
        key_hash     TEXT NOT NULL UNIQUE,
        scopes       TEXT NOT NULL DEFAULT 'read',
        last_used_at TIMESTAMPTZ,
        expires_at   TIMESTAMPTZ,
        created_by   BIGINT REFERENCES users(id) ON DELETE SET NULL,
        is_active    BOOLEAN NOT NULL DEFAULT TRUE,
        created_at   TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS webhooks (
        id           BIGSERIAL PRIMARY KEY,
        name         TEXT NOT NULL,
        url          TEXT NOT NULL,
        events       JSONB NOT NULL DEFAULT '[]',
        secret_hash  TEXT,
        is_active    BOOLEAN NOT NULL DEFAULT TRUE,
        last_fired_at TIMESTAMPTZ,
        failure_count INTEGER DEFAULT 0,
        created_by   BIGINT REFERENCES users(id) ON DELETE SET NULL,
        created_at   TIMESTAMPTZ DEFAULT NOW(),
        updated_at   TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_webhooks_active ON webhooks(is_active) WHERE is_active = TRUE`);

    // ══════════════════════════════════════════════════════════════════════════
    // EEO / EEOC COMPLIANCE FIELDS
    // Covers: EEO-1 (EEOC), VEVRAA (veteran status), Section 503 / ADA (disability)
    // ══════════════════════════════════════════════════════════════════════════

    // --- Org-level EEO configuration (org_profile) ---
    await client.query(`ALTER TABLE org_profile ADD COLUMN IF NOT EXISTS eeo_company_number     TEXT`);
    await client.query(`ALTER TABLE org_profile ADD COLUMN IF NOT EXISTS naics_code             TEXT`);
    await client.query(`ALTER TABLE org_profile ADD COLUMN IF NOT EXISTS naics_description      TEXT`);
    await client.query(`ALTER TABLE org_profile ADD COLUMN IF NOT EXISTS establishment_type     TEXT DEFAULT 'single'
                        CHECK(establishment_type IN ('single','multi_hq','multi_establishment'))`);
    await client.query(`ALTER TABLE org_profile ADD COLUMN IF NOT EXISTS eeo1_filing_required   BOOLEAN DEFAULT FALSE`);
    await client.query(`ALTER TABLE org_profile ADD COLUMN IF NOT EXISTS is_federal_contractor  BOOLEAN DEFAULT FALSE`);
    await client.query(`ALTER TABLE org_profile ADD COLUMN IF NOT EXISTS federal_contractor_uei TEXT`);
    await client.query(`ALTER TABLE org_profile ADD COLUMN IF NOT EXISTS aap_in_place           BOOLEAN DEFAULT FALSE`);
    await client.query(`ALTER TABLE org_profile ADD COLUMN IF NOT EXISTS aap_effective_date     DATE`);
    await client.query(`ALTER TABLE org_profile ADD COLUMN IF NOT EXISTS eeo_officer_name       TEXT`);
    await client.query(`ALTER TABLE org_profile ADD COLUMN IF NOT EXISTS eeo_officer_email      TEXT`);
    await client.query(`ALTER TABLE org_profile ADD COLUMN IF NOT EXISTS eeo_snapshot_date      DATE`);

    // --- Candidate / employee-level EEO fields ---

    // Race / ethnicity (EEO-1 required, 7 EEOC categories + prefer_not_to_say)
    await client.query(`ALTER TABLE employees ADD COLUMN IF NOT EXISTS eeo_race_ethnicity TEXT
      CHECK(eeo_race_ethnicity IN (
        'hispanic_latino','white','black_african_american',
        'native_hawaiian_pacific_islander','asian',
        'american_indian_alaska_native','two_or_more_races','prefer_not_to_say'
      ))`);
    await client.query(`ALTER TABLE employees ADD COLUMN IF NOT EXISTS eeo_race_self_identified BOOLEAN DEFAULT TRUE`);

    // Sex / gender (EEO-1 required; nonbinary included for EEOC proposed expansion)
    await client.query(`ALTER TABLE employees ADD COLUMN IF NOT EXISTS eeo_gender TEXT
      CHECK(eeo_gender IN ('male','female','nonbinary','prefer_not_to_say'))`);

    // EEO-1 job category (9 EEOC occupational groups)
    await client.query(`ALTER TABLE employees ADD COLUMN IF NOT EXISTS eeo_job_category TEXT
      CHECK(eeo_job_category IN (
        'exec_senior_mgr','first_mid_mgr','professional','technician',
        'sales','admin_support','craft','operative',
        'laborer_helper','service_worker','not_assigned'
      ))`);

    // Veteran status (VEVRAA — required for federal contractors)
    await client.query(`ALTER TABLE employees ADD COLUMN IF NOT EXISTS veteran_status TEXT
      CHECK(veteran_status IN (
        'not_veteran','disabled_veteran','recently_separated_veteran',
        'active_duty_wartime_badge_veteran','armed_forces_service_medal_veteran',
        'prefer_not_to_say'
      ))`);
    await client.query(`ALTER TABLE employees ADD COLUMN IF NOT EXISTS veteran_self_identified BOOLEAN DEFAULT TRUE`);

    // Disability status (Section 503 / ADA)
    await client.query(`ALTER TABLE employees ADD COLUMN IF NOT EXISTS disability_status TEXT
      CHECK(disability_status IN ('yes_disability','no_disability','prefer_not_to_say'))`);
    await client.query(`ALTER TABLE employees ADD COLUMN IF NOT EXISTS disability_self_identified BOOLEAN DEFAULT TRUE`);

    // Self-ID audit trail
    await client.query(`ALTER TABLE employees ADD COLUMN IF NOT EXISTS eeo_self_id_date DATE`);
    await client.query(`ALTER TABLE employees ADD COLUMN IF NOT EXISTS eeo_data_source  TEXT DEFAULT 'not_collected'
      CHECK(eeo_data_source IN ('self_identified','visual_observation','payroll_records','not_collected'))`);

    // --- EEO-1 snapshot/reporting table ---
    await client.query(`
      CREATE TABLE IF NOT EXISTS eeo_reports (
        id             BIGSERIAL PRIMARY KEY,
        snapshot_date  DATE        NOT NULL,
        report_year    INTEGER     NOT NULL,
        location_id    BIGINT      REFERENCES org_locations(id) ON DELETE SET NULL,
        job_category   TEXT        NOT NULL,
        race_ethnicity TEXT        NOT NULL,
        gender         TEXT        NOT NULL,
        headcount      INTEGER     NOT NULL DEFAULT 0,
        created_at     TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_eeo_reports_year         ON eeo_reports(report_year)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_eeo_reports_snapshot     ON eeo_reports(snapshot_date)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_eeo_reports_job_category ON eeo_reports(job_category)`);


    // ══════════════════════════════════════════════════════════════════════════
    // IDEMPOTENT TABLE RENAME: candidates → employees
    // Runs once on existing DBs; no-op on fresh DBs (table is created as employees)
    // ══════════════════════════════════════════════════════════════════════════
    await client.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT FROM pg_tables
          WHERE schemaname = current_schema() AND tablename = 'candidates'
        ) AND NOT EXISTS (
          SELECT FROM pg_tables
          WHERE schemaname = current_schema() AND tablename = 'employees'
        ) THEN
          ALTER TABLE candidates RENAME TO employees;
          -- Update index names to match
          IF EXISTS (SELECT FROM pg_indexes WHERE schemaname = current_schema() AND indexname = 'idx_candidates_user_id') THEN
            ALTER INDEX idx_candidates_user_id   RENAME TO idx_employees_user_id;
          END IF;
          IF EXISTS (SELECT FROM pg_indexes WHERE schemaname = current_schema() AND indexname = 'idx_candidates_client_id') THEN
            ALTER INDEX idx_candidates_client_id RENAME TO idx_employees_client_id;
          END IF;
          IF EXISTS (SELECT FROM pg_indexes WHERE schemaname = current_schema() AND indexname = 'idx_candidates_status') THEN
            ALTER INDEX idx_candidates_status    RENAME TO idx_employees_status;
          END IF;
        END IF;
      END $$
    `);

    // ══════════════════════════════════════════════════════════════════════════
    // EMPLOYEE NUMBER GENERATION + DUPLICATE DETECTION
    // ══════════════════════════════════════════════════════════════════════════

    // --- employees table additions ---
    await client.query(`ALTER TABLE employees ADD COLUMN IF NOT EXISTS employee_number     TEXT`);
    await client.query(`ALTER TABLE employees ADD COLUMN IF NOT EXISTS ssn_hash            TEXT`);
    await client.query(`ALTER TABLE employees ADD COLUMN IF NOT EXISTS ssn_last4           TEXT`);
    await client.query(`ALTER TABLE employees ADD COLUMN IF NOT EXISTS date_of_birth       DATE`);
    await client.query(`ALTER TABLE employees ADD COLUMN IF NOT EXISTS is_rehire           BOOLEAN DEFAULT FALSE`);
    await client.query(`ALTER TABLE employees ADD COLUMN IF NOT EXISTS previous_employee_id BIGINT REFERENCES employees(id) ON DELETE SET NULL`);
    await client.query(`ALTER TABLE employees ADD COLUMN IF NOT EXISTS termination_date    DATE`);
    await client.query(`ALTER TABLE employees ADD COLUMN IF NOT EXISTS termination_reason  TEXT`);

    // Unique index on employee_number — partial so NULLs are excluded
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_employees_number
        ON employees(employee_number)
        WHERE employee_number IS NOT NULL
    `);

    // ══════════════════════════════════════════════════════════════════════════
    // FIX: documents.signature_type CHECK constraint (original DDL was wrong)
    // Old: CHECK(signature_type IN ('none','electronic','wet'))
    // New: CHECK(signature_type IN ('none','single','two_way','three_way'))
    // ══════════════════════════════════════════════════════════════════════════
    await client.query(`ALTER TABLE documents DROP CONSTRAINT IF EXISTS documents_signature_type_check`);
    await client.query(`
      ALTER TABLE documents ADD CONSTRAINT documents_signature_type_check
        CHECK(signature_type IN ('none','single','two_way','three_way'))
    `);

    // --- org_profile additions (employee number config + dup-check toggles) ---
    await client.query(`ALTER TABLE org_profile ADD COLUMN IF NOT EXISTS emp_num_mode      TEXT    DEFAULT 'auto' CHECK(emp_num_mode IN ('auto','manual'))`);
    await client.query(`ALTER TABLE org_profile ADD COLUMN IF NOT EXISTS emp_num_format    TEXT    DEFAULT 'numeric' CHECK(emp_num_format IN ('numeric','alphanumeric'))`);
    await client.query(`ALTER TABLE org_profile ADD COLUMN IF NOT EXISTS emp_num_prefix    TEXT    DEFAULT ''`);
    await client.query(`ALTER TABLE org_profile ADD COLUMN IF NOT EXISTS emp_num_suffix    TEXT    DEFAULT ''`);
    await client.query(`ALTER TABLE org_profile ADD COLUMN IF NOT EXISTS emp_num_padding   INT     DEFAULT 4`);
    await client.query(`ALTER TABLE org_profile ADD COLUMN IF NOT EXISTS emp_num_next_seq  BIGINT  DEFAULT 1`);
    await client.query(`ALTER TABLE org_profile ADD COLUMN IF NOT EXISTS dup_check_enabled BOOLEAN DEFAULT TRUE`);
    await client.query(`ALTER TABLE org_profile ADD COLUMN IF NOT EXISTS dup_check_ssn     BOOLEAN DEFAULT TRUE`);
    await client.query(`ALTER TABLE org_profile ADD COLUMN IF NOT EXISTS dup_check_dob     BOOLEAN DEFAULT FALSE`);
    await client.query(`ALTER TABLE org_profile ADD COLUMN IF NOT EXISTS dup_check_name    BOOLEAN DEFAULT FALSE`);

    console.log(`✅ Schema ready: ${schema}`);
  } finally {
    client.release();
  }
}

/**
 * Seed the admin user for a newly provisioned tenant.
 * must_change_password=FALSE means the admin chose their own password.
 */
async function seedTenantAdmin(slug, adminName, adminEmail, adminPassword) {
  const { wrapper, release } = await createScopedWrapper(pool, `tenant_${slug}`);
  try {
    const hash = await bcrypt.hash(adminPassword, 10);
    const existing = await wrapper.prepare(
      "SELECT id FROM users WHERE role = 'admin' LIMIT 1"
    ).get();

    if (existing) {
      await wrapper.prepare(
        'UPDATE users SET name = $1, email = $2, password_hash = $3, must_change_password = FALSE WHERE id = $4'
      ).run(adminName, adminEmail.toLowerCase().trim(), hash, existing.id);
    } else {
      await wrapper.prepare(
        'INSERT INTO users (name, email, password_hash, role, must_change_password) VALUES ($1, $2, $3, $4, $5)'
      ).run(adminName, adminEmail.toLowerCase().trim(), hash, 'admin', false);
    }
  } finally {
    release();
  }
}

/**
 * Seed default admin + demo data for a brand-new tenant.
 * Production: only the admin account, no demo employees.
 */
async function initializeTenantData(slug) {
  const { wrapper, release } = await createScopedWrapper(pool, `tenant_${slug}`);
  try {
    const adminExists = await wrapper.prepare(
      "SELECT id FROM users WHERE role = 'admin' LIMIT 1"
    ).get();

    if (adminExists) return; // already initialized

    const hash = await bcrypt.hash('admin123', 10);
    await wrapper.prepare(
      'INSERT INTO users (name, email, password_hash, role, must_change_password) VALUES ($1, $2, $3, $4, $5)'
    ).run('Admin User', 'admin@hireiq.com', hash, 'admin', true);

    if (process.env.NODE_ENV !== 'production') {
      // Seed demo data for development only
      const c1 = await wrapper.prepare(
        'INSERT INTO clients (name, contact_name, contact_email, address) VALUES ($1, $2, $3, $4)'
      ).run('Acme Corporation', 'John Smith', 'john@acme.com', '123 Main St, New York');

      const c2 = await wrapper.prepare(
        'INSERT INTO clients (name, contact_name, contact_email, address) VALUES ($1, $2, $3, $4)'
      ).run('Tech Solutions Ltd', 'Jane Doe', 'jane@techsolutions.com', '456 Tech Ave, San Francisco');

      await wrapper.prepare(
        'INSERT INTO clients (name, contact_name, contact_email, address) VALUES ($1, $2, $3, $4)'
      ).run('Global Ventures', 'Bob Johnson', 'bob@globalventures.com', '789 Biz Blvd, Chicago');

      const pwHash = await bcrypt.hash('candidate123', 10);

      const u1 = await wrapper.prepare(
        'INSERT INTO users (name, email, password_hash, role, must_change_password) VALUES ($1, $2, $3, $4, $5)'
      ).run('Alice Johnson', 'alice@hireiq.com', pwHash, 'candidate', true);

      const a1 = await wrapper.prepare(
        'INSERT INTO employees (user_id, name, email, phone, role, hourly_rate, client_id, start_date, status, contract_type) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)'
      ).run(u1.lastInsertRowid, 'Alice Johnson', 'alice@hireiq.com', '+1-555-0101', 'Senior Developer', 95, c1.lastInsertRowid, '2025-01-15', 'active', 'contractor');

      const u2 = await wrapper.prepare(
        'INSERT INTO users (name, email, password_hash, role, must_change_password) VALUES ($1, $2, $3, $4, $5)'
      ).run('Bob Williams', 'bob@hireiq.com', pwHash, 'candidate', true);

      await wrapper.prepare(
        'INSERT INTO employees (user_id, name, email, phone, role, hourly_rate, client_id, start_date, status, contract_type) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)'
      ).run(u2.lastInsertRowid, 'Bob Williams', 'bob@hireiq.com', '+1-555-0102', 'UX Designer', 75, c2.lastInsertRowid, '2025-02-01', 'active', 'contractor');

      const aliceId = a1.lastInsertRowid;
      await wrapper.prepare(
        'INSERT INTO time_entries (candidate_id, date, hours, description, project, status) VALUES ($1,$2,$3,$4,$5,$6)'
      ).run(aliceId, '2026-03-03', 8, 'API development', 'Backend API', 'approved');

      await wrapper.prepare(
        'INSERT INTO time_entries (candidate_id, date, hours, description, project, status) VALUES ($1,$2,$3,$4,$5,$6)'
      ).run(aliceId, '2026-03-04', 7.5, 'Frontend integration', 'Backend API', 'approved');

      console.log('✅ Demo data seeded (development only)');
    } else {
      console.log('✅ Admin account created (production — no demo data)');
    }
  } finally {
    release();
  }
}

/**
 * Full tenant provisioning: schema + tables + seed admin.
 * Called from the Super Admin "create tenant" endpoint.
 */
async function provisionTenantDb(slug, adminName, adminEmail, adminPassword) {
  await createTenantSchema(slug);
  await initializeTenantData(slug);
  await seedTenantAdmin(slug, adminName, adminEmail, adminPassword);
  console.log(`✅ Tenant provisioned: ${slug} (admin: ${adminEmail})`);
}

/**
 * Returns a scoped wrapper for a tenant.
 * Used by injectTenantDb and internal tooling.
 * Note: for HTTP requests, use injectTenantDb middleware instead —
 * it manages connection lifecycle tied to the request.
 */
async function getTenantDb(slug) {
  const { wrapper, release } = await createScopedWrapper(pool, `tenant_${slug}`);
  return { wrapper, release };
}

/** Bootstrap the default 'hireiq' tenant if it doesn't exist (dev/first-run). */
async function bootstrapDefaultTenant() {
  try {
    await createTenantSchema('hireiq');
    await initializeTenantData('hireiq');
  } catch (err) {
    console.error('[bootstrap] Failed to bootstrap default tenant:', err.message);
  }
}

module.exports = {
  pool,
  createTenantSchema,
  initializeTenantData,
  seedTenantAdmin,
  provisionTenantDb,
  getTenantDb,
  bootstrapDefaultTenant,
};
