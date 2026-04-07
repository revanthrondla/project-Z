/**
 * HireIQ Database Migrations
 * Run once at startup, safe to call repeatedly (idempotent).
 */

function runMigrations(db, rawDb) {
  console.log('🔄 Running database migrations…');

  // ── 1. Allow 'client' role in users ──────────────────────────────────────
  const usersSql = rawDb.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='users'").get();
  if (usersSql && !usersSql.sql.includes("'client'")) {
    console.log("  → Migrating users table: adding 'client' role");
    rawDb.exec('PRAGMA foreign_keys = OFF');
    rawDb.exec(`
      CREATE TABLE IF NOT EXISTS users_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('admin', 'candidate', 'client')),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);
    rawDb.exec('INSERT INTO users_new SELECT * FROM users');
    rawDb.exec('DROP TABLE users');
    rawDb.exec('ALTER TABLE users_new RENAME TO users');
    rawDb.exec('PRAGMA foreign_keys = ON');
    console.log("  ✅ users table migrated");
  }

  // ── 2. Add user_id to clients ────────────────────────────────────────────
  const clientCols = rawDb.prepare("PRAGMA table_info(clients)").all();
  const colNames = clientCols.map(c => c.name);
  if (!colNames.includes('user_id')) {
    rawDb.exec('ALTER TABLE clients ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE SET NULL');
    console.log('  ✅ clients.user_id column added');
  }

  // ── 3. Allow 'client_approved' in invoices status ────────────────────────
  const invSql = rawDb.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='invoices'").get();
  if (invSql && !invSql.sql.includes("'client_approved'")) {
    console.log("  → Migrating invoices table: adding 'client_approved' status");
    rawDb.exec('PRAGMA foreign_keys = OFF');
    rawDb.exec(`
      CREATE TABLE IF NOT EXISTS invoices_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        invoice_number TEXT UNIQUE NOT NULL,
        candidate_id INTEGER NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
        client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL,
        period_start TEXT NOT NULL,
        period_end TEXT NOT NULL,
        total_hours REAL NOT NULL DEFAULT 0,
        hourly_rate REAL NOT NULL DEFAULT 0,
        total_amount REAL NOT NULL DEFAULT 0,
        status TEXT DEFAULT 'draft' CHECK(status IN ('draft', 'sent', 'paid', 'overdue', 'cancelled', 'client_approved')),
        due_date TEXT,
        notes TEXT,
        client_notes TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);
    // Copy existing data (client_notes defaults to NULL)
    rawDb.exec(`
      INSERT INTO invoices_new
        (id, invoice_number, candidate_id, client_id, period_start, period_end,
         total_hours, hourly_rate, total_amount, status, due_date, notes, created_at, updated_at)
      SELECT
        id, invoice_number, candidate_id, client_id, period_start, period_end,
        total_hours, hourly_rate, total_amount, status, due_date, notes, created_at, updated_at
      FROM invoices
    `);
    rawDb.exec('DROP TABLE invoices');
    rawDb.exec('ALTER TABLE invoices_new RENAME TO invoices');
    rawDb.exec('PRAGMA foreign_keys = ON');
    console.log('  ✅ invoices table migrated');
  }

  // ── 4. Add client_notes to invoices if missing (upgrade path) ───────────
  const invCols = rawDb.prepare("PRAGMA table_info(invoices)").all();
  if (!invCols.some(c => c.name === 'client_notes')) {
    rawDb.exec('ALTER TABLE invoices ADD COLUMN client_notes TEXT');
    console.log('  ✅ invoices.client_notes column added');
  }

  // ── 5. Add invoice_line_items if not present ─────────────────────────────
  // (already exists in base schema — nothing to do)

  // ── 6. Documents table ────────────────────────────────────────────────────
  const docsTbl = rawDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='documents'").get();
  if (!docsTbl) {
    rawDb.exec(`
      CREATE TABLE documents (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        title        TEXT NOT NULL,
        description  TEXT,
        file_name    TEXT NOT NULL,
        file_path    TEXT NOT NULL,
        file_size    INTEGER,
        mime_type    TEXT,
        uploaded_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
        candidate_id INTEGER REFERENCES candidates(id) ON DELETE CASCADE,
        client_id    INTEGER REFERENCES clients(id) ON DELETE CASCADE,
        -- signature_type: who must sign
        signature_type TEXT NOT NULL DEFAULT 'none'
          CHECK(signature_type IN ('none','single','two_way','three_way')),
        -- which roles must sign (comma-separated: candidate,client,admin)
        required_signers TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'pending'
          CHECK(status IN ('pending','partial','completed','voided')),
        created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at   DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('  ✅ documents table created');
  }

  // ── 7. Document signatures table ─────────────────────────────────────────
  const sigsTbl = rawDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='document_signatures'").get();
  if (!sigsTbl) {
    rawDb.exec(`
      CREATE TABLE document_signatures (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        document_id     INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
        signer_role     TEXT NOT NULL CHECK(signer_role IN ('candidate','client','admin')),
        signer_user_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
        signer_name     TEXT,
        signer_email    TEXT,
        -- base64 PNG of drawn signature
        signature_data  TEXT,
        signed_at       DATETIME,
        status          TEXT NOT NULL DEFAULT 'pending'
          CHECK(status IN ('pending','signed','rejected')),
        ip_address      TEXT,
        created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('  ✅ document_signatures table created');
  }

  // ── 8. Performance indexes ────────────────────────────────────────────────
  rawDb.exec(`
    -- time_entries: most queries filter/join on candidate_id and date
    CREATE INDEX IF NOT EXISTS idx_time_entries_candidate_id  ON time_entries(candidate_id);
    CREATE INDEX IF NOT EXISTS idx_time_entries_date          ON time_entries(date);
    CREATE INDEX IF NOT EXISTS idx_time_entries_status        ON time_entries(status);
    CREATE INDEX IF NOT EXISTS idx_time_entries_cand_date     ON time_entries(candidate_id, date);

    -- absences: filtered by candidate, date range, status, type
    CREATE INDEX IF NOT EXISTS idx_absences_candidate_id      ON absences(candidate_id);
    CREATE INDEX IF NOT EXISTS idx_absences_start_date        ON absences(start_date);
    CREATE INDEX IF NOT EXISTS idx_absences_status            ON absences(status);
    CREATE INDEX IF NOT EXISTS idx_absences_type              ON absences(type);

    -- invoices: filtered by candidate, client, status, period
    CREATE INDEX IF NOT EXISTS idx_invoices_candidate_id      ON invoices(candidate_id);
    CREATE INDEX IF NOT EXISTS idx_invoices_client_id         ON invoices(client_id);
    CREATE INDEX IF NOT EXISTS idx_invoices_status            ON invoices(status);
    CREATE INDEX IF NOT EXISTS idx_invoices_period_start      ON invoices(period_start);

    -- invoice_line_items: always joined on invoice_id
    CREATE INDEX IF NOT EXISTS idx_invoice_line_items_invoice ON invoice_line_items(invoice_id);

    -- candidates: filtered by client and status
    CREATE INDEX IF NOT EXISTS idx_candidates_client_id       ON candidates(client_id);
    CREATE INDEX IF NOT EXISTS idx_candidates_status          ON candidates(status);

    -- notifications: queried by user, ordered by created_at
    CREATE INDEX IF NOT EXISTS idx_notifications_user_id      ON notifications(user_id);
    CREATE INDEX IF NOT EXISTS idx_notifications_created_at   ON notifications(created_at);
  `);
  console.log('  ✅ Performance indexes ensured');

  // ── 9. aGrow tables ───────────────────────────────────────────────────────

  // 9a. ag_languages
  const langTbl = rawDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='ag_languages'").get();
  if (!langTbl) {
    rawDb.exec(`
      CREATE TABLE ag_languages (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        language_name TEXT NOT NULL,
        language_code TEXT NOT NULL UNIQUE,
        is_default    INTEGER NOT NULL DEFAULT 0,
        created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      INSERT INTO ag_languages (language_name, language_code, is_default) VALUES
        ('English', 'EN', 1),
        ('Spanish', 'ES', 0),
        ('French',  'FR', 0);
    `);
    console.log('  ✅ ag_languages table created');
  }

  // 9b. ag_custom_field_definitions
  const cfTbl = rawDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='ag_custom_field_definitions'").get();
  if (!cfTbl) {
    rawDb.exec(`
      CREATE TABLE ag_custom_field_definitions (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        field_name  TEXT NOT NULL,
        field_type  TEXT NOT NULL CHECK(field_type IN ('text','number','dropdown','date','time','boolean','image')),
        applies_to  TEXT NOT NULL DEFAULT 'all',
        options     TEXT,  -- JSON array for dropdown options
        required    INTEGER NOT NULL DEFAULT 0,
        sort_order  INTEGER NOT NULL DEFAULT 0,
        created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      INSERT INTO ag_custom_field_definitions (field_name, field_type, applies_to) VALUES
        ('Temperature', 'number', 'all'),
        ('Soil pH',     'number', 'all'),
        ('Humidity',    'number', 'all'),
        ('Product type','text',   'product');
    `);
    console.log('  ✅ ag_custom_field_definitions table created');
  }

  // 9c. ag_employees
  const empTbl = rawDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='ag_employees'").get();
  if (!empTbl) {
    rawDb.exec(`
      CREATE TABLE ag_employees (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        employee_name   TEXT NOT NULL,
        employee_number TEXT NOT NULL UNIQUE,
        crew_name       TEXT,
        entity_name     TEXT,
        ranch           TEXT,
        badge_number    TEXT,
        email           TEXT,
        gender          TEXT,
        start_date      TEXT,
        end_date        TEXT,
        custom_fields   TEXT DEFAULT '{}',  -- JSON key-value
        created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      INSERT INTO ag_employees (employee_name, employee_number, crew_name) VALUES
        ('John Doe',      'E001', 'Crew A'),
        ('Jane Smith',    'E002', 'Crew B'),
        ('Alice Johnson', 'E003', 'Crew A');
    `);
    console.log('  ✅ ag_employees table created');
  }

  // 9d. ag_products
  const prodTbl = rawDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='ag_products'").get();
  if (!prodTbl) {
    rawDb.exec(`
      CREATE TABLE ag_products (
        id                    INTEGER PRIMARY KEY AUTOINCREMENT,
        commodity             TEXT,
        ranch                 TEXT,
        entity                TEXT,
        location              TEXT,
        crate_count           INTEGER DEFAULT 0,
        metric                TEXT,
        start_time            TEXT,
        end_time              TEXT,
        picking_average       TEXT,
        highest_picking_speed TEXT,
        lowest_picking_speed  TEXT,
        custom_fields         TEXT DEFAULT '{}',
        created_at            DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at            DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      INSERT INTO ag_products (commodity, crate_count, start_time, end_time, picking_average, highest_picking_speed, lowest_picking_speed) VALUES
        ('Apples',  120, '01:00', '09:00', '03:00', '01:30', '05:00'),
        ('Oranges', 100, '02:00', '10:00', '04:00', '02:00', '06:00'),
        ('Tomatoes', 80, '03:00', '11:00', '05:00', '03:30', '07:00');
    `);
    console.log('  ✅ ag_products table created');
  }

  // 9e. ag_scans
  const scanTbl = rawDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='ag_scans'").get();
  if (!scanTbl) {
    rawDb.exec(`
      CREATE TABLE ag_scans (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        barcode       TEXT,
        scan_method   TEXT NOT NULL DEFAULT 'barcode' CHECK(scan_method IN ('barcode','camera','manual')),
        scanned_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
        synced        INTEGER NOT NULL DEFAULT 0,
        scanned_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
        custom_fields TEXT DEFAULT '{}'
      );
    `);
    console.log('  ✅ ag_scans table created');
  }

  // 9f. ag_scanned_products
  const spTbl = rawDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='ag_scanned_products'").get();
  if (!spTbl) {
    rawDb.exec(`
      CREATE TABLE ag_scanned_products (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        product_name    TEXT NOT NULL,
        quantity        REAL NOT NULL DEFAULT 0,
        unit            TEXT DEFAULT 'items',
        user_name       TEXT,
        entity_name     TEXT,
        crew_name       TEXT,
        ranch           TEXT,
        picking_average       TEXT,
        highest_picking_speed TEXT,
        lowest_picking_speed  TEXT,
        scanned_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
        synced          INTEGER NOT NULL DEFAULT 0,
        scan_id         INTEGER REFERENCES ag_scans(id) ON DELETE SET NULL,
        custom_fields   TEXT DEFAULT '{}'
      );
      INSERT INTO ag_scanned_products (product_name, quantity, unit, user_name, scanned_at) VALUES
        ('Apples',   50, 'items', 'John Doe',      '2023-10-01 05:00:00'),
        ('Tomatoes', 30, 'items', 'Jane Smith',     '2023-10-01 06:00:00'),
        ('Oranges',  40, 'items', 'Alice Johnson',  '2023-10-01 07:00:00');
    `);
    console.log('  ✅ ag_scanned_products table created');
  }

  // 9g. ag_analytics_snapshots  (stores pre-computed analytics JSON)
  const anTbl = rawDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='ag_analytics_snapshots'").get();
  if (!anTbl) {
    rawDb.exec(`
      CREATE TABLE ag_analytics_snapshots (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        snapshot_date  TEXT NOT NULL,
        crew_name      TEXT,
        harvesting_data TEXT NOT NULL DEFAULT '{}',  -- JSON
        metrics         TEXT NOT NULL DEFAULT '{}',  -- JSON
        created_at     DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      INSERT INTO ag_analytics_snapshots (snapshot_date, crew_name, harvesting_data, metrics) VALUES
        ('2023-10-03', 'Crew A',
          '{"date":"2023-10-03","crates_collected":120,"crew":"Crew A"}',
          '{"avg_picking_speed":"09:00","highest_picking_speed":"07:30","lowest_picking_speed":"11:00"}');
    `);
    console.log('  ✅ ag_analytics_snapshots table created');
  }

  // 9h. aGrow indexes
  rawDb.exec(`
    CREATE INDEX IF NOT EXISTS idx_ag_scanned_products_scanned_at ON ag_scanned_products(scanned_at);
    CREATE INDEX IF NOT EXISTS idx_ag_scanned_products_synced     ON ag_scanned_products(synced);
    CREATE INDEX IF NOT EXISTS idx_ag_scans_synced                ON ag_scans(synced);
    CREATE INDEX IF NOT EXISTS idx_ag_employees_crew              ON ag_employees(crew_name);
  `);
  console.log('  ✅ aGrow tables and indexes ready');

  // ── 10. Invoice Payments table ────────────────────────────────────────────
  const invPayTbl = rawDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='invoice_payments'").get();
  if (!invPayTbl) {
    rawDb.exec(`
      CREATE TABLE invoice_payments (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        invoice_id       INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
        amount           REAL NOT NULL,
        payment_date     TEXT NOT NULL,
        payment_method   TEXT NOT NULL DEFAULT 'bank_transfer'
                           CHECK(payment_method IN ('bank_transfer','cash','cheque','credit_card','other')),
        reference_number TEXT,
        notes            TEXT,
        recorded_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at       DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX idx_invoice_payments_invoice_id ON invoice_payments(invoice_id);
    `);
    console.log('  ✅ invoice_payments table created');
  }

  // ── 11. Candidate Resumes table ───────────────────────────────────────────
  const resTbl = rawDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='candidate_resumes'").get();
  if (!resTbl) {
    rawDb.exec(`
      CREATE TABLE candidate_resumes (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        candidate_id  INTEGER NOT NULL UNIQUE REFERENCES candidates(id) ON DELETE CASCADE,
        headline      TEXT,
        summary       TEXT,
        experience    TEXT NOT NULL DEFAULT '[]',   -- JSON array
        education     TEXT NOT NULL DEFAULT '[]',   -- JSON array
        skills        TEXT NOT NULL DEFAULT '[]',   -- JSON array of strings
        certifications TEXT NOT NULL DEFAULT '[]',  -- JSON array
        languages     TEXT NOT NULL DEFAULT '[]',   -- JSON array
        created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('  ✅ candidate_resumes table created');
  }

  // ── 12. Client timesheet approval columns ────────────────────────────────
  const teCols = rawDb.prepare("PRAGMA table_info(time_entries)").all();
  const teColNames = teCols.map(c => c.name);
  if (!teColNames.includes('client_approval_status')) {
    rawDb.exec(`ALTER TABLE time_entries ADD COLUMN client_approval_status TEXT DEFAULT NULL`);
    console.log('  ✅ time_entries.client_approval_status column added');
  }
  if (!teColNames.includes('client_approval_note')) {
    rawDb.exec(`ALTER TABLE time_entries ADD COLUMN client_approval_note TEXT`);
    console.log('  ✅ time_entries.client_approval_note column added');
  }
  if (!teColNames.includes('client_approved_at')) {
    rawDb.exec(`ALTER TABLE time_entries ADD COLUMN client_approved_at DATETIME`);
    console.log('  ✅ time_entries.client_approved_at column added');
  }
  if (!teColNames.includes('client_approved_by')) {
    rawDb.exec(`ALTER TABLE time_entries ADD COLUMN client_approved_by INTEGER`);
    console.log('  ✅ time_entries.client_approved_by column added');
  }

  // ── 13. Email settings table ─────────────────────────────────────────────
  const emailSettingsTbl = rawDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='email_settings'").get();
  if (!emailSettingsTbl) {
    rawDb.exec(`
      CREATE TABLE email_settings (
        id            INTEGER PRIMARY KEY DEFAULT 1,
        provider      TEXT NOT NULL DEFAULT 'gmail'
                        CHECK(provider IN ('gmail','outlook','imap')),
        imap_host     TEXT,
        imap_port     INTEGER DEFAULT 993,
        imap_user     TEXT,
        imap_password TEXT,
        imap_folder   TEXT NOT NULL DEFAULT 'INBOX',
        search_subject TEXT NOT NULL DEFAULT 'payment',
        poll_interval INTEGER NOT NULL DEFAULT 30,
        enabled       INTEGER NOT NULL DEFAULT 0,
        last_polled_at DATETIME,
        last_uid      INTEGER NOT NULL DEFAULT 0,
        created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      INSERT INTO email_settings (id) VALUES (1);
    `);
    console.log('  ✅ email_settings table created');
  }

  // ── 14. Email payment imports table ──────────────────────────────────────
  const emailImportsTbl = rawDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='email_payment_imports'").get();
  if (!emailImportsTbl) {
    rawDb.exec(`
      CREATE TABLE email_payment_imports (
        id                   INTEGER PRIMARY KEY AUTOINCREMENT,
        email_message_uid    TEXT UNIQUE,
        email_subject        TEXT,
        email_from           TEXT,
        email_date           TEXT,
        has_attachment       INTEGER NOT NULL DEFAULT 0,
        raw_extracted_text   TEXT,
        parsed_amount        REAL,
        parsed_client_name   TEXT,
        parsed_invoice_number TEXT,
        parsed_payment_date  TEXT,
        parsed_period_start  TEXT,
        parsed_period_end    TEXT,
        parsed_reference     TEXT,
        parsed_employee_names TEXT NOT NULL DEFAULT '[]',
        matched_invoice_id   INTEGER REFERENCES invoices(id) ON DELETE SET NULL,
        match_confidence     TEXT CHECK(match_confidence IN ('high','medium','low','none')),
        mismatch_flags       TEXT NOT NULL DEFAULT '[]',
        status               TEXT NOT NULL DEFAULT 'pending'
                               CHECK(status IN ('pending','confirmed','rejected')),
        confirmed_by         INTEGER REFERENCES users(id) ON DELETE SET NULL,
        confirmed_at         DATETIME,
        created_at           DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX idx_email_imports_status     ON email_payment_imports(status);
      CREATE INDEX idx_email_imports_invoice_id ON email_payment_imports(matched_invoice_id);
    `);
    console.log('  ✅ email_payment_imports table created');
  }

  // ── 15. Add must_change_password to users ────────────────────────────────
  const userCols15 = rawDb.prepare("PRAGMA table_info(users)").all();
  if (!userCols15.some(c => c.name === 'must_change_password')) {
    rawDb.exec('ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0');
    console.log('  ✅ users.must_change_password column added');
  }

  // ── 16. Audit log table ───────────────────────────────────────────────────
  const auditTbl = rawDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='audit_log'").get();
  if (!auditTbl) {
    rawDb.exec(`
      CREATE TABLE audit_log (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id     INTEGER,
        user_email  TEXT,
        action      TEXT NOT NULL,
        table_name  TEXT NOT NULL,
        record_id   INTEGER,
        old_values  TEXT,
        new_values  TEXT,
        ip_address  TEXT,
        created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_audit_log_table_record ON audit_log(table_name, record_id);
      CREATE INDEX IF NOT EXISTS idx_audit_log_user_id      ON audit_log(user_id);
      CREATE INDEX IF NOT EXISTS idx_audit_log_created_at   ON audit_log(created_at);
    `);
    console.log('  ✅ audit_log table created');
  }

  // ── 17. Soft-delete for candidates ───────────────────────────────────────
  const candCols17 = rawDb.prepare("PRAGMA table_info(candidates)").all();
  if (!candCols17.some(c => c.name === 'deleted_at')) {
    rawDb.exec('ALTER TABLE candidates ADD COLUMN deleted_at DATETIME DEFAULT NULL');
    console.log('  ✅ candidates.deleted_at column added (soft-delete)');
  }

  // ── 18. Tenant-level support tickets ─────────────────────────────────────
  const supportTbl = rawDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='support_tickets'").get();
  if (!supportTbl) {
    rawDb.exec(`
      CREATE TABLE support_tickets (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        subject     TEXT NOT NULL,
        description TEXT NOT NULL,
        category    TEXT NOT NULL DEFAULT 'general'
                      CHECK(category IN ('general','payroll','timesheet','invoice','absence','technical','other')),
        status      TEXT NOT NULL DEFAULT 'open'
                      CHECK(status IN ('open','in_progress','resolved','closed')),
        priority    TEXT NOT NULL DEFAULT 'medium'
                      CHECK(priority IN ('low','medium','high','urgent')),
        created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE support_ticket_messages (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        ticket_id  INTEGER NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
        user_id    INTEGER NOT NULL REFERENCES users(id),
        message    TEXT NOT NULL,
        is_staff   INTEGER NOT NULL DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_support_tickets_user   ON support_tickets(user_id);
      CREATE INDEX IF NOT EXISTS idx_support_tickets_status ON support_tickets(status);
      CREATE INDEX IF NOT EXISTS idx_support_msgs_ticket    ON support_ticket_messages(ticket_id);
    `);
    console.log('  ✅ support_tickets + support_ticket_messages tables created');
  }

  // ── 20. AI settings per tenant ───────────────────────────────────────────
  const aiSettingsTbl = rawDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='ai_settings'").get();
  if (!aiSettingsTbl) {
    rawDb.exec(`
      CREATE TABLE ai_settings (
        id                   INTEGER PRIMARY KEY DEFAULT 1,
        provider             TEXT NOT NULL DEFAULT 'anthropic'
                               CHECK(provider IN ('anthropic','openai')),
        model                TEXT NOT NULL DEFAULT 'claude-haiku-4-5-20251001',
        api_key              TEXT,
        system_prompt_suffix TEXT,
        updated_at           DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_by           INTEGER REFERENCES users(id)
      );
      INSERT INTO ai_settings (id) VALUES (1);
    `);
    console.log('  ✅ ai_settings table created');
  }

  // ── 19. AI Assistant tables ───────────────────────────────────────────────
  const aiDocsTbl = rawDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='ai_documents'").get();
  if (!aiDocsTbl) {
    rawDb.exec(`
      CREATE TABLE ai_documents (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        title       TEXT NOT NULL,
        content     TEXT NOT NULL,
        file_name   TEXT,
        file_type   TEXT DEFAULT 'text',
        file_size   INTEGER DEFAULT 0,
        uploaded_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_ai_docs_uploader ON ai_documents(uploaded_by);

      CREATE VIRTUAL TABLE ai_documents_fts USING fts5(
        title, content,
        content='ai_documents', content_rowid='id'
      );

      CREATE TRIGGER ai_documents_fts_insert AFTER INSERT ON ai_documents BEGIN
        INSERT INTO ai_documents_fts(rowid, title, content) VALUES (new.id, new.title, new.content);
      END;
      CREATE TRIGGER ai_documents_fts_delete AFTER DELETE ON ai_documents BEGIN
        INSERT INTO ai_documents_fts(ai_documents_fts, rowid, title, content)
          VALUES ('delete', old.id, old.title, old.content);
      END;
      CREATE TRIGGER ai_documents_fts_update AFTER UPDATE ON ai_documents BEGIN
        INSERT INTO ai_documents_fts(ai_documents_fts, rowid, title, content)
          VALUES ('delete', old.id, old.title, old.content);
        INSERT INTO ai_documents_fts(rowid, title, content) VALUES (new.id, new.title, new.content);
      END;

      CREATE TABLE ai_conversations (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title      TEXT NOT NULL DEFAULT 'New Chat',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_ai_conv_user ON ai_conversations(user_id);

      CREATE TABLE ai_messages (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        conversation_id INTEGER NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
        role            TEXT NOT NULL CHECK(role IN ('user','assistant')),
        content         TEXT NOT NULL,
        tool_data       TEXT,
        created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_ai_msgs_conv ON ai_messages(conversation_id);
    `);
    console.log('  ✅ AI assistant tables created (ai_documents, ai_conversations, ai_messages)');
  }

  // ── 21. Extended employee contact info ───────────────────────────────────
  const contactExtTbl = rawDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='employee_contact_ext'").get();
  if (!contactExtTbl) {
    rawDb.exec(`
      CREATE TABLE employee_contact_ext (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        candidate_id  INTEGER NOT NULL UNIQUE REFERENCES candidates(id) ON DELETE CASCADE,
        alt_phone     TEXT,
        personal_email TEXT,
        home_street   TEXT,
        home_city     TEXT,
        home_state    TEXT,
        home_postcode TEXT,
        home_country  TEXT,
        updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('  ✅ employee_contact_ext table created');
  }

  // ── 22. Emergency contacts ────────────────────────────────────────────────
  const emergencyTbl = rawDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='emergency_contacts'").get();
  if (!emergencyTbl) {
    rawDb.exec(`
      CREATE TABLE emergency_contacts (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        candidate_id INTEGER NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
        name         TEXT NOT NULL,
        relationship TEXT,
        phone1       TEXT NOT NULL,
        phone2       TEXT,
        created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at   DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_emergency_cand ON emergency_contacts(candidate_id);
    `);
    console.log('  ✅ emergency_contacts table created');
  }

  // ── 23. Employment history (positions & salaries) ─────────────────────────
  const empHistTbl = rawDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='employment_history'").get();
  if (!empHistTbl) {
    rawDb.exec(`
      CREATE TABLE employment_history (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        candidate_id    INTEGER NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
        position_title  TEXT NOT NULL,
        start_date      TEXT NOT NULL,
        end_date        TEXT,
        remuneration    REAL,
        currency        TEXT NOT NULL DEFAULT 'USD',
        frequency       TEXT NOT NULL DEFAULT 'annual'
                          CHECK(frequency IN ('hourly','daily','weekly','monthly','annual')),
        notes           TEXT,
        created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_emp_hist_cand ON employment_history(candidate_id);
    `);
    console.log('  ✅ employment_history table created');
  }

  // ── 24. Bank accounts ─────────────────────────────────────────────────────
  const bankTbl = rawDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='bank_accounts'").get();
  if (!bankTbl) {
    rawDb.exec(`
      CREATE TABLE bank_accounts (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        candidate_id   INTEGER NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
        account_name   TEXT NOT NULL,
        bank_name      TEXT NOT NULL,
        account_number TEXT NOT NULL,
        routing_number TEXT,
        swift_code     TEXT,
        country        TEXT NOT NULL DEFAULT 'US',
        is_primary     INTEGER NOT NULL DEFAULT 0,
        created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at     DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_bank_cand ON bank_accounts(candidate_id);
    `);
    console.log('  ✅ bank_accounts table created');
  }

  // ── 25. Leave balances ────────────────────────────────────────────────────
  const leaveBalTbl = rawDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='leave_balances'").get();
  if (!leaveBalTbl) {
    rawDb.exec(`
      CREATE TABLE leave_balances (
        id                INTEGER PRIMARY KEY AUTOINCREMENT,
        candidate_id      INTEGER NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
        leave_type        TEXT NOT NULL
                            CHECK(leave_type IN ('vacation','sick','personal','public_holiday','other')),
        year              INTEGER NOT NULL DEFAULT (strftime('%Y', 'now')),
        entitlement_days  REAL NOT NULL DEFAULT 0,
        used_days         REAL NOT NULL DEFAULT 0,
        carry_over_days   REAL NOT NULL DEFAULT 0,
        updated_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(candidate_id, leave_type, year)
      );
      CREATE INDEX IF NOT EXISTS idx_leave_bal_cand ON leave_balances(candidate_id);
    `);
    console.log('  ✅ leave_balances table created');
  }

  // ── 26. Company assets on loan ────────────────────────────────────────────
  const assetsTbl = rawDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='employee_assets'").get();
  if (!assetsTbl) {
    rawDb.exec(`
      CREATE TABLE employee_assets (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        candidate_id  INTEGER NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
        serial_number TEXT,
        description   TEXT NOT NULL,
        category      TEXT NOT NULL DEFAULT 'other'
                        CHECK(category IN ('computer','phone','security_card','uniform','equipment','vehicle','other')),
        checkout_date TEXT NOT NULL,
        checkin_date  TEXT,
        status        TEXT NOT NULL DEFAULT 'on_loan'
                        CHECK(status IN ('on_loan','returned','lost','damaged')),
        photo_url     TEXT,
        notes         TEXT,
        created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_assets_cand ON employee_assets(candidate_id);
    `);
    console.log('  ✅ employee_assets table created');
  }

  // ── 27. Employee benefits ─────────────────────────────────────────────────
  const benefitsTbl = rawDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='employee_benefits'").get();
  if (!benefitsTbl) {
    rawDb.exec(`
      CREATE TABLE employee_benefits (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        candidate_id   INTEGER NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
        benefit_type   TEXT NOT NULL,
        provider       TEXT,
        value          REAL,
        currency       TEXT DEFAULT 'USD',
        access_details TEXT,
        notes          TEXT,
        effective_date TEXT,
        end_date       TEXT,
        created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at     DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_benefits_cand ON employee_benefits(candidate_id);
    `);
    console.log('  ✅ employee_benefits table created');
  }

  // ── 28. Performance reviews ───────────────────────────────────────────────
  const reviewsTbl = rawDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='performance_reviews'").get();
  if (!reviewsTbl) {
    rawDb.exec(`
      CREATE TABLE performance_reviews (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        candidate_id  INTEGER NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
        review_date   TEXT NOT NULL,
        reviewer_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
        reviewer_name TEXT,
        overall_score INTEGER CHECK(overall_score BETWEEN 1 AND 5),
        evaluation    TEXT,
        next_steps    TEXT,
        created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_reviews_cand ON performance_reviews(candidate_id);
    `);
    console.log('  ✅ performance_reviews table created');
  }

  // ── 29. Training records ──────────────────────────────────────────────────
  const trainingTbl = rawDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='training_records'").get();
  if (!trainingTbl) {
    rawDb.exec(`
      CREATE TABLE training_records (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        candidate_id    INTEGER NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
        training_date   TEXT NOT NULL,
        name            TEXT NOT NULL,
        content         TEXT,
        results         TEXT,
        certificate_url TEXT,
        created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_training_cand ON training_records(candidate_id);
    `);
    console.log('  ✅ training_records table created');
  }

  // ── 30. Licences, permits & insurance ────────────────────────────────────
  const licencesTbl = rawDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='employee_licenses'").get();
  if (!licencesTbl) {
    rawDb.exec(`
      CREATE TABLE employee_licenses (
        id                  INTEGER PRIMARY KEY AUTOINCREMENT,
        candidate_id        INTEGER NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
        document_type       TEXT NOT NULL,
        document_url        TEXT,
        issue_date          TEXT,
        expiry_date         TEXT,
        reminder_days_before INTEGER NOT NULL DEFAULT 30,
        reminded_at         DATETIME,
        status              TEXT NOT NULL DEFAULT 'valid'
                              CHECK(status IN ('valid','expired','pending_renewal')),
        notes               TEXT,
        created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at          DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_licenses_cand   ON employee_licenses(candidate_id);
      CREATE INDEX IF NOT EXISTS idx_licenses_expiry ON employee_licenses(expiry_date);
    `);
    console.log('  ✅ employee_licenses table created');
  }

  // ── 31. Add candidate_id to documents (link docs to employees) ───────────
  const docCols31 = rawDb.prepare("PRAGMA table_info(documents)").all();
  if (!docCols31.some(c => c.name === 'candidate_id')) {
    rawDb.exec('ALTER TABLE documents ADD COLUMN candidate_id INTEGER REFERENCES candidates(id) ON DELETE SET NULL');
    rawDb.exec('CREATE INDEX IF NOT EXISTS idx_documents_cand ON documents(candidate_id)');
    console.log('  ✅ documents.candidate_id column added');
  }

  console.log('✅ Migrations complete');
}

/**
 * Write an entry to the audit_log table.
 * Call this from any route that mutates data (update / delete / create).
 *
 * @param {object} db         - tenant db wrapper
 * @param {object} req        - Express request (for user + IP)
 * @param {string} action     - 'CREATE' | 'UPDATE' | 'DELETE' | 'SOFT_DELETE'
 * @param {string} tableName  - e.g. 'candidates', 'invoices'
 * @param {number} recordId   - PK of the affected row
 * @param {object} [oldValues] - snapshot before change (omit for CREATE)
 * @param {object} [newValues] - snapshot after change (omit for DELETE)
 */
function writeAudit(db, req, action, tableName, recordId, oldValues = null, newValues = null) {
  try {
    db.prepare(`
      INSERT INTO audit_log (user_id, user_email, action, table_name, record_id, old_values, new_values, ip_address)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      req.user?.id   || null,
      req.user?.email || null,
      action,
      tableName,
      recordId,
      oldValues ? JSON.stringify(oldValues) : null,
      newValues ? JSON.stringify(newValues) : null,
      req.ip || null,
    );
  } catch (err) {
    // Never let audit failures crash the main request
    console.error('[Audit] Failed to write audit log entry:', err.message);
  }
}

module.exports = { runMigrations, writeAudit };
