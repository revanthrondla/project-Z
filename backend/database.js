/**
 * HireIQ — PostgreSQL tenant database layer
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
  -- CANDIDATES (EMPLOYEES)
  -- ═══════════════════════════════════════════════════════════════════════════

  CREATE TABLE IF NOT EXISTS candidates (
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

  -- Resume builder (one per candidate, JSON arrays for sections)
  CREATE TABLE IF NOT EXISTS candidate_resumes (
    id             BIGSERIAL PRIMARY KEY,
    candidate_id   BIGINT UNIQUE NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
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
    candidate_id  BIGINT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
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
    candidate_id  BIGINT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
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
    candidate_id   BIGINT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
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
    candidate_id BIGINT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
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
                     CHECK(signature_type IN ('none','electronic','wet')),
    required_signers TEXT,                      -- comma-separated roles
    status           TEXT DEFAULT 'pending'
                     CHECK(status IN ('pending','partial','completed','voided')),
    uploaded_by      BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    candidate_id     BIGINT REFERENCES candidates(id) ON DELETE CASCADE,
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
    candidate_id     BIGINT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
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
    candidate_id     BIGINT UNIQUE NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
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
    candidate_id     BIGINT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
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
    candidate_id    BIGINT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
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
    candidate_id     BIGINT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
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
    candidate_id     BIGINT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
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
    candidate_id  BIGINT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
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
    candidate_id   BIGINT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
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
    candidate_id  BIGINT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
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
    candidate_id    BIGINT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
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
    candidate_id         BIGINT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
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

  CREATE INDEX IF NOT EXISTS idx_candidates_user_id      ON candidates(user_id);
  CREATE INDEX IF NOT EXISTS idx_candidates_client_id    ON candidates(client_id);
  CREATE INDEX IF NOT EXISTS idx_candidates_status       ON candidates(status);
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
 * Production: only the admin account, no demo candidates.
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
        'INSERT INTO candidates (user_id, name, email, phone, role, hourly_rate, client_id, start_date, status, contract_type) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)'
      ).run(u1.lastInsertRowid, 'Alice Johnson', 'alice@hireiq.com', '+1-555-0101', 'Senior Developer', 95, c1.lastInsertRowid, '2025-01-15', 'active', 'contractor');

      const u2 = await wrapper.prepare(
        'INSERT INTO users (name, email, password_hash, role, must_change_password) VALUES ($1, $2, $3, $4, $5)'
      ).run('Bob Williams', 'bob@hireiq.com', pwHash, 'candidate', true);

      await wrapper.prepare(
        'INSERT INTO candidates (user_id, name, email, phone, role, hourly_rate, client_id, start_date, status, contract_type) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)'
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
