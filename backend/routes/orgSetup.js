/**
 * Organisation Setup API  —  /api/org-setup
 *
 * Covers the "business folder" configuration that all other features depend on:
 *   GET/PUT  /api/org-setup/profile       — singleton org profile
 *   GET/POST /api/org-setup/locations     — locations list
 *   PUT/DEL  /api/org-setup/locations/:id
 *   GET/POST /api/org-setup/departments   — departments list
 *   PUT/DEL  /api/org-setup/departments/:id
 *   PATCH    /api/org-setup/departments/reorder
 *
 * All routes: admin-only, tenant-scoped via req.db.
 */

const express = require('express');
const { authenticate, requireAdmin, injectTenantDb } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate, requireAdmin, injectTenantDb);

// ── Helpers ───────────────────────────────────────────────────────────────────

const VALID_PAY_PERIODS  = ['weekly','fortnightly','semi_monthly','monthly'];
const VALID_WEEK_DAYS    = ['monday','sunday','saturday'];
const VALID_DATE_FORMATS = ['YYYY-MM-DD','DD/MM/YYYY','MM/DD/YYYY','DD-MM-YYYY'];

function cleanStr(v)  { return typeof v === 'string' ? v.trim() || null : null; }
function cleanInt(v)  { const n = parseInt(v); return isNaN(n) ? null : n; }
function cleanNum(v)  { const n = parseFloat(v); return isNaN(n) ? null : n; }
function cleanBool(v) { return v === true || v === 'true'; }

// ══════════════════════════════════════════════════════════════════════════════
// ORG PROFILE  (singleton — upsert)
// ══════════════════════════════════════════════════════════════════════════════

// GET /api/org-setup/profile
router.get('/profile', async (req, res) => {
  try {
    const result = await req.db.query('SELECT * FROM org_profile LIMIT 1');
    // Return the row, or sensible defaults if not yet configured
    res.json(result.rows[0] || {});
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/org-setup/profile — upsert (only one row ever exists)
router.put('/profile', async (req, res) => {
  try {
    const b = req.body;

    // Validate enums
    if (b.default_pay_period && !VALID_PAY_PERIODS.includes(b.default_pay_period))
      return res.status(400).json({ error: `default_pay_period must be one of: ${VALID_PAY_PERIODS.join(', ')}` });
    if (b.week_start_day && !VALID_WEEK_DAYS.includes(b.week_start_day))
      return res.status(400).json({ error: `week_start_day must be one of: ${VALID_WEEK_DAYS.join(', ')}` });
    if (b.date_format && !VALID_DATE_FORMATS.includes(b.date_format))
      return res.status(400).json({ error: `date_format must be one of: ${VALID_DATE_FORMATS.join(', ')}` });

    const existing = await req.db.query('SELECT id FROM org_profile LIMIT 1');

    if (existing.rows[0]) {
      // UPDATE
      const result = await req.db.query(`
        UPDATE org_profile SET
          legal_name              = COALESCE($1,  legal_name),
          trading_name            = COALESCE($2,  trading_name),
          description             = COALESCE($3,  description),
          industry                = COALESCE($4,  industry),
          website                 = COALESCE($5,  website),
          tax_id_label            = COALESCE($6,  tax_id_label),
          tax_id                  = COALESCE($7,  tax_id),
          vat_number              = COALESCE($8,  vat_number),
          registration_number     = COALESCE($9,  registration_number),
          address_line1           = COALESCE($10, address_line1),
          address_line2           = COALESCE($11, address_line2),
          city                    = COALESCE($12, city),
          state                   = COALESCE($13, state),
          postcode                = COALESCE($14, postcode),
          country                 = COALESCE($15, country),
          week_start_day          = COALESCE($16, week_start_day),
          standard_hours_per_day  = COALESCE($17, standard_hours_per_day),
          standard_hours_per_week = COALESCE($18, standard_hours_per_week),
          default_timezone        = COALESCE($19, default_timezone),
          date_format             = COALESCE($20, date_format),
          default_currency        = COALESCE($21, default_currency),
          currency_symbol         = COALESCE($22, currency_symbol),
          currency_position       = COALESCE($23, currency_position),
          invoice_prefix          = COALESCE($24, invoice_prefix),
          invoice_separator       = COALESCE($25, invoice_separator),
          invoice_next_number     = COALESCE($26, invoice_next_number),
          invoice_padding         = COALESCE($27, invoice_padding),
          default_pay_period      = COALESCE($28, default_pay_period),
          pay_period_anchor_date  = COALESCE($29, pay_period_anchor_date),
          doc_retention_years     = COALESCE($30, doc_retention_years),
          doc_retention_policy    = COALESCE($31, doc_retention_policy),
          updated_at              = NOW()
        WHERE id = $32
        RETURNING *
      `, [
        cleanStr(b.legal_name),            cleanStr(b.trading_name),
        cleanStr(b.description),           cleanStr(b.industry),
        cleanStr(b.website),               cleanStr(b.tax_id_label),
        cleanStr(b.tax_id),                cleanStr(b.vat_number),
        cleanStr(b.registration_number),   cleanStr(b.address_line1),
        cleanStr(b.address_line2),         cleanStr(b.city),
        cleanStr(b.state),                 cleanStr(b.postcode),
        cleanStr(b.country),               cleanStr(b.week_start_day),
        cleanNum(b.standard_hours_per_day),cleanNum(b.standard_hours_per_week),
        cleanStr(b.default_timezone),      cleanStr(b.date_format),
        cleanStr(b.default_currency),      cleanStr(b.currency_symbol),
        cleanStr(b.currency_position),     cleanStr(b.invoice_prefix),
        cleanStr(b.invoice_separator),     cleanInt(b.invoice_next_number),
        cleanInt(b.invoice_padding),       cleanStr(b.default_pay_period),
        cleanStr(b.pay_period_anchor_date),cleanInt(b.doc_retention_years),
        cleanStr(b.doc_retention_policy),
        existing.rows[0].id,
      ]);
      return res.json(result.rows[0]);
    } else {
      // INSERT (first time)
      const result = await req.db.query(`
        INSERT INTO org_profile (
          legal_name, trading_name, description, industry, website,
          tax_id_label, tax_id, vat_number, registration_number,
          address_line1, address_line2, city, state, postcode, country,
          week_start_day, standard_hours_per_day, standard_hours_per_week,
          default_timezone, date_format,
          default_currency, currency_symbol, currency_position,
          invoice_prefix, invoice_separator, invoice_next_number, invoice_padding,
          default_pay_period, pay_period_anchor_date,
          doc_retention_years, doc_retention_policy
        ) VALUES (
          $1,$2,$3,$4,$5,
          $6,$7,$8,$9,
          $10,$11,$12,$13,$14,$15,
          $16,$17,$18,
          $19,$20,
          $21,$22,$23,
          $24,$25,$26,$27,
          $28,$29,
          $30,$31
        ) RETURNING *
      `, [
        cleanStr(b.legal_name)               || null,
        cleanStr(b.trading_name)             || null,
        cleanStr(b.description)              || null,
        cleanStr(b.industry)                 || null,
        cleanStr(b.website)                  || null,
        cleanStr(b.tax_id_label)             || 'Tax ID',
        cleanStr(b.tax_id)                   || null,
        cleanStr(b.vat_number)               || null,
        cleanStr(b.registration_number)      || null,
        cleanStr(b.address_line1)            || null,
        cleanStr(b.address_line2)            || null,
        cleanStr(b.city)                     || null,
        cleanStr(b.state)                    || null,
        cleanStr(b.postcode)                 || null,
        cleanStr(b.country)                  || 'US',
        cleanStr(b.week_start_day)           || 'monday',
        cleanNum(b.standard_hours_per_day)   ?? 8,
        cleanNum(b.standard_hours_per_week)  ?? 40,
        cleanStr(b.default_timezone)         || 'UTC',
        cleanStr(b.date_format)              || 'YYYY-MM-DD',
        cleanStr(b.default_currency)         || 'USD',
        cleanStr(b.currency_symbol)          || '$',
        cleanStr(b.currency_position)        || 'before',
        cleanStr(b.invoice_prefix)           || 'INV',
        cleanStr(b.invoice_separator)        || '-',
        cleanInt(b.invoice_next_number)      ?? 1001,
        cleanInt(b.invoice_padding)          ?? 4,
        cleanStr(b.default_pay_period)       || 'weekly',
        cleanStr(b.pay_period_anchor_date)   || null,
        cleanInt(b.doc_retention_years)      ?? 7,
        cleanStr(b.doc_retention_policy)     || null,
      ]);
      return res.status(201).json(result.rows[0]);
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// EMPLOYEE NUMBER CONFIG  — GET/PUT /api/org-setup/employee-number-config
// ══════════════════════════════════════════════════════════════════════════════

const VALID_EMP_NUM_MODES    = ['auto', 'manual'];
const VALID_EMP_NUM_FORMATS  = ['numeric', 'alphanumeric'];

// GET /api/org-setup/employee-number-config
router.get('/employee-number-config', async (req, res) => {
  try {
    const r = await req.db.query(`
      SELECT emp_num_mode, emp_num_format, emp_num_prefix, emp_num_suffix,
             emp_num_padding, emp_num_next_seq,
             dup_check_enabled, dup_check_ssn, dup_check_dob, dup_check_name
      FROM org_profile LIMIT 1
    `);
    res.json(r.rows[0] || {
      emp_num_mode: 'auto', emp_num_format: 'numeric',
      emp_num_prefix: '', emp_num_suffix: '', emp_num_padding: 4, emp_num_next_seq: 1,
      dup_check_enabled: true, dup_check_ssn: true, dup_check_dob: false, dup_check_name: false,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/org-setup/employee-number-config
router.put('/employee-number-config', async (req, res) => {
  try {
    const b = req.body;

    if (b.emp_num_mode && !VALID_EMP_NUM_MODES.includes(b.emp_num_mode))
      return res.status(400).json({ error: `emp_num_mode must be one of: ${VALID_EMP_NUM_MODES.join(', ')}` });
    if (b.emp_num_format && !VALID_EMP_NUM_FORMATS.includes(b.emp_num_format))
      return res.status(400).json({ error: `emp_num_format must be one of: ${VALID_EMP_NUM_FORMATS.join(', ')}` });
    const padding = b.emp_num_padding !== undefined ? cleanInt(b.emp_num_padding) : null;
    if (padding !== null && (padding < 1 || padding > 10))
      return res.status(400).json({ error: 'emp_num_padding must be between 1 and 10' });
    const nextSeq = b.emp_num_next_seq !== undefined ? cleanInt(b.emp_num_next_seq) : null;
    if (nextSeq !== null && nextSeq < 1)
      return res.status(400).json({ error: 'emp_num_next_seq must be >= 1' });

    const existing = await req.db.query('SELECT id FROM org_profile LIMIT 1');
    if (!existing.rows[0]) {
      // Ensure org_profile row exists before trying to update
      await req.db.query('INSERT INTO org_profile DEFAULT VALUES');
    }

    const result = await req.db.query(`
      UPDATE org_profile SET
        emp_num_mode      = COALESCE($1,  emp_num_mode),
        emp_num_format    = COALESCE($2,  emp_num_format),
        emp_num_prefix    = COALESCE($3,  emp_num_prefix),
        emp_num_suffix    = COALESCE($4,  emp_num_suffix),
        emp_num_padding   = COALESCE($5,  emp_num_padding),
        emp_num_next_seq  = COALESCE($6,  emp_num_next_seq),
        dup_check_enabled = COALESCE($7,  dup_check_enabled),
        dup_check_ssn     = COALESCE($8,  dup_check_ssn),
        dup_check_dob     = COALESCE($9,  dup_check_dob),
        dup_check_name    = COALESCE($10, dup_check_name),
        updated_at        = NOW()
      RETURNING
        emp_num_mode, emp_num_format, emp_num_prefix, emp_num_suffix,
        emp_num_padding, emp_num_next_seq,
        dup_check_enabled, dup_check_ssn, dup_check_dob, dup_check_name
    `, [
      b.emp_num_mode   != null ? cleanStr(b.emp_num_mode)   : null,
      b.emp_num_format != null ? cleanStr(b.emp_num_format) : null,
      b.emp_num_prefix != null ? (b.emp_num_prefix || '')   : null,
      b.emp_num_suffix != null ? (b.emp_num_suffix || '')   : null,
      padding,
      nextSeq,
      b.dup_check_enabled != null ? cleanBool(b.dup_check_enabled) : null,
      b.dup_check_ssn     != null ? cleanBool(b.dup_check_ssn)     : null,
      b.dup_check_dob     != null ? cleanBool(b.dup_check_dob)     : null,
      b.dup_check_name    != null ? cleanBool(b.dup_check_name)     : null,
    ]);
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// LOCATIONS
// ══════════════════════════════════════════════════════════════════════════════

// GET /api/org-setup/locations
router.get('/locations', async (req, res) => {
  try {
    const result = await req.db.query(
      'SELECT * FROM org_locations ORDER BY is_primary DESC, display_order ASC, id ASC'
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/org-setup/locations
router.post('/locations', async (req, res) => {
  try {
    const { name, address_line1, address_line2, city, state, postcode, country,
            timezone, phone, is_primary, is_active } = req.body;

    if (!name?.trim()) return res.status(400).json({ error: 'name is required' });

    // If marking as primary, demote any existing primary
    if (cleanBool(is_primary)) {
      await req.db.query('UPDATE org_locations SET is_primary = FALSE WHERE is_primary = TRUE');
    }

    const orderRes = await req.db.query('SELECT COALESCE(MAX(display_order), -1) + 1 AS next FROM org_locations');
    const display_order = parseInt(orderRes.rows[0].next);

    const result = await req.db.query(`
      INSERT INTO org_locations
        (name, address_line1, address_line2, city, state, postcode, country,
         timezone, phone, is_primary, is_active, display_order)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      RETURNING *
    `, [
      name.trim(),
      cleanStr(address_line1), cleanStr(address_line2),
      cleanStr(city),          cleanStr(state),
      cleanStr(postcode),      cleanStr(country) || 'US',
      cleanStr(timezone)  || 'UTC',
      cleanStr(phone),
      cleanBool(is_primary),
      is_active !== false,
      display_order,
    ]);
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/org-setup/locations/:id
router.put('/locations/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const existing = await req.db.query('SELECT * FROM org_locations WHERE id = $1', [id]);
    if (!existing.rows[0]) return res.status(404).json({ error: 'Location not found' });

    const b   = req.body;
    const ex  = existing.rows[0];
    const isPrimary = b.is_primary !== undefined ? cleanBool(b.is_primary) : ex.is_primary;

    // If marking as primary, demote others
    if (isPrimary && !ex.is_primary) {
      await req.db.query('UPDATE org_locations SET is_primary = FALSE WHERE is_primary = TRUE AND id != $1', [id]);
    }

    const result = await req.db.query(`
      UPDATE org_locations SET
        name          = $1, address_line1 = $2, address_line2 = $3,
        city          = $4, state         = $5, postcode      = $6,
        country       = $7, timezone      = $8, phone         = $9,
        is_primary    = $10, is_active    = $11, updated_at   = NOW()
      WHERE id = $12 RETURNING *
    `, [
      (b.name || ex.name).trim(),
      cleanStr(b.address_line1) ?? ex.address_line1,
      cleanStr(b.address_line2) ?? ex.address_line2,
      cleanStr(b.city)          ?? ex.city,
      cleanStr(b.state)         ?? ex.state,
      cleanStr(b.postcode)      ?? ex.postcode,
      cleanStr(b.country)       || ex.country,
      cleanStr(b.timezone)      || ex.timezone,
      cleanStr(b.phone)         ?? ex.phone,
      isPrimary,
      b.is_active !== undefined ? cleanBool(b.is_active) : ex.is_active,
      id,
    ]);
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/org-setup/locations/:id
router.delete('/locations/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const result = await req.db.query('DELETE FROM org_locations WHERE id = $1 RETURNING id', [id]);
    if (!result.rows[0]) return res.status(404).json({ error: 'Location not found' });
    res.json({ message: 'Location deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// LEGAL ENTITIES
// ══════════════════════════════════════════════════════════════════════════════

// GET /api/org-setup/legal-entities
router.get('/legal-entities', async (req, res) => {
  try {
    const result = await req.db.query(
      'SELECT * FROM org_legal_entities ORDER BY is_primary DESC, id ASC'
    );
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/org-setup/legal-entities
router.post('/legal-entities', async (req, res) => {
  try {
    const { legal_name, trading_name, tax_id_label, tax_id,
            vat_number, registration_number, jurisdiction, is_primary, notes } = req.body;
    if (!legal_name?.trim()) return res.status(400).json({ error: 'legal_name is required' });

    if (cleanBool(is_primary)) {
      await req.db.query('UPDATE org_legal_entities SET is_primary = FALSE WHERE is_primary = TRUE');
    }
    const result = await req.db.query(`
      INSERT INTO org_legal_entities
        (legal_name, trading_name, tax_id_label, tax_id, vat_number,
         registration_number, jurisdiction, is_primary, notes)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      RETURNING *
    `, [
      legal_name.trim(), cleanStr(trading_name),
      cleanStr(tax_id_label) || 'Tax ID', cleanStr(tax_id),
      cleanStr(vat_number),  cleanStr(registration_number),
      cleanStr(jurisdiction), cleanBool(is_primary), cleanStr(notes),
    ]);
    res.status(201).json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /api/org-setup/legal-entities/:id
router.put('/legal-entities/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const ex = (await req.db.query('SELECT * FROM org_legal_entities WHERE id = $1', [id])).rows[0];
    if (!ex) return res.status(404).json({ error: 'Legal entity not found' });

    const b = req.body;
    const isPrimary = b.is_primary !== undefined ? cleanBool(b.is_primary) : ex.is_primary;
    if (isPrimary && !ex.is_primary) {
      await req.db.query('UPDATE org_legal_entities SET is_primary = FALSE WHERE is_primary = TRUE AND id != $1', [id]);
    }
    const result = await req.db.query(`
      UPDATE org_legal_entities SET
        legal_name          = $1, trading_name        = $2,
        tax_id_label        = $3, tax_id              = $4,
        vat_number          = $5, registration_number = $6,
        jurisdiction        = $7, is_primary          = $8,
        notes               = $9, updated_at          = NOW()
      WHERE id = $10 RETURNING *
    `, [
      (b.legal_name || ex.legal_name).trim(),
      cleanStr(b.trading_name)        ?? ex.trading_name,
      cleanStr(b.tax_id_label)        || ex.tax_id_label,
      cleanStr(b.tax_id)              ?? ex.tax_id,
      cleanStr(b.vat_number)          ?? ex.vat_number,
      cleanStr(b.registration_number) ?? ex.registration_number,
      cleanStr(b.jurisdiction)        ?? ex.jurisdiction,
      isPrimary,
      cleanStr(b.notes)               ?? ex.notes,
      id,
    ]);
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /api/org-setup/legal-entities/:id
router.delete('/legal-entities/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const result = await req.db.query('DELETE FROM org_legal_entities WHERE id = $1 RETURNING id', [id]);
    if (!result.rows[0]) return res.status(404).json({ error: 'Legal entity not found' });
    res.json({ message: 'Legal entity deleted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ══════════════════════════════════════════════════════════════════════════════
// DEPARTMENTS
// ══════════════════════════════════════════════════════════════════════════════

// GET /api/org-setup/departments
router.get('/departments', async (req, res) => {
  try {
    const result = await req.db.query(`
      SELECT d.*,
             p.name AS parent_name
      FROM   org_departments d
      LEFT JOIN org_departments p ON p.id = d.parent_id
      ORDER  BY d.display_order ASC, d.id ASC
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/org-setup/departments
router.post('/departments', async (req, res) => {
  try {
    const { name, code, cost_center, description, parent_id, is_active } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'name is required' });

    const orderRes = await req.db.query('SELECT COALESCE(MAX(display_order), -1) + 1 AS next FROM org_departments');
    const display_order = parseInt(orderRes.rows[0].next);

    // Prevent circular parent reference (basic check)
    if (parent_id) {
      const parentCheck = await req.db.query('SELECT id FROM org_departments WHERE id = $1', [parseInt(parent_id)]);
      if (!parentCheck.rows[0]) return res.status(400).json({ error: 'Parent department not found' });
    }

    const result = await req.db.query(`
      INSERT INTO org_departments (name, code, cost_center, description, parent_id, is_active, display_order)
      VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *
    `, [
      name.trim(),
      cleanStr(code)        || null,
      cleanStr(cost_center) || null,
      cleanStr(description) || null,
      parent_id ? parseInt(parent_id) : null,
      is_active !== false,
      display_order,
    ]);
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/org-setup/departments/:id
router.put('/departments/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const existing = await req.db.query('SELECT * FROM org_departments WHERE id = $1', [id]);
    if (!existing.rows[0]) return res.status(404).json({ error: 'Department not found' });
    const ex = existing.rows[0];

    const b = req.body;

    // Prevent setting own parent
    const parentId = b.parent_id !== undefined ? (b.parent_id ? parseInt(b.parent_id) : null) : ex.parent_id;
    if (parentId === id) return res.status(400).json({ error: 'A department cannot be its own parent' });

    const result = await req.db.query(`
      UPDATE org_departments SET
        name        = $1, code        = $2, cost_center = $3,
        description = $4, parent_id   = $5, is_active   = $6,
        updated_at  = NOW()
      WHERE id = $7 RETURNING *
    `, [
      (b.name || ex.name).trim(),
      cleanStr(b.code)        ?? ex.code,
      cleanStr(b.cost_center) ?? ex.cost_center,
      cleanStr(b.description) ?? ex.description,
      parentId,
      b.is_active !== undefined ? cleanBool(b.is_active) : ex.is_active,
      id,
    ]);
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/org-setup/departments/:id
router.delete('/departments/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    // Detach any children before deleting
    await req.db.query('UPDATE org_departments SET parent_id = NULL WHERE parent_id = $1', [id]);
    const result = await req.db.query('DELETE FROM org_departments WHERE id = $1 RETURNING id', [id]);
    if (!result.rows[0]) return res.status(404).json({ error: 'Department not found' });
    res.json({ message: 'Department deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/org-setup/departments/reorder
router.patch('/departments/reorder', async (req, res) => {
  try {
    const { order } = req.body; // [{ id, display_order }]
    if (!Array.isArray(order)) return res.status(400).json({ error: 'order must be an array' });
    await req.db.transaction(async (tx) => {
      for (const { id, display_order } of order) {
        await tx.query('UPDATE org_departments SET display_order=$1, updated_at=NOW() WHERE id=$2', [display_order, id]);
      }
    });
    const result = await req.db.query('SELECT * FROM org_departments ORDER BY display_order ASC, id ASC');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
