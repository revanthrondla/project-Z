/**
 * HireIQ Database Migrations (PostgreSQL)
 *
 * Uses a schema_migrations table per schema to track which migrations have run.
 * All migrations are idempotent — safe to call repeatedly.
 *
 * Entry points:
 *   runAllMigrations()             — master schema + all tenant schemas
 *   runMigrationsForSchema(schema) — one specific schema
 */

const pool = require('./db/pool');

// ── Migration registry ────────────────────────────────────────────────────────
// Each entry: { id, description, up: async (client) => void }
// Migrations run in ID order. Once recorded in schema_migrations they are skipped.

const MIGRATIONS = [
  {
    id: 1,
    description: 'Add must_change_password to users',
    async up(client) {
      await client.query(`
        ALTER TABLE users
          ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE
      `);
    },
  },
  {
    id: 2,
    description: 'Add user_id to clients',
    async up(client) {
      await client.query(`
        ALTER TABLE clients
          ADD COLUMN IF NOT EXISTS user_id BIGINT REFERENCES users(id) ON DELETE SET NULL
      `);
    },
  },
  {
    id: 3,
    description: 'Add client_approved status to invoices',
    async up(client) {
      // PostgreSQL CHECK constraints cannot be changed with ALTER — drop and recreate
      // Use DO $$ to avoid error if constraint doesn't exist yet
      await client.query(`
        DO $$
        BEGIN
          ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_status_check;
          ALTER TABLE invoices
            ADD CONSTRAINT invoices_status_check
            CHECK (status IN ('draft','pending','approved','client_approved','paid','overdue','cancelled'));
        EXCEPTION WHEN others THEN NULL;
        END;
        $$
      `);
    },
  },
  {
    id: 4,
    description: 'Create invoice_payments table',
    async up(client) {
      await client.query(`
        CREATE TABLE IF NOT EXISTS invoice_payments (
          id             BIGSERIAL PRIMARY KEY,
          invoice_id     BIGINT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
          amount         NUMERIC(12,2) NOT NULL,
          payment_date   DATE NOT NULL,
          payment_method TEXT NOT NULL DEFAULT 'bank_transfer',
          reference      TEXT,
          notes          TEXT,
          recorded_by    BIGINT REFERENCES users(id) ON DELETE SET NULL,
          created_at     TIMESTAMPTZ DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_invoice_payments_invoice
          ON invoice_payments(invoice_id);
      `);
    },
  },
  {
    id: 5,
    description: 'Create payroll tables',
    async up(client) {
      await client.query(`
        CREATE TABLE IF NOT EXISTS payroll_runs (
          id            BIGSERIAL PRIMARY KEY,
          pay_period    TEXT NOT NULL,
          period_start  DATE NOT NULL,
          period_end    DATE NOT NULL,
          status        TEXT NOT NULL DEFAULT 'draft'
                        CHECK(status IN ('draft','processing','completed','cancelled')),
          total_gross   NUMERIC(14,2) DEFAULT 0,
          total_net     NUMERIC(14,2) DEFAULT 0,
          created_by    BIGINT REFERENCES users(id) ON DELETE SET NULL,
          created_at    TIMESTAMPTZ DEFAULT NOW(),
          completed_at  TIMESTAMPTZ
        );

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

        CREATE INDEX IF NOT EXISTS idx_payroll_items_run
          ON payroll_items(payroll_run_id);
        CREATE INDEX IF NOT EXISTS idx_payroll_items_candidate
          ON payroll_items(candidate_id);
      `);
    },
  },
  {
    id: 6,
    description: 'Add updated_at columns and triggers',
    async up(client) {
      // Create a reusable trigger function
      await client.query(`
        CREATE OR REPLACE FUNCTION set_updated_at()
        RETURNS TRIGGER LANGUAGE plpgsql AS $$
        BEGIN
          NEW.updated_at = NOW();
          RETURN NEW;
        END;
        $$
      `);

      // List of tables that need updated_at triggers
      const tables = [
        'users', 'candidates', 'clients', 'time_entries',
        'invoices', 'absences', 'payroll_runs',
      ];

      for (const tbl of tables) {
        // Add column if missing
        await client.query(`
          ALTER TABLE ${tbl}
            ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()
        `);
        // Create trigger (idempotent — drop first)
        await client.query(`
          DROP TRIGGER IF EXISTS trg_${tbl}_updated_at ON ${tbl};
          CREATE TRIGGER trg_${tbl}_updated_at
            BEFORE UPDATE ON ${tbl}
            FOR EACH ROW EXECUTE FUNCTION set_updated_at()
        `);
      }
    },
  },
  {
    id: 7,
    description: 'Create employee profile & employment history tables',
    async up(client) {
      await client.query(`
        -- Emergency contacts
        CREATE TABLE IF NOT EXISTS emergency_contacts (
          id              BIGSERIAL PRIMARY KEY,
          candidate_id    BIGINT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
          name            TEXT NOT NULL,
          relationship    TEXT NOT NULL,
          phone           TEXT NOT NULL,
          email           TEXT,
          is_primary      BOOLEAN NOT NULL DEFAULT FALSE,
          created_at      TIMESTAMPTZ DEFAULT NOW(),
          updated_at      TIMESTAMPTZ DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_ec_candidate ON emergency_contacts(candidate_id);

        -- Bank / payment details
        CREATE TABLE IF NOT EXISTS bank_details (
          id              BIGSERIAL PRIMARY KEY,
          candidate_id    BIGINT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
          bank_name       TEXT NOT NULL,
          account_name    TEXT NOT NULL,
          account_number  TEXT NOT NULL,
          sort_code       TEXT,
          iban            TEXT,
          swift_bic       TEXT,
          is_primary      BOOLEAN NOT NULL DEFAULT TRUE,
          created_at      TIMESTAMPTZ DEFAULT NOW(),
          updated_at      TIMESTAMPTZ DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_bd_candidate ON bank_details(candidate_id);

        -- Documents / attachments
        CREATE TABLE IF NOT EXISTS candidate_documents (
          id              BIGSERIAL PRIMARY KEY,
          candidate_id    BIGINT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
          document_type   TEXT NOT NULL,
          file_name       TEXT NOT NULL,
          file_path       TEXT NOT NULL,
          file_size       BIGINT,
          mime_type       TEXT,
          expiry_date     DATE,
          notes           TEXT,
          uploaded_by     BIGINT REFERENCES users(id) ON DELETE SET NULL,
          created_at      TIMESTAMPTZ DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_cd_candidate ON candidate_documents(candidate_id);

        -- Employment history (effective-dated)
        -- effective_to = NULL means the record is current
        CREATE TABLE IF NOT EXISTS employment_history (
          id               BIGSERIAL PRIMARY KEY,
          candidate_id     BIGINT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
          effective_from   DATE NOT NULL,
          effective_to     DATE,
          job_title        TEXT,
          department       TEXT,
          employment_type  TEXT CHECK(employment_type IN
                             ('full_time','part_time','contract','freelance','intern')),
          hourly_rate      NUMERIC(10,2),
          annual_salary    NUMERIC(14,2),
          currency         TEXT NOT NULL DEFAULT 'GBP',
          work_location    TEXT,
          manager_id       BIGINT REFERENCES candidates(id) ON DELETE SET NULL,
          client_id        BIGINT REFERENCES clients(id) ON DELETE SET NULL,
          notes            TEXT,
          changed_by       BIGINT REFERENCES users(id) ON DELETE SET NULL,
          created_at       TIMESTAMPTZ DEFAULT NOW(),
          CONSTRAINT chk_eh_dates CHECK (effective_to IS NULL OR effective_to > effective_from)
        );
        CREATE INDEX IF NOT EXISTS idx_eh_candidate   ON employment_history(candidate_id);
        CREATE INDEX IF NOT EXISTS idx_eh_effective   ON employment_history(candidate_id, effective_from DESC);
        CREATE INDEX IF NOT EXISTS idx_eh_current     ON employment_history(candidate_id) WHERE effective_to IS NULL;

        -- Salary / rate history (separate from employment for granularity)
        CREATE TABLE IF NOT EXISTS salary_history (
          id             BIGSERIAL PRIMARY KEY,
          candidate_id   BIGINT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
          effective_from DATE NOT NULL,
          effective_to   DATE,
          hourly_rate    NUMERIC(10,2),
          annual_salary  NUMERIC(14,2),
          currency       TEXT NOT NULL DEFAULT 'GBP',
          reason         TEXT,
          changed_by     BIGINT REFERENCES users(id) ON DELETE SET NULL,
          created_at     TIMESTAMPTZ DEFAULT NOW(),
          CONSTRAINT chk_sh_dates CHECK (effective_to IS NULL OR effective_to > effective_from)
        );
        CREATE INDEX IF NOT EXISTS idx_sh_candidate ON salary_history(candidate_id);
        CREATE INDEX IF NOT EXISTS idx_sh_current   ON salary_history(candidate_id) WHERE effective_to IS NULL;
      `);
    },
  },
  {
    id: 8,
    description: 'Create audit_logs table',
    async up(client) {
      await client.query(`
        CREATE TABLE IF NOT EXISTS audit_logs (
          id          BIGSERIAL PRIMARY KEY,
          table_name  TEXT NOT NULL,
          record_id   BIGINT,
          action      TEXT NOT NULL CHECK(action IN ('INSERT','UPDATE','DELETE')),
          changed_by  BIGINT REFERENCES users(id) ON DELETE SET NULL,
          changed_at  TIMESTAMPTZ DEFAULT NOW(),
          old_values  JSONB,
          new_values  JSONB,
          ip_address  TEXT,
          user_agent  TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_al_table   ON audit_logs(table_name);
        CREATE INDEX IF NOT EXISTS idx_al_record  ON audit_logs(table_name, record_id);
        CREATE INDEX IF NOT EXISTS idx_al_changed ON audit_logs(changed_at DESC);
        CREATE INDEX IF NOT EXISTS idx_al_user    ON audit_logs(changed_by);
      `);
    },
  },
  {
    id: 9,
    description: 'Create AI / chat tables',
    async up(client) {
      await client.query(`
        CREATE TABLE IF NOT EXISTS ai_conversations (
          id           BIGSERIAL PRIMARY KEY,
          user_id      BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          title        TEXT,
          context_type TEXT DEFAULT 'general',
          context_id   BIGINT,
          created_at   TIMESTAMPTZ DEFAULT NOW(),
          updated_at   TIMESTAMPTZ DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_ai_conv_user ON ai_conversations(user_id);

        CREATE TABLE IF NOT EXISTS ai_messages (
          id              BIGSERIAL PRIMARY KEY,
          conversation_id BIGINT NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
          role            TEXT NOT NULL CHECK(role IN ('user','assistant','system')),
          content         TEXT NOT NULL,
          tokens_used     INTEGER,
          model           TEXT,
          created_at      TIMESTAMPTZ DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_ai_msg_conv ON ai_messages(conversation_id);

        CREATE TABLE IF NOT EXISTS tenant_ai_config (
          id                 BIGSERIAL PRIMARY KEY,
          provider           TEXT NOT NULL DEFAULT 'anthropic'
                             CHECK(provider IN ('anthropic','openai')),
          model              TEXT NOT NULL DEFAULT 'claude-haiku-4-5-20251001',
          api_key            TEXT,
          max_tokens         INTEGER DEFAULT 4096,
          temperature        NUMERIC(3,2) DEFAULT 0.7,
          system_prompt      TEXT,
          updated_at         TIMESTAMPTZ DEFAULT NOW()
        );
        INSERT INTO tenant_ai_config (provider, model) VALUES ('anthropic', 'claude-haiku-4-5-20251001')
        ON CONFLICT DO NOTHING;
      `);
    },
  },
  {
    id: 10,
    description: 'Create absence policy and accrual tables',
    async up(client) {
      await client.query(`
        CREATE TABLE IF NOT EXISTS absence_policies (
          id                BIGSERIAL PRIMARY KEY,
          name              TEXT NOT NULL,
          absence_type      TEXT NOT NULL,
          accrual_method    TEXT NOT NULL DEFAULT 'fixed'
                            CHECK(accrual_method IN ('fixed','accrual','unlimited')),
          days_per_year     NUMERIC(6,2),
          carry_over_days   NUMERIC(6,2) DEFAULT 0,
          requires_approval BOOLEAN NOT NULL DEFAULT TRUE,
          notice_days       INTEGER DEFAULT 0,
          is_active         BOOLEAN NOT NULL DEFAULT TRUE,
          created_at        TIMESTAMPTZ DEFAULT NOW(),
          updated_at        TIMESTAMPTZ DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS absence_balances (
          id              BIGSERIAL PRIMARY KEY,
          candidate_id    BIGINT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
          policy_id       BIGINT NOT NULL REFERENCES absence_policies(id) ON DELETE CASCADE,
          year            INTEGER NOT NULL,
          entitlement     NUMERIC(6,2) NOT NULL DEFAULT 0,
          taken           NUMERIC(6,2) NOT NULL DEFAULT 0,
          pending         NUMERIC(6,2) NOT NULL DEFAULT 0,
          carry_over      NUMERIC(6,2) NOT NULL DEFAULT 0,
          updated_at      TIMESTAMPTZ DEFAULT NOW(),
          UNIQUE(candidate_id, policy_id, year)
        );
        CREATE INDEX IF NOT EXISTS idx_ab_candidate ON absence_balances(candidate_id, year);
      `);
    },
  },
  {
    id: 11,
    description: 'Schema normalisation — rename legacy tables and add missing columns',
    async up(client) {
      // ── 1. Table renames (each DO block is a no-op on fresh schemas) ──────

      // tenant_ai_config  →  ai_settings
      await client.query(`
        DO $$
        BEGIN
          IF EXISTS (
            SELECT 1 FROM information_schema.tables
            WHERE table_schema = current_schema() AND table_name = 'tenant_ai_config'
          ) AND NOT EXISTS (
            SELECT 1 FROM information_schema.tables
            WHERE table_schema = current_schema() AND table_name = 'ai_settings'
          ) THEN
            ALTER TABLE tenant_ai_config RENAME TO ai_settings;
          END IF;
        END;
        $$
      `);

      // support_messages  →  support_ticket_messages
      await client.query(`
        DO $$
        BEGIN
          IF EXISTS (
            SELECT 1 FROM information_schema.tables
            WHERE table_schema = current_schema() AND table_name = 'support_messages'
          ) AND NOT EXISTS (
            SELECT 1 FROM information_schema.tables
            WHERE table_schema = current_schema() AND table_name = 'support_ticket_messages'
          ) THEN
            ALTER TABLE support_messages RENAME TO support_ticket_messages;
          END IF;
        END;
        $$
      `);

      // email_payment_events  →  email_payment_imports
      await client.query(`
        DO $$
        BEGIN
          IF EXISTS (
            SELECT 1 FROM information_schema.tables
            WHERE table_schema = current_schema() AND table_name = 'email_payment_events'
          ) AND NOT EXISTS (
            SELECT 1 FROM information_schema.tables
            WHERE table_schema = current_schema() AND table_name = 'email_payment_imports'
          ) THEN
            ALTER TABLE email_payment_events RENAME TO email_payment_imports;
          END IF;
        END;
        $$
      `);

      // payroll_entries  →  payroll_items
      await client.query(`
        DO $$
        BEGIN
          IF EXISTS (
            SELECT 1 FROM information_schema.tables
            WHERE table_schema = current_schema() AND table_name = 'payroll_entries'
          ) AND NOT EXISTS (
            SELECT 1 FROM information_schema.tables
            WHERE table_schema = current_schema() AND table_name = 'payroll_items'
          ) THEN
            ALTER TABLE payroll_entries RENAME TO payroll_items;
          END IF;
        END;
        $$
      `);

      // ── 2. Add missing columns to ai_messages ─────────────────────────────
      // tool_data stores serialised tool call/result pairs for assistant turns
      await client.query(`
        ALTER TABLE ai_messages
          ADD COLUMN IF NOT EXISTS tool_data JSONB
      `);

      // ── 3. Add missing columns to ai_documents ────────────────────────────
      // file_name / file_type / file_size were missing from original DDL
      await client.query(`
        ALTER TABLE ai_documents
          ADD COLUMN IF NOT EXISTS file_name TEXT,
          ADD COLUMN IF NOT EXISTS file_type TEXT,
          ADD COLUMN IF NOT EXISTS file_size BIGINT
      `);

      // ── 4. Backfill search_vector for schemas without GENERATED column ─────
      // GENERATED ALWAYS AS ... STORED cannot be added via ALTER TABLE in PG.
      // For old schemas: add a plain TSVECTOR column, backfill it, and attach
      // a trigger so it stays current on INSERT/UPDATE.
      await client.query(`
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = current_schema()
              AND table_name   = 'ai_documents'
              AND column_name  = 'search_vector'
          ) THEN
            ALTER TABLE ai_documents ADD COLUMN search_vector TSVECTOR;

            UPDATE ai_documents
            SET search_vector = to_tsvector('english',
              coalesce(title,'') || ' ' || coalesce(content,''));

            CREATE INDEX IF NOT EXISTS idx_ai_docs_fts
              ON ai_documents USING GIN(search_vector);

            CREATE OR REPLACE FUNCTION ai_documents_sv_update()
            RETURNS TRIGGER LANGUAGE plpgsql AS $fn$
            BEGIN
              NEW.search_vector :=
                to_tsvector('english',
                  coalesce(NEW.title,'') || ' ' || coalesce(NEW.content,''));
              RETURN NEW;
            END;
            $fn$;

            DROP TRIGGER IF EXISTS trg_ai_docs_sv ON ai_documents;
            CREATE TRIGGER trg_ai_docs_sv
              BEFORE INSERT OR UPDATE ON ai_documents
              FOR EACH ROW EXECUTE FUNCTION ai_documents_sv_update();
          END IF;
        END;
        $$
      `);

      // ── 5. Fix email_settings column names ────────────────────────────────
      // Routes expect: imap_host, imap_port, imap_user, imap_password
      // Old DDL used:  host,      port,      username,  password_enc
      await client.query(`
        DO $$
        BEGIN
          IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = current_schema()
              AND table_name   = 'email_settings'
              AND column_name  = 'host'
          ) THEN
            ALTER TABLE email_settings RENAME COLUMN host         TO imap_host;
            ALTER TABLE email_settings RENAME COLUMN port         TO imap_port;
            ALTER TABLE email_settings RENAME COLUMN username     TO imap_user;
            ALTER TABLE email_settings RENAME COLUMN password_enc TO imap_password;
          END IF;
        END;
        $$
      `);

      // ── 6. Add missing columns to ai_settings ────────────────────────────
      // Columns added when tenant_ai_config was normalised to ai_settings
      await client.query(`
        ALTER TABLE IF EXISTS ai_settings
          ADD COLUMN IF NOT EXISTS system_prompt_suffix TEXT,
          ADD COLUMN IF NOT EXISTS allow_tenant_keys    BOOLEAN DEFAULT TRUE,
          ADD COLUMN IF NOT EXISTS updated_by           BIGINT REFERENCES users(id) ON DELETE SET NULL
      `);

      // ── 7. Idempotent indexes on renamed tables ────────────────────────────
      // These may not exist if the tables were just renamed
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_stm_ticket
          ON support_ticket_messages(ticket_id);
        CREATE INDEX IF NOT EXISTS idx_email_imports_status
          ON email_payment_imports(status);
        CREATE INDEX IF NOT EXISTS idx_payroll_items_run
          ON payroll_items(payroll_run_id);
        CREATE INDEX IF NOT EXISTS idx_payroll_items_candidate
          ON payroll_items(candidate_id);
        CREATE INDEX IF NOT EXISTS idx_ai_docs_fts
          ON ai_documents USING GIN(search_vector);
      `);
    },
  },
];

// ── Core migration runner ─────────────────────────────────────────────────────

/**
 * Run all pending migrations for a single PostgreSQL schema.
 * Creates a schema_migrations tracking table if it doesn't exist.
 *
 * @param {string} schema  e.g. 'master', 'tenant_hireiq'
 */
async function runMigrationsForSchema(schema) {
  const client = await pool.connect();
  try {
    await client.query(`SET search_path TO "${schema}", public`);

    // Ensure the tracking table exists
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id          INTEGER PRIMARY KEY,
        description TEXT NOT NULL,
        applied_at  TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Find which migrations have already run
    const { rows: applied } = await client.query('SELECT id FROM schema_migrations');
    const appliedIds = new Set(applied.map(r => r.id));

    const pending = MIGRATIONS
      .filter(m => !appliedIds.has(m.id))
      .sort((a, b) => a.id - b.id);
    if (pending.length === 0) {
      console.log(`  ⏭  [${schema}] All migrations up to date`);
      return;
    }

    for (const migration of pending) {
      console.log(`  → [${schema}] Migration ${migration.id}: ${migration.description}`);
      try {
        await client.query('BEGIN');
        await migration.up(client);
        await client.query(
          'INSERT INTO schema_migrations (id, description) VALUES ($1, $2)',
          [migration.id, migration.description]
        );
        await client.query('COMMIT');
        console.log(`  ✅ [${schema}] Migration ${migration.id} applied`);
      } catch (err) {
        await client.query('ROLLBACK');
        console.error(`  ❌ [${schema}] Migration ${migration.id} failed:`, err.message);
        throw err;
      }
    }
  } finally {
    client.release();
  }
}

/**
 * Run migrations for ALL schemas:
 *   1. master schema (audit_logs lives there too)
 *   2. every tenant_* schema
 *
 * Called once at server startup.
 */
async function runAllMigrations() {
  console.log('🔄 Running database migrations…');

  // Discover all tenant schemas
  const { rows: schemas } = await pool.query(`
    SELECT schema_name
    FROM information_schema.schemata
    WHERE schema_name LIKE 'tenant_%'
    ORDER BY schema_name
  `);

  const tenantSchemas = schemas.map(r => r.schema_name);
  const allSchemas = ['master', ...tenantSchemas];

  for (const schema of allSchemas) {
    await runMigrationsForSchema(schema);
  }

  console.log('✅ All migrations complete');
}

module.exports = { runAllMigrations, runMigrationsForSchema };
