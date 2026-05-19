/**
 * Flow Database Migrations (PostgreSQL)
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
// Each entry: { id, description, scope, up: async (client) => void }
//   scope: 'tenant'  — runs only on tenant_* schemas (tables: users, candidates, …)
//   scope: 'master'  — runs only on the master schema (tables: tenants, super_admins, …)
//   scope: 'all'     — runs on every schema (omit scope to default to 'all')
// Migrations run in ID order. Once recorded in schema_migrations they are skipped.

const MIGRATIONS = [
  {
    id: 1,
    scope: 'tenant',
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
    scope: 'tenant',
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
    scope: 'tenant',
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
    scope: 'tenant',
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
    scope: 'tenant',
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
          candidate_id     BIGINT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
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
    scope: 'tenant',
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
      // Note: 'candidates' was renamed to 'employees' — use employees here
      const tables = [
        'users', 'employees', 'clients', 'time_entries',
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
    scope: 'tenant',
    description: 'Create employee profile & employment history tables',
    async up(client) {
      await client.query(`
        -- Emergency contacts
        CREATE TABLE IF NOT EXISTS emergency_contacts (
          id              BIGSERIAL PRIMARY KEY,
          candidate_id    BIGINT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
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
          candidate_id    BIGINT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
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
          candidate_id    BIGINT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
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
          candidate_id     BIGINT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
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
          manager_id       BIGINT REFERENCES employees(id) ON DELETE SET NULL,
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
          candidate_id   BIGINT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
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
    scope: 'tenant',
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
    scope: 'tenant',
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
    scope: 'tenant',
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
          candidate_id    BIGINT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
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
    scope: 'tenant',
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
  {
    id: 13,
    scope: 'tenant',
    description: 'Create org_locations, org_legal_entities, org_departments, pay_rules tables + add org-link columns to employees',
    async up(client) {
      // ── Org locations ───────────────────────────────────────────────────────
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

      // ── Org legal entities ──────────────────────────────────────────────────
      await client.query(`
        CREATE TABLE IF NOT EXISTS org_legal_entities (
          id                  BIGSERIAL PRIMARY KEY,
          legal_name          TEXT NOT NULL,
          trading_name        TEXT,
          tax_id_label        TEXT DEFAULT 'Tax ID',
          tax_id              TEXT,
          vat_number          TEXT,
          registration_number TEXT,
          jurisdiction        TEXT,
          address_line1       TEXT,
          address_line2       TEXT,
          city                TEXT,
          state               TEXT,
          postcode            TEXT,
          country             TEXT DEFAULT 'US',
          is_primary          BOOLEAN DEFAULT FALSE,
          notes               TEXT,
          created_at          TIMESTAMPTZ DEFAULT NOW(),
          updated_at          TIMESTAMPTZ DEFAULT NOW()
        )
      `);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_org_legal_entities_primary ON org_legal_entities(is_primary)`);

      // ── Org departments ─────────────────────────────────────────────────────
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

      // ── Org-link columns on employees (only if employees table exists) ────────
      const empCheck = await client.query(`
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = current_schema() AND table_name = 'employees'
      `);
      if (empCheck.rowCount > 0) {
        await client.query(`ALTER TABLE employees ADD COLUMN IF NOT EXISTS department_id   BIGINT REFERENCES org_departments(id)    ON DELETE SET NULL`);
        await client.query(`ALTER TABLE employees ADD COLUMN IF NOT EXISTS location_id     BIGINT REFERENCES org_locations(id)      ON DELETE SET NULL`);
        await client.query(`ALTER TABLE employees ADD COLUMN IF NOT EXISTS legal_entity_id BIGINT REFERENCES org_legal_entities(id) ON DELETE SET NULL`);
        await client.query(`ALTER TABLE employees ADD COLUMN IF NOT EXISTS pay_frequency   TEXT DEFAULT 'bi-weekly'`);
        // Upsert the CHECK constraint cleanly (safe even if it already exists)
        await client.query(`ALTER TABLE employees DROP CONSTRAINT IF EXISTS employees_pay_frequency_check`);
        await client.query(`ALTER TABLE employees ADD CONSTRAINT employees_pay_frequency_check
          CHECK (pay_frequency IN ('weekly','bi-weekly','semi-monthly','monthly','quarterly','annually'))`);
      }
    },
  },
  {
    id: 14,
    scope: 'tenant',
    description: 'Create pay_rules table + add pay_rule_id to employees + seed FLSA default rule',
    async up(client) {
      await client.query(`
        CREATE TABLE IF NOT EXISTS pay_rules (
          id                    BIGSERIAL PRIMARY KEY,
          name                  TEXT NOT NULL,
          is_default            BOOLEAN NOT NULL DEFAULT FALSE,
          workweek_start        TEXT NOT NULL DEFAULT 'monday'
                                CHECK(workweek_start IN ('monday','tuesday','wednesday','thursday','friday','saturday','sunday')),
          daily_ot_threshold    NUMERIC(5,2),
          weekly_ot_threshold   NUMERIC(5,2) DEFAULT 40,
          double_time_threshold NUMERIC(5,2),
          ot_multiplier         NUMERIC(4,2) DEFAULT 1.5,
          dt_multiplier         NUMERIC(4,2) DEFAULT 2.0,
          minimum_wage          NUMERIC(8,2) DEFAULT 7.25,
          time_rounding         TEXT NOT NULL DEFAULT 'none'
                                CHECK(time_rounding IN ('none','6min','15min','nearest_quarter')),
          break_threshold_hours NUMERIC(4,2) DEFAULT 6,
          break_duration_min    INTEGER DEFAULT 30,
          paid_breaks           BOOLEAN DEFAULT FALSE,
          location_id           BIGINT REFERENCES org_locations(id) ON DELETE SET NULL,
          notes                 TEXT,
          created_at            TIMESTAMPTZ DEFAULT NOW(),
          updated_at            TIMESTAMPTZ DEFAULT NOW()
        )
      `);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_pay_rules_default ON pay_rules(is_default) WHERE is_default = TRUE`);

      // Only add the FK column if employees exists
      const empCheck2 = await client.query(`
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = current_schema() AND table_name = 'employees'
      `);
      if (empCheck2.rowCount > 0) {
        await client.query(`ALTER TABLE employees ADD COLUMN IF NOT EXISTS pay_rule_id BIGINT REFERENCES pay_rules(id) ON DELETE SET NULL`);
      }

      // Seed one FLSA-compliant default rule if none exists
      await client.query(`
        INSERT INTO pay_rules (name, is_default, workweek_start, weekly_ot_threshold, ot_multiplier, minimum_wage, time_rounding)
        SELECT 'FLSA Standard', TRUE, 'monday', 40, 1.5, 7.25, 'none'
        WHERE NOT EXISTS (SELECT 1 FROM pay_rules WHERE is_default = TRUE)
      `);
    },
  },
  {
    id: 15,
    scope: 'tenant',
    description: 'Create password_history table for SOC 2 password reuse prevention',
    async up(client) {
      await client.query(`
        CREATE TABLE IF NOT EXISTS password_history (
          id            BIGSERIAL PRIMARY KEY,
          user_id       BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          password_hash TEXT NOT NULL,
          created_at    TIMESTAMPTZ DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_password_history_user
          ON password_history(user_id, created_at DESC);
      `);
    },
  },
  {
    id: 16,
    scope: 'tenant',
    description: 'Add last_login_at to users for SOC 2 access review',
    async up(client) {
      await client.query(`
        ALTER TABLE users
          ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ
      `);
    },
  },
  {
    id: 17,
    scope: 'tenant',
    description: 'GDPR Art.30: Records of Processing Activities table',
    async up(client) {
      await client.query(`
        CREATE TABLE IF NOT EXISTS gdpr_processing_activities (
          id               BIGSERIAL PRIMARY KEY,
          name             TEXT NOT NULL,
          purpose          TEXT NOT NULL,
          lawful_basis     TEXT NOT NULL CHECK (lawful_basis IN (
                             'consent','contract','legal_obligation','vital_interests',
                             'public_task','legitimate_interests')),
          data_categories  TEXT[],
          data_subjects    TEXT[],
          recipients       TEXT,
          third_countries  TEXT,
          retention_period TEXT,
          security_measures TEXT,
          created_by       BIGINT REFERENCES users(id) ON DELETE SET NULL,
          created_at       TIMESTAMPTZ DEFAULT NOW(),
          updated_at       TIMESTAMPTZ DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_gdpr_ropa_lawful ON gdpr_processing_activities(lawful_basis);
      `);
    },
  },
  {
    id: 18,
    scope: 'tenant',
    description: 'GDPR Art.33: Data breach register table',
    async up(client) {
      await client.query(`
        CREATE TABLE IF NOT EXISTS gdpr_breach_register (
          id                   BIGSERIAL PRIMARY KEY,
          title                TEXT NOT NULL,
          discovered_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          reported_at          TIMESTAMPTZ,
          severity             TEXT NOT NULL DEFAULT 'medium'
                               CHECK (severity IN ('low','medium','high','critical')),
          description          TEXT,
          affected_records     INTEGER,
          data_types_affected  TEXT[],
          cause                TEXT,
          containment_actions  TEXT,
          dpa_notified         BOOLEAN DEFAULT FALSE,
          dpa_notification_at  TIMESTAMPTZ,
          individuals_notified BOOLEAN DEFAULT FALSE,
          ind_notification_at  TIMESTAMPTZ,
          status               TEXT NOT NULL DEFAULT 'open'
                               CHECK (status IN ('open','investigating','contained','closed')),
          resolution_notes     TEXT,
          created_by           BIGINT REFERENCES users(id) ON DELETE SET NULL,
          created_at           TIMESTAMPTZ DEFAULT NOW(),
          updated_at           TIMESTAMPTZ DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_gdpr_breach_status ON gdpr_breach_register(status);
        CREATE INDEX IF NOT EXISTS idx_gdpr_breach_severity ON gdpr_breach_register(severity);
      `);
    },
  },
  {
    id: 19,
    scope: 'tenant',
    description: 'GDPR Art.37/13: DPO + GDPR settings columns in org_profile',
    async up(client) {
      // Guard: some tenants were provisioned without org_profile — skip gracefully
      await client.query(`
        DO $$
        BEGIN
          IF EXISTS (
            SELECT 1 FROM information_schema.tables
            WHERE table_schema = current_schema()
              AND table_name = 'org_profile'
          ) THEN
            ALTER TABLE org_profile
              ADD COLUMN IF NOT EXISTS dpo_name              TEXT,
              ADD COLUMN IF NOT EXISTS dpo_email             TEXT,
              ADD COLUMN IF NOT EXISTS dpo_phone             TEXT,
              ADD COLUMN IF NOT EXISTS lawful_basis_default  TEXT DEFAULT 'legitimate_interests',
              ADD COLUMN IF NOT EXISTS consent_expiry_days   INTEGER DEFAULT 365,
              ADD COLUMN IF NOT EXISTS cross_border_transfer BOOLEAN DEFAULT FALSE,
              ADD COLUMN IF NOT EXISTS cross_border_details  TEXT,
              ADD COLUMN IF NOT EXISTS privacy_notice_url    TEXT,
              ADD COLUMN IF NOT EXISTS gdpr_enabled          BOOLEAN DEFAULT FALSE;
          END IF;
        END
        $$
      `);
    },
  },
  {
    id: 20,
    scope: 'tenant',
    description: 'Multi-module custom fields: custom_field_defs + custom_field_values + migrate employee data',
    async up(client) {
      // ── New generic custom field definitions (module-scoped, up to 10 per module) ─
      await client.query(`
        CREATE TABLE IF NOT EXISTS custom_field_defs (
          id            BIGSERIAL PRIMARY KEY,
          module        TEXT NOT NULL,
          field_key     TEXT NOT NULL,
          label         TEXT NOT NULL,
          field_type    TEXT NOT NULL DEFAULT 'text'
                        CHECK(field_type IN (
                          'text','textarea','number','currency',
                          'select','multiselect','checkbox',
                          'date','datetime','lookup','formula'
                        )),
          options       JSONB NOT NULL DEFAULT '[]',
          lookup_config JSONB,
          formula       TEXT,
          placeholder   TEXT,
          help_text     TEXT,
          validation    JSONB NOT NULL DEFAULT '{}',
          display_order INTEGER NOT NULL DEFAULT 0,
          is_active     BOOLEAN NOT NULL DEFAULT TRUE,
          created_at    TIMESTAMPTZ DEFAULT NOW(),
          updated_at    TIMESTAMPTZ DEFAULT NOW(),
          UNIQUE(module, field_key)
        )
      `);

      // ── New generic custom field values ──────────────────────────────────────────
      await client.query(`
        CREATE TABLE IF NOT EXISTS custom_field_values (
          id         BIGSERIAL PRIMARY KEY,
          module     TEXT NOT NULL,
          record_id  BIGINT NOT NULL,
          field_key  TEXT NOT NULL,
          value_text TEXT,
          value_json JSONB,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW(),
          UNIQUE(module, record_id, field_key)
        )
      `);

      await client.query(`CREATE INDEX IF NOT EXISTS idx_cfd_module_active ON custom_field_defs(module, is_active)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_cfv_module_record ON custom_field_values(module, record_id)`);

      // ── Migrate existing employee_custom_field_defs → custom_field_defs ─────────
      // Map old field types to new ones; preserve all other columns.
      const defsExist = await client.query(`
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = current_schema() AND table_name = 'employee_custom_field_defs'
      `);
      if (defsExist.rowCount > 0) {
        await client.query(`
          INSERT INTO custom_field_defs
            (module, field_key, label, field_type, options, formula, placeholder,
             help_text, validation, display_order, is_active, created_at, updated_at)
          SELECT
            'employees',
            field_key,
            label,
            CASE field_type
              WHEN 'rich_text'      THEN 'textarea'
              WHEN 'radio'          THEN 'select'
              WHEN 'multi_checkbox' THEN 'multiselect'
              ELSE field_type
            END,
            COALESCE(options,    '[]'::jsonb),
            formula,
            placeholder,
            help_text,
            COALESCE(validation, '{}'::jsonb),
            display_order,
            is_active,
            created_at,
            updated_at
          FROM employee_custom_field_defs
          ON CONFLICT (module, field_key) DO NOTHING
        `);

        // ── Migrate existing employee_custom_field_values → custom_field_values ───
        const valsExist = await client.query(`
          SELECT 1 FROM information_schema.tables
          WHERE table_schema = current_schema() AND table_name = 'employee_custom_field_values'
        `);
        if (valsExist.rowCount > 0) {
          await client.query(`
            INSERT INTO custom_field_values
              (module, record_id, field_key, value_text, value_json, created_at, updated_at)
            SELECT
              'employees',
              candidate_id,
              v.field_key,
              v.value_text,
              v.value_json,
              COALESCE(v.updated_at, NOW()),
              COALESCE(v.updated_at, NOW())
            FROM employee_custom_field_values v
            ON CONFLICT (module, record_id, field_key) DO NOTHING
          `);
        }
      }
    },
  },
  // ── Migration 21: P1/P2/P3 — Attendance, Holidays, Manager chain, Partial-day leave ──
  {
    id: 21,
    scope: 'tenant',
    description: 'Clock-in/out attendance, public holidays, manager chain, partial-day leave, break tracking, budget alerts',
    async up(client) {

      // ── P2: Clock-in / clock-out attendance events ─────────────────────────
      await client.query(`
        CREATE TABLE IF NOT EXISTS clock_events (
          id            BIGSERIAL PRIMARY KEY,
          employee_id   BIGINT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
          event_type    TEXT   NOT NULL CHECK (event_type IN ('clock_in','clock_out','break_start','break_end')),
          event_time    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          latitude      NUMERIC(9,6),
          longitude     NUMERIC(9,6),
          accuracy_m    NUMERIC(7,2),
          location_name TEXT,
          device_info   TEXT,
          ip_address    TEXT,
          notes         TEXT,
          created_at    TIMESTAMPTZ DEFAULT NOW()
        )
      `);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_clock_events_employee ON clock_events(employee_id, event_time DESC)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_clock_events_date ON clock_events(event_time DESC)`);

      // ── P2: Public / bank holidays per org location ────────────────────────
      await client.query(`
        CREATE TABLE IF NOT EXISTS public_holidays (
          id            BIGSERIAL PRIMARY KEY,
          location_id   BIGINT REFERENCES org_locations(id) ON DELETE SET NULL,
          holiday_date  DATE   NOT NULL,
          name          TEXT   NOT NULL,
          is_mandatory  BOOLEAN NOT NULL DEFAULT TRUE,
          applies_to    TEXT   NOT NULL DEFAULT 'all'
                          CHECK (applies_to IN ('all','full_time','part_time','contractors')),
          created_at    TIMESTAMPTZ DEFAULT NOW(),
          updated_at    TIMESTAMPTZ DEFAULT NOW()
        )
      `);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_holidays_date ON public_holidays(holiday_date)`);
      await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_holidays_unique ON public_holidays(location_id, holiday_date, name)`);

      // ── P3: Manager hierarchy on employees ────────────────────────────────
      await client.query(`
        ALTER TABLE employees
          ADD COLUMN IF NOT EXISTS manager_id         BIGINT REFERENCES employees(id) ON DELETE SET NULL,
          ADD COLUMN IF NOT EXISTS secondary_approver BIGINT REFERENCES employees(id) ON DELETE SET NULL
      `);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_employees_manager ON employees(manager_id)`);

      // ── P1: Partial-day & hourly absence requests ─────────────────────────
      await client.query(`
        ALTER TABLE absences
          ADD COLUMN IF NOT EXISTS is_partial_day  BOOLEAN NOT NULL DEFAULT FALSE,
          ADD COLUMN IF NOT EXISTS partial_hours   NUMERIC(4,2),
          ADD COLUMN IF NOT EXISTS rejection_reason TEXT,
          ADD COLUMN IF NOT EXISTS approved_by     BIGINT REFERENCES employees(id) ON DELETE SET NULL,
          ADD COLUMN IF NOT EXISTS approved_at     TIMESTAMPTZ
      `);

      // ── P1: Break tracking in time entries ────────────────────────────────
      // Split into two separate ALTER TABLE statements: PostgreSQL cannot reference
      // a column being added in the same statement from a GENERATED ALWAYS AS expression.
      await client.query(`
        ALTER TABLE time_entries
          ADD COLUMN IF NOT EXISTS break_minutes INTEGER NOT NULL DEFAULT 0
                                   CHECK (break_minutes >= 0)
      `);
      await client.query(`
        ALTER TABLE time_entries
          ADD COLUMN IF NOT EXISTS billable_hours NUMERIC(6,2)
                                   GENERATED ALWAYS AS
                                   (CASE WHEN is_billable THEN
                                     GREATEST(0, ROUND(hours - break_minutes::NUMERIC / 60, 4))
                                   ELSE 0 END) STORED
      `);

      // ── P1: Project budget alert thresholds ───────────────────────────────
      await client.query(`
        ALTER TABLE projects
          ADD COLUMN IF NOT EXISTS budget_alert_threshold  INTEGER DEFAULT 80
                                   CHECK (budget_alert_threshold BETWEEN 1 AND 100),
          ADD COLUMN IF NOT EXISTS budget_alert_pct        NUMERIC(5,2) DEFAULT 0,
          ADD COLUMN IF NOT EXISTS budget_alert_sent_at    TIMESTAMPTZ,
          ADD COLUMN IF NOT EXISTS budget_last_computed_at TIMESTAMPTZ
      `);

      // ── P1: Leave balance accrual tracking ───────────────────────────────
      await client.query(`
        ALTER TABLE leave_balances
          ADD COLUMN IF NOT EXISTS accrued_days     NUMERIC(6,2) NOT NULL DEFAULT 0,
          ADD COLUMN IF NOT EXISTS pending_days     NUMERIC(6,2) NOT NULL DEFAULT 0,
          ADD COLUMN IF NOT EXISTS last_accrual_at  TIMESTAMPTZ,
          ADD COLUMN IF NOT EXISTS carry_over_days  NUMERIC(6,2) NOT NULL DEFAULT 0,
          ADD COLUMN IF NOT EXISTS expires_at       DATE
      `);

      await client.query(`
        ALTER TABLE absence_policies
          ADD COLUMN IF NOT EXISTS accrual_last_run   DATE,
          ADD COLUMN IF NOT EXISTS carry_over_expiry_months INTEGER DEFAULT 3,
          ADD COLUMN IF NOT EXISTS max_carry_over_days NUMERIC(6,2) DEFAULT 5,
          ADD COLUMN IF NOT EXISTS max_balance_days   NUMERIC(6,2)
      `);

      // Attendance daily summary (computed/cached for dashboard performance)
      await client.query(`
        CREATE TABLE IF NOT EXISTS attendance_daily (
          id            BIGSERIAL PRIMARY KEY,
          employee_id   BIGINT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
          work_date     DATE   NOT NULL,
          clock_in_time  TIMESTAMPTZ,
          clock_out_time TIMESTAMPTZ,
          total_minutes  INTEGER,
          break_minutes  INTEGER NOT NULL DEFAULT 0,
          net_minutes    INTEGER,
          status        TEXT NOT NULL DEFAULT 'absent'
                          CHECK (status IN ('present','absent','late','partial','on_leave','holiday')),
          notes         TEXT,
          created_at    TIMESTAMPTZ DEFAULT NOW(),
          updated_at    TIMESTAMPTZ DEFAULT NOW(),
          UNIQUE(employee_id, work_date)
        )
      `);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_attendance_daily_date ON attendance_daily(work_date DESC)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_attendance_daily_emp ON attendance_daily(employee_id, work_date DESC)`);
    },
  },

  {
    id: 22,
    scope: 'tenant',
    description: 'Scheduled reports table for weekly/monthly email delivery',
    async up(client) {
      await client.query(`
        CREATE TABLE IF NOT EXISTS scheduled_reports (
          id            BIGSERIAL PRIMARY KEY,
          name          TEXT    NOT NULL,
          report_type   TEXT    NOT NULL CHECK (report_type IN ('hours','absences','revenue','labor_cost','utilization','payroll')),
          frequency     TEXT    NOT NULL CHECK (frequency IN ('daily','weekly','monthly')),
          day_of_week   INTEGER CHECK (day_of_week BETWEEN 0 AND 6),   -- for weekly (0=Sun)
          day_of_month  INTEGER CHECK (day_of_month BETWEEN 1 AND 28), -- for monthly
          recipients    TEXT[]  NOT NULL DEFAULT '{}',
          format        TEXT    NOT NULL DEFAULT 'csv' CHECK (format IN ('csv','pdf')),
          period        TEXT    NOT NULL DEFAULT 'last_period' CHECK (period IN ('last_period','last_month','last_week','last_quarter','last_year')),
          is_active     BOOLEAN NOT NULL DEFAULT TRUE,
          last_sent_at  TIMESTAMPTZ,
          next_run_at   TIMESTAMPTZ,
          created_by    BIGINT  REFERENCES users(id) ON DELETE SET NULL,
          created_at    TIMESTAMPTZ DEFAULT NOW(),
          updated_at    TIMESTAMPTZ DEFAULT NOW()
        )
      `);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_sched_reports_active ON scheduled_reports(is_active, next_run_at)`);
    },
  },

  {
    id: 12,
    scope: 'tenant',
    description: 'Add client approval fields to time_entries',
    async up(client) {
      // client_approval_status tracks whether the client has approved each
      // time entry (null = not yet sent, pending, approved, rejected).
      // client_approval_note and client_approved_at are populated when the
      // client responds via the client portal.
      await client.query(`
        ALTER TABLE time_entries
          ADD COLUMN IF NOT EXISTS client_approval_status TEXT DEFAULT NULL
            CHECK (client_approval_status IN ('pending', 'approved', 'rejected') OR client_approval_status IS NULL),
          ADD COLUMN IF NOT EXISTS client_approval_note   TEXT,
          ADD COLUMN IF NOT EXISTS client_approved_at     TIMESTAMPTZ
      `);

      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_te_client_approval
          ON time_entries(client_approval_status)
          WHERE client_approval_status IS NOT NULL
      `);
    },
  },

  {
    id: 23,
    scope: 'tenant',
    description: 'Recovery migration — ensure clock_events, public_holidays, attendance_daily tables exist (idempotent)',
    async up(client) {
      // Migration 21 could have failed on some tenant schemas due to the
      // billable_hours GENERATED ALWAYS AS expression referencing break_minutes
      // in the same ALTER TABLE statement. This migration ensures the three key
      // tables from that transaction are created regardless.

      await client.query(`
        CREATE TABLE IF NOT EXISTS clock_events (
          id            BIGSERIAL PRIMARY KEY,
          employee_id   BIGINT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
          event_type    TEXT   NOT NULL CHECK (event_type IN ('clock_in','clock_out','break_start','break_end')),
          event_time    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          latitude      NUMERIC(9,6),
          longitude     NUMERIC(9,6),
          accuracy_m    NUMERIC(7,2),
          location_name TEXT,
          device_info   TEXT,
          ip_address    TEXT,
          notes         TEXT,
          created_at    TIMESTAMPTZ DEFAULT NOW()
        )
      `);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_clock_events_employee ON clock_events(employee_id, event_time DESC)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_clock_events_date ON clock_events(event_time DESC)`);

      await client.query(`
        CREATE TABLE IF NOT EXISTS public_holidays (
          id            BIGSERIAL PRIMARY KEY,
          location_id   BIGINT REFERENCES org_locations(id) ON DELETE SET NULL,
          holiday_date  DATE   NOT NULL,
          name          TEXT   NOT NULL,
          is_mandatory  BOOLEAN NOT NULL DEFAULT TRUE,
          applies_to    TEXT   NOT NULL DEFAULT 'all'
                          CHECK (applies_to IN ('all','full_time','part_time','contractors')),
          created_at    TIMESTAMPTZ DEFAULT NOW(),
          updated_at    TIMESTAMPTZ DEFAULT NOW()
        )
      `);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_holidays_date ON public_holidays(holiday_date)`);
      await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_holidays_unique ON public_holidays(location_id, holiday_date, name)`);

      await client.query(`
        CREATE TABLE IF NOT EXISTS attendance_daily (
          id             BIGSERIAL PRIMARY KEY,
          employee_id    BIGINT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
          work_date      DATE   NOT NULL,
          clock_in_time  TIMESTAMPTZ,
          clock_out_time TIMESTAMPTZ,
          total_minutes  INTEGER,
          break_minutes  INTEGER NOT NULL DEFAULT 0,
          net_minutes    INTEGER,
          status         TEXT NOT NULL DEFAULT 'absent'
                           CHECK (status IN ('present','absent','late','partial','on_leave','holiday')),
          notes          TEXT,
          created_at     TIMESTAMPTZ DEFAULT NOW(),
          updated_at     TIMESTAMPTZ DEFAULT NOW(),
          UNIQUE(employee_id, work_date)
        )
      `);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_attendance_daily_date ON attendance_daily(work_date DESC)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_attendance_daily_emp  ON attendance_daily(employee_id, work_date DESC)`);

      // Also ensure break_minutes exists on time_entries (may have failed in migration 21)
      await client.query(`
        ALTER TABLE time_entries
          ADD COLUMN IF NOT EXISTS break_minutes INTEGER NOT NULL DEFAULT 0
                                   CHECK (break_minutes >= 0)
      `);
      // Add billable_hours only if break_minutes already exists (it does, from above)
      await client.query(`
        ALTER TABLE time_entries
          ADD COLUMN IF NOT EXISTS billable_hours NUMERIC(6,2)
                                   GENERATED ALWAYS AS
                                   (CASE WHEN is_billable THEN
                                     GREATEST(0, ROUND(hours - break_minutes::NUMERIC / 60, 4))
                                   ELSE 0 END) STORED
      `);
    },
  },

  {
    id: 24,
    scope: 'tenant',
    description: 'ID scan audit logs for OCR-based bulk hiring (hr_id_scan module)',
    async up(client) {
      await client.query(`
        CREATE TABLE IF NOT EXISTS id_scan_logs (
          id              BIGSERIAL PRIMARY KEY,
          scanned_by      BIGINT REFERENCES users(id) ON DELETE SET NULL,
          scan_time       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          id_type         TEXT,
          id_number_hash  TEXT,
          outcome         TEXT NOT NULL DEFAULT 'extracted'
                            CHECK (outcome IN ('extracted','failed','hired','skipped')),
          employee_id     BIGINT REFERENCES employees(id) ON DELETE SET NULL,
          extracted_name  TEXT,
          confidence      NUMERIC(4,3),
          error_message   TEXT,
          created_at      TIMESTAMPTZ DEFAULT NOW()
        )
      `);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_id_scan_logs_time       ON id_scan_logs(scan_time DESC)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_id_scan_logs_employee   ON id_scan_logs(employee_id)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_id_scan_logs_scanned_by ON id_scan_logs(scanned_by)`);
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
  // Determine schema type so we can skip inapplicable migrations
  const schemaType = schema === 'master' ? 'master' : 'tenant';

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
      .filter(m => {
        if (appliedIds.has(m.id)) return false;                      // already applied
        const scope = m.scope || 'all';
        if (scope === 'all') return true;
        return scope === schemaType;                                  // only run if scope matches
      })
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

  let failedSchemas = [];
  for (const schema of allSchemas) {
    try {
      await runMigrationsForSchema(schema);
    } catch (err) {
      // A broken/incomplete tenant schema should never crash the whole server.
      // Log the error and continue — other tenants must keep working.
      console.error(`  ❌ [${schema}] Migration failed (skipping): ${err.message}`);
      failedSchemas.push({ schema, error: err.message });
    }
  }

  if (failedSchemas.length > 0) {
    console.warn(`⚠️  ${failedSchemas.length} schema(s) had migration failures — check logs above.`);
  }
  console.log('✅ All migrations complete');
}

module.exports = { runAllMigrations, runMigrationsForSchema };
