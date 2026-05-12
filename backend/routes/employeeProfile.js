/**
 * Employee Profile Routes
 * Full CRUD for all 10 HR data sections per employee:
 *   contact-ext, emergency-contacts, employment-history, bank-accounts,
 *   leave-balances, assets, benefits, performance-reviews, training, licenses
 *
 * All routes are admin-only (or candidate reading their own data).
 * Base: /api/employees/:id/...
 */

const express = require('express');
const router = express.Router({ mergeParams: true });
const { authenticate, requireAdmin, injectTenantDb } = require('../middleware/auth');

router.use(authenticate, injectTenantDb);

// ─── Async error wrapper (Express 4 doesn't catch async throws automatically) ─
const wrap = fn => async (req, res, next) => {
  try { await fn(req, res, next); }
  catch (err) {
    console.error(`[EmployeeProfile] ${req.method} ${req.path}:`, err.message);
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
};


// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Resolve candidate — admins can access any, candidates can only access their own */
async function resolveCandidate(req, res) {
  try {
    const db = req.db;
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) { res.status(400).json({ error: 'Invalid employee id' }); return null; }

    const candResult = await db.query('SELECT * FROM employees WHERE id = $1 AND deleted_at IS NULL', [id]);
    const cand = candResult.rows[0];
    if (!cand) { res.status(404).json({ error: 'Employee not found' }); return null; }

    // Candidates can only see their own profile
    if (req.user.role === 'candidate') {
      const selfResult = await db.query('SELECT * FROM employees WHERE user_id = $1', [req.user.id]);
      const self = selfResult.rows[0];
      if (!self || self.id !== id) { res.status(403).json({ error: 'Forbidden' }); return null; }
    }

    return cand;
  } catch (err) {
    console.error('[resolveCandidate]', err.message);
    if (!res.headersSent) res.status(500).json({ error: 'Internal server error' });
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 1. CONTACT (extended)
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/:id/contact', wrap(async (req, res) => {
  const db = req.db;
  const cand = await resolveCandidate(req, res);
  if (!cand) return;

  const extResult = await db.query('SELECT * FROM employee_contact_ext WHERE candidate_id = $1', [cand.id]);
  const ext = extResult.rows[0] || {};
  res.json({
    // core fields
    name: cand.name,
    email: cand.email,
    phone: cand.phone,
    // extended
    alt_phone:      ext.alt_phone      || '',
    personal_email: ext.personal_email || '',
    home_street:    ext.home_street    || '',
    home_city:      ext.home_city      || '',
    home_state:     ext.home_state     || '',
    home_postcode:  ext.home_postcode  || '',
    home_country:   ext.home_country   || '',
    // identity (masked — only last4 stored; full SSN is never returned)
    ssn_last4:      cand.ssn_last4     || null,
    date_of_birth:  cand.date_of_birth || null,
  });
  }));

router.put('/:id/contact', requireAdmin, wrap(async (req, res) => {
  const db = req.db;
  const cand = await resolveCandidate(req, res);
  if (!cand) return;

  const { name, phone, alt_phone, personal_email, home_street, home_city, home_state, home_postcode, home_country } = req.body;

  // Update core candidate fields
  if (name || phone !== undefined) {
    await db.query('UPDATE employees SET name = COALESCE($1, name), phone = COALESCE($2, phone) WHERE id = $3',
      [name || null, phone !== undefined ? phone : null, cand.id]);
  }

  // Upsert extended contact
  const existingResult = await db.query('SELECT id FROM employee_contact_ext WHERE candidate_id = $1', [cand.id]);
  const existing = existingResult.rows[0];
  if (existing) {
    await db.query(`
      UPDATE employee_contact_ext SET
        alt_phone = $1, personal_email = $2,
        home_street = $3, home_city = $4, home_state = $5, home_postcode = $6, home_country = $7,
        updated_at = NOW()
      WHERE candidate_id = $8
    `, [alt_phone || null, personal_email || null, home_street || null, home_city || null, home_state || null, home_postcode || null, home_country || null, cand.id]);
  } else {
    await db.query(`
      INSERT INTO employee_contact_ext (candidate_id, alt_phone, personal_email, home_street, home_city, home_state, home_postcode, home_country)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `, [cand.id, alt_phone || null, personal_email || null, home_street || null, home_city || null, home_state || null, home_postcode || null, home_country || null]);
  }

  res.json({ message: 'Contact information updated' });
  }));

// ═══════════════════════════════════════════════════════════════════════════════
// 2. EMERGENCY CONTACTS
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/:id/emergency-contacts', wrap(async (req, res) => {
  const db = req.db;
  const cand = await resolveCandidate(req, res);
  if (!cand) return;
  const result = await db.query('SELECT * FROM emergency_contacts WHERE candidate_id = $1 ORDER BY id', [cand.id]);
  res.json(result.rows);
  }));

router.post('/:id/emergency-contacts', requireAdmin, wrap(async (req, res) => {
  const db = req.db;
  const cand = await resolveCandidate(req, res);
  if (!cand) return;

  const { name, relationship, phone1, phone2 } = req.body;
  if (!name || !phone1) return res.status(400).json({ error: 'name and phone1 are required' });

  const result = await db.query(
    'INSERT INTO emergency_contacts (candidate_id, name, relationship, phone1, phone2) VALUES ($1, $2, $3, $4, $5) RETURNING id',
    [cand.id, name, relationship || null, phone1, phone2 || null]
  );

  res.status(201).json({ id: result.rows[0].id, message: 'Emergency contact added' });
  }));

router.put('/:id/emergency-contacts/:ecId', requireAdmin, wrap(async (req, res) => {
  const db = req.db;
  const cand = await resolveCandidate(req, res);
  if (!cand) return;

  const ecId = parseInt(req.params.ecId, 10);
  const ecResult = await db.query('SELECT * FROM emergency_contacts WHERE id = $1 AND candidate_id = $2', [ecId, cand.id]);
  const ec = ecResult.rows[0];
  if (!ec) return res.status(404).json({ error: 'Emergency contact not found' });

  const { name, relationship, phone1, phone2 } = req.body;
  await db.query(`
    UPDATE emergency_contacts SET
      name = COALESCE($1, name), relationship = COALESCE($2, relationship),
      phone1 = COALESCE($3, phone1), phone2 = COALESCE($4, phone2),
      updated_at = NOW()
    WHERE id = $5
  `, [name || null, relationship || null, phone1 || null, phone2 || null, ecId]);

  res.json({ message: 'Emergency contact updated' });
  }));

router.delete('/:id/emergency-contacts/:ecId', requireAdmin, wrap(async (req, res) => {
  const db = req.db;
  const cand = await resolveCandidate(req, res);
  if (!cand) return;

  const ecId = parseInt(req.params.ecId, 10);
  const result = await db.query('DELETE FROM emergency_contacts WHERE id = $1 AND candidate_id = $2', [ecId, cand.id]);
  if (result.rowCount === 0) return res.status(404).json({ error: 'Emergency contact not found' });
  res.json({ message: 'Emergency contact deleted' });
  }));

// ═══════════════════════════════════════════════════════════════════════════════
// 3. EMPLOYMENT HISTORY
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/:id/employment-history', wrap(async (req, res) => {
  const db = req.db;
  const cand = await resolveCandidate(req, res);
  if (!cand) return;
  const result = await db.query('SELECT * FROM employment_history WHERE candidate_id = $1 ORDER BY start_date DESC', [cand.id]);
  res.json(result.rows);
  }));

router.post('/:id/employment-history', requireAdmin, wrap(async (req, res) => {
  const db = req.db;
  const cand = await resolveCandidate(req, res);
  if (!cand) return;

  const { position_title, start_date, end_date, remuneration, currency, frequency, notes } = req.body;
  if (!position_title || !start_date) return res.status(400).json({ error: 'position_title and start_date are required' });

  const result = await db.query(`
    INSERT INTO employment_history (candidate_id, position_title, start_date, end_date, remuneration, currency, frequency, notes)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    RETURNING id
  `, [cand.id, position_title, start_date, end_date || null, remuneration || null, currency || 'USD', frequency || 'annual', notes || null]);

  res.status(201).json({ id: result.rows[0].id, message: 'Employment record added' });
  }));

router.put('/:id/employment-history/:ehId', requireAdmin, wrap(async (req, res) => {
  const db = req.db;
  const cand = await resolveCandidate(req, res);
  if (!cand) return;

  const ehId = parseInt(req.params.ehId, 10);
  const rowResult = await db.query('SELECT id FROM employment_history WHERE id = $1 AND candidate_id = $2', [ehId, cand.id]);
  const row = rowResult.rows[0];
  if (!row) return res.status(404).json({ error: 'Employment record not found' });

  const { position_title, start_date, end_date, remuneration, currency, frequency, notes } = req.body;
  await db.query(`
    UPDATE employment_history SET
      position_title = COALESCE($1, position_title), start_date = COALESCE($2, start_date),
      end_date = $3, remuneration = $4, currency = COALESCE($5, currency),
      frequency = COALESCE($6, frequency), notes = $7,
      updated_at = NOW()
    WHERE id = $8
  `, [position_title || null, start_date || null, end_date || null, remuneration || null, currency || null, frequency || null, notes || null, ehId]);

  res.json({ message: 'Employment record updated' });
  }));

router.delete('/:id/employment-history/:ehId', requireAdmin, wrap(async (req, res) => {
  const db = req.db;
  const cand = await resolveCandidate(req, res);
  if (!cand) return;

  const ehId = parseInt(req.params.ehId, 10);
  const result = await db.query('DELETE FROM employment_history WHERE id = $1 AND candidate_id = $2', [ehId, cand.id]);
  if (result.rowCount === 0) return res.status(404).json({ error: 'Employment record not found' });
  res.json({ message: 'Employment record deleted' });
  }));

// ═══════════════════════════════════════════════════════════════════════════════
// 4. BANK ACCOUNTS
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/:id/bank-accounts', requireAdmin, wrap(async (req, res) => {
  const db = req.db;
  const cand = await resolveCandidate(req, res);
  if (!cand) return;

  const result = await db.query('SELECT * FROM bank_accounts WHERE candidate_id = $1 ORDER BY is_primary DESC, id', [cand.id]);
  const accounts = result.rows;
  // Mask account number: show only last 4 digits
  const masked = accounts.map(a => ({
    ...a,
    account_number: a.account_number ? '••••' + a.account_number.slice(-4) : '',
    _has_routing: !!a.routing_number,
    _has_swift: !!a.swift_code,
  }));
  res.json(masked);
  }));

router.post('/:id/bank-accounts', requireAdmin, wrap(async (req, res) => {
  const db = req.db;
  const cand = await resolveCandidate(req, res);
  if (!cand) return;

  const { account_name, bank_name, account_number, routing_number, swift_code, country, is_primary } = req.body;
  if (!account_name || !bank_name || !account_number) {
    return res.status(400).json({ error: 'account_name, bank_name, and account_number are required' });
  }

  // If setting as primary, clear other primaries
  if (is_primary) {
    await db.query('UPDATE bank_accounts SET is_primary = false WHERE candidate_id = $1', [cand.id]);
  }

  const result = await db.query(`
    INSERT INTO bank_accounts (candidate_id, account_name, bank_name, account_number, routing_number, swift_code, country, is_primary)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    RETURNING id
  `, [cand.id, account_name, bank_name, account_number, routing_number || null, swift_code || null, country || 'US', is_primary ? true : false]);

  res.status(201).json({ id: result.rows[0].id, message: 'Bank account added' });
  }));

router.put('/:id/bank-accounts/:baId', requireAdmin, wrap(async (req, res) => {
  const db = req.db;
  const cand = await resolveCandidate(req, res);
  if (!cand) return;

  const baId = parseInt(req.params.baId, 10);
  const rowResult = await db.query('SELECT id FROM bank_accounts WHERE id = $1 AND candidate_id = $2', [baId, cand.id]);
  const row = rowResult.rows[0];
  if (!row) return res.status(404).json({ error: 'Bank account not found' });

  const { account_name, bank_name, account_number, routing_number, swift_code, country, is_primary } = req.body;

  if (is_primary) {
    await db.query('UPDATE bank_accounts SET is_primary = false WHERE candidate_id = $1', [cand.id]);
  }

  await db.query(`
    UPDATE bank_accounts SET
      account_name = COALESCE($1, account_name), bank_name = COALESCE($2, bank_name),
      account_number = COALESCE($3, account_number), routing_number = $4,
      swift_code = $5, country = COALESCE($6, country), is_primary = COALESCE($7, is_primary),
      updated_at = NOW()
    WHERE id = $8
  `, [account_name || null, bank_name || null, account_number || null, routing_number || null, swift_code || null, country || null, is_primary !== undefined ? (is_primary ? true : false) : null, baId]);

  res.json({ message: 'Bank account updated' });
  }));

router.delete('/:id/bank-accounts/:baId', requireAdmin, wrap(async (req, res) => {
  const db = req.db;
  const cand = await resolveCandidate(req, res);
  if (!cand) return;

  const baId = parseInt(req.params.baId, 10);
  const result = await db.query('DELETE FROM bank_accounts WHERE id = $1 AND candidate_id = $2', [baId, cand.id]);
  if (result.rowCount === 0) return res.status(404).json({ error: 'Bank account not found' });
  res.json({ message: 'Bank account deleted' });
  }));

// ═══════════════════════════════════════════════════════════════════════════════
// 5. LEAVE BALANCES
// ═══════════════════════════════════════════════════════════════════════════════

const LEAVE_TYPES = ['vacation', 'sick', 'personal', 'public_holiday', 'other'];

router.get('/:id/leave-balances', wrap(async (req, res) => {
  const db = req.db;
  const cand = await resolveCandidate(req, res);
  if (!cand) return;

  const year = parseInt(req.query.year, 10) || new Date().getFullYear();
  const rowsResult = await db.query('SELECT * FROM leave_balances WHERE candidate_id = $1 AND year = $2', [cand.id, year]);
  const rows = rowsResult.rows;

  // Also pull absence records for usage cross-reference
  const absencesResult = await db.query(
    "SELECT type, start_date, end_date, status FROM absences WHERE candidate_id = $1 AND status = 'approved' AND EXTRACT(YEAR FROM start_date::date) = $2",
    [cand.id, year]
  );
  const absences = absencesResult.rows;

  // Calculate used days from approved absences
  const usedMap = {};
  for (const ab of absences) {
    const start = new Date(ab.start_date);
    const end = new Date(ab.end_date);
    const days = Math.ceil((end - start) / 86400000) + 1;
    usedMap[ab.type] = (usedMap[ab.type] || 0) + days;
  }

  // Build response with defaults for all leave types
  const balances = LEAVE_TYPES.map(lt => {
    const stored = rows.find(r => r.leave_type === lt);
    return {
      leave_type: lt,
      year,
      entitlement_days: stored ? stored.entitlement_days : 0,
      used_days: usedMap[lt] || (stored ? stored.used_days : 0),
      carry_over_days: stored ? stored.carry_over_days : 0,
      available_days: (stored ? stored.entitlement_days + stored.carry_over_days : 0) - (usedMap[lt] || (stored ? stored.used_days : 0)),
    };
  });

  res.json({ year, balances });
  }));

router.put('/:id/leave-balances', requireAdmin, wrap(async (req, res) => {
  const db = req.db;
  const cand = await resolveCandidate(req, res);
  if (!cand) return;

  const { leave_type, year, entitlement_days, carry_over_days } = req.body;
  if (!leave_type || !LEAVE_TYPES.includes(leave_type)) {
    return res.status(400).json({ error: `leave_type must be one of: ${LEAVE_TYPES.join(', ')}` });
  }
  const yr = year || new Date().getFullYear();

  await db.query(`
    INSERT INTO leave_balances (candidate_id, leave_type, year, entitlement_days, carry_over_days)
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT(candidate_id, leave_type, year) DO UPDATE SET
      entitlement_days = excluded.entitlement_days,
      carry_over_days  = excluded.carry_over_days,
      updated_at       = NOW()
  `, [cand.id, leave_type, yr, entitlement_days || 0, carry_over_days || 0]);

  res.json({ message: 'Leave balance updated' });
  }));

// ═══════════════════════════════════════════════════════════════════════════════
// 6. ASSETS ON LOAN
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/:id/assets', wrap(async (req, res) => {
  const db = req.db;
  const cand = await resolveCandidate(req, res);
  if (!cand) return;
  const result = await db.query('SELECT * FROM employee_assets WHERE candidate_id = $1 ORDER BY checkout_date DESC', [cand.id]);
  res.json(result.rows);
  }));

router.post('/:id/assets', requireAdmin, wrap(async (req, res) => {
  const db = req.db;
  const cand = await resolveCandidate(req, res);
  if (!cand) return;

  const { serial_number, description, category, checkout_date, checkin_date, status, photo_url, notes } = req.body;
  if (!description || !checkout_date) return res.status(400).json({ error: 'description and checkout_date are required' });

  const result = await db.query(`
    INSERT INTO employee_assets (candidate_id, serial_number, description, category, checkout_date, checkin_date, status, photo_url, notes)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    RETURNING id
  `, [cand.id, serial_number || null, description, category || 'other', checkout_date, checkin_date || null, status || 'on_loan', photo_url || null, notes || null]);

  res.status(201).json({ id: result.rows[0].id, message: 'Asset recorded' });
  }));

router.put('/:id/assets/:asId', requireAdmin, wrap(async (req, res) => {
  const db = req.db;
  const cand = await resolveCandidate(req, res);
  if (!cand) return;

  const asId = parseInt(req.params.asId, 10);
  const rowResult = await db.query('SELECT id FROM employee_assets WHERE id = $1 AND candidate_id = $2', [asId, cand.id]);
  const row = rowResult.rows[0];
  if (!row) return res.status(404).json({ error: 'Asset not found' });

  const { serial_number, description, category, checkout_date, checkin_date, status, photo_url, notes } = req.body;
  await db.query(`
    UPDATE employee_assets SET
      serial_number = COALESCE($1, serial_number), description = COALESCE($2, description),
      category = COALESCE($3, category), checkout_date = COALESCE($4, checkout_date),
      checkin_date = $5, status = COALESCE($6, status), photo_url = $7, notes = $8,
      updated_at = NOW()
    WHERE id = $9
  `, [serial_number || null, description || null, category || null, checkout_date || null, checkin_date || null, status || null, photo_url || null, notes || null, asId]);

  res.json({ message: 'Asset updated' });
  }));

router.delete('/:id/assets/:asId', requireAdmin, wrap(async (req, res) => {
  const db = req.db;
  const cand = await resolveCandidate(req, res);
  if (!cand) return;

  const asId = parseInt(req.params.asId, 10);
  const result = await db.query('DELETE FROM employee_assets WHERE id = $1 AND candidate_id = $2', [asId, cand.id]);
  if (result.rowCount === 0) return res.status(404).json({ error: 'Asset not found' });
  res.json({ message: 'Asset deleted' });
  }));

// ═══════════════════════════════════════════════════════════════════════════════
// 7. BENEFITS
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/:id/benefits', wrap(async (req, res) => {
  const db = req.db;
  const cand = await resolveCandidate(req, res);
  if (!cand) return;
  const result = await db.query('SELECT * FROM employee_benefits WHERE candidate_id = $1 ORDER BY id', [cand.id]);
  res.json(result.rows);
  }));

router.post('/:id/benefits', requireAdmin, wrap(async (req, res) => {
  const db = req.db;
  const cand = await resolveCandidate(req, res);
  if (!cand) return;

  const { benefit_type, provider, value, currency, access_details, notes, effective_date, end_date } = req.body;
  if (!benefit_type) return res.status(400).json({ error: 'benefit_type is required' });

  const result = await db.query(`
    INSERT INTO employee_benefits (candidate_id, benefit_type, provider, value, currency, access_details, notes, effective_date, end_date)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    RETURNING id
  `, [cand.id, benefit_type, provider || null, value || null, currency || 'USD', access_details || null, notes || null, effective_date || null, end_date || null]);

  res.status(201).json({ id: result.rows[0].id, message: 'Benefit added' });
  }));

router.put('/:id/benefits/:bId', requireAdmin, wrap(async (req, res) => {
  const db = req.db;
  const cand = await resolveCandidate(req, res);
  if (!cand) return;

  const bId = parseInt(req.params.bId, 10);
  const rowResult = await db.query('SELECT id FROM employee_benefits WHERE id = $1 AND candidate_id = $2', [bId, cand.id]);
  const row = rowResult.rows[0];
  if (!row) return res.status(404).json({ error: 'Benefit not found' });

  const { benefit_type, provider, value, currency, access_details, notes, effective_date, end_date } = req.body;
  await db.query(`
    UPDATE employee_benefits SET
      benefit_type = COALESCE($1, benefit_type), provider = $2,
      value = $3, currency = COALESCE($4, currency), access_details = $5, notes = $6,
      effective_date = $7, end_date = $8, updated_at = NOW()
    WHERE id = $9
  `, [benefit_type || null, provider || null, value || null, currency || null, access_details || null, notes || null, effective_date || null, end_date || null, bId]);

  res.json({ message: 'Benefit updated' });
  }));

router.delete('/:id/benefits/:bId', requireAdmin, wrap(async (req, res) => {
  const db = req.db;
  const cand = await resolveCandidate(req, res);
  if (!cand) return;

  const bId = parseInt(req.params.bId, 10);
  const result = await db.query('DELETE FROM employee_benefits WHERE id = $1 AND candidate_id = $2', [bId, cand.id]);
  if (result.rowCount === 0) return res.status(404).json({ error: 'Benefit not found' });
  res.json({ message: 'Benefit deleted' });
  }));

// ═══════════════════════════════════════════════════════════════════════════════
// 8. PERFORMANCE REVIEWS
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/:id/performance-reviews', wrap(async (req, res) => {
  const db = req.db;
  const cand = await resolveCandidate(req, res);
  if (!cand) return;
  const result = await db.query('SELECT * FROM performance_reviews WHERE candidate_id = $1 ORDER BY review_date DESC', [cand.id]);
  res.json(result.rows);
  }));

router.post('/:id/performance-reviews', requireAdmin, wrap(async (req, res) => {
  const db = req.db;
  const cand = await resolveCandidate(req, res);
  if (!cand) return;

  const { review_date, reviewer_name, overall_score, evaluation, next_steps } = req.body;
  if (!review_date) return res.status(400).json({ error: 'review_date is required' });
  if (overall_score && (overall_score < 1 || overall_score > 5)) {
    return res.status(400).json({ error: 'overall_score must be between 1 and 5' });
  }

  const result = await db.query(`
    INSERT INTO performance_reviews (candidate_id, review_date, reviewer_id, reviewer_name, overall_score, evaluation, next_steps)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    RETURNING id
  `, [cand.id, review_date, req.user.id, reviewer_name || req.user.name || req.user.email, overall_score || null, evaluation || null, next_steps || null]);

  res.status(201).json({ id: result.rows[0].id, message: 'Performance review added' });
  }));

router.put('/:id/performance-reviews/:prId', requireAdmin, wrap(async (req, res) => {
  const db = req.db;
  const cand = await resolveCandidate(req, res);
  if (!cand) return;

  const prId = parseInt(req.params.prId, 10);
  const rowResult = await db.query('SELECT id FROM performance_reviews WHERE id = $1 AND candidate_id = $2', [prId, cand.id]);
  const row = rowResult.rows[0];
  if (!row) return res.status(404).json({ error: 'Review not found' });

  const { review_date, reviewer_name, overall_score, evaluation, next_steps } = req.body;
  if (overall_score && (overall_score < 1 || overall_score > 5)) {
    return res.status(400).json({ error: 'overall_score must be between 1 and 5' });
  }

  await db.query(`
    UPDATE performance_reviews SET
      review_date = COALESCE($1, review_date), reviewer_name = COALESCE($2, reviewer_name),
      overall_score = $3, evaluation = $4, next_steps = $5,
      updated_at = NOW()
    WHERE id = $6
  `, [review_date || null, reviewer_name || null, overall_score || null, evaluation || null, next_steps || null, prId]);

  res.json({ message: 'Review updated' });
  }));

router.delete('/:id/performance-reviews/:prId', requireAdmin, wrap(async (req, res) => {
  const db = req.db;
  const cand = await resolveCandidate(req, res);
  if (!cand) return;

  const prId = parseInt(req.params.prId, 10);
  const result = await db.query('DELETE FROM performance_reviews WHERE id = $1 AND candidate_id = $2', [prId, cand.id]);
  if (result.rowCount === 0) return res.status(404).json({ error: 'Review not found' });
  res.json({ message: 'Review deleted' });
  }));

// ═══════════════════════════════════════════════════════════════════════════════
// 9. TRAINING RECORDS
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/:id/training', wrap(async (req, res) => {
  const db = req.db;
  const cand = await resolveCandidate(req, res);
  if (!cand) return;
  const result = await db.query('SELECT * FROM training_records WHERE candidate_id = $1 ORDER BY training_date DESC', [cand.id]);
  res.json(result.rows);
  }));

router.post('/:id/training', requireAdmin, wrap(async (req, res) => {
  const db = req.db;
  const cand = await resolveCandidate(req, res);
  if (!cand) return;

  const { training_date, name, content, results, certificate_url } = req.body;
  if (!training_date || !name) return res.status(400).json({ error: 'training_date and name are required' });

  const result = await db.query(`
    INSERT INTO training_records (candidate_id, training_date, name, content, results, certificate_url)
    VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING id
  `, [cand.id, training_date, name, content || null, results || null, certificate_url || null]);

  res.status(201).json({ id: result.rows[0].id, message: 'Training record added' });
  }));

router.put('/:id/training/:trId', requireAdmin, wrap(async (req, res) => {
  const db = req.db;
  const cand = await resolveCandidate(req, res);
  if (!cand) return;

  const trId = parseInt(req.params.trId, 10);
  const rowResult = await db.query('SELECT id FROM training_records WHERE id = $1 AND candidate_id = $2', [trId, cand.id]);
  const row = rowResult.rows[0];
  if (!row) return res.status(404).json({ error: 'Training record not found' });

  const { training_date, name, content, results, certificate_url } = req.body;
  await db.query(`
    UPDATE training_records SET
      training_date = COALESCE($1, training_date), name = COALESCE($2, name),
      content = $3, results = $4, certificate_url = $5,
      updated_at = NOW()
    WHERE id = $6
  `, [training_date || null, name || null, content || null, results || null, certificate_url || null, trId]);

  res.json({ message: 'Training record updated' });
  }));

router.delete('/:id/training/:trId', requireAdmin, wrap(async (req, res) => {
  const db = req.db;
  const cand = await resolveCandidate(req, res);
  if (!cand) return;

  const trId = parseInt(req.params.trId, 10);
  const result = await db.query('DELETE FROM training_records WHERE id = $1 AND candidate_id = $2', [trId, cand.id]);
  if (result.rowCount === 0) return res.status(404).json({ error: 'Training record not found' });
  res.json({ message: 'Training record deleted' });
  }));

// ═══════════════════════════════════════════════════════════════════════════════
// 10. LICENCES, PERMITS & INSURANCE
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/:id/licenses', wrap(async (req, res) => {
  const db = req.db;
  const cand = await resolveCandidate(req, res);
  if (!cand) return;

  const today = new Date().toISOString().split('T')[0];
  const result = await db.query('SELECT * FROM employee_licenses WHERE candidate_id = $1 ORDER BY expiry_date ASC', [cand.id]);
  const licenses = result.rows;

  // Enrich with urgency flags
  const enriched = licenses.map(lic => {
    let urgency = 'ok';
    if (lic.expiry_date) {
      const daysUntil = Math.ceil((new Date(lic.expiry_date) - new Date(today)) / 86400000);
      if (daysUntil < 0) urgency = 'expired';
      else if (daysUntil <= lic.reminder_days_before) urgency = 'expiring_soon';
    }
    return { ...lic, urgency };
  });

  res.json(enriched);
  }));

router.post('/:id/licenses', requireAdmin, wrap(async (req, res) => {
  const db = req.db;
  const cand = await resolveCandidate(req, res);
  if (!cand) return;

  const { document_type, document_url, issue_date, expiry_date, reminder_days_before, notes } = req.body;
  if (!document_type) return res.status(400).json({ error: 'document_type is required' });

  // Auto-determine status
  const today = new Date().toISOString().split('T')[0];
  let status = 'valid';
  if (expiry_date && expiry_date < today) status = 'expired';

  const result = await db.query(`
    INSERT INTO employee_licenses (candidate_id, document_type, document_url, issue_date, expiry_date, reminder_days_before, status, notes)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    RETURNING id
  `, [cand.id, document_type, document_url || null, issue_date || null, expiry_date || null, reminder_days_before || 30, status, notes || null]);

  res.status(201).json({ id: result.rows[0].id, message: 'License record added' });
  }));

router.put('/:id/licenses/:licId', requireAdmin, wrap(async (req, res) => {
  const db = req.db;
  const cand = await resolveCandidate(req, res);
  if (!cand) return;

  const licId = parseInt(req.params.licId, 10);
  const rowResult = await db.query('SELECT id FROM employee_licenses WHERE id = $1 AND candidate_id = $2', [licId, cand.id]);
  const row = rowResult.rows[0];
  if (!row) return res.status(404).json({ error: 'License not found' });

  const { document_type, document_url, issue_date, expiry_date, reminder_days_before, status, notes } = req.body;

  const today = new Date().toISOString().split('T')[0];
  let computedStatus = status;
  if (!computedStatus && expiry_date) {
    computedStatus = expiry_date < today ? 'expired' : 'valid';
  }

  await db.query(`
    UPDATE employee_licenses SET
      document_type = COALESCE($1, document_type), document_url = $2,
      issue_date = $3, expiry_date = $4,
      reminder_days_before = COALESCE($5, reminder_days_before),
      status = COALESCE($6, status), notes = $7,
      updated_at = NOW()
    WHERE id = $8
  `, [document_type || null, document_url || null, issue_date || null, expiry_date || null, reminder_days_before || null, computedStatus || null, notes || null, licId]);

  res.json({ message: 'License updated' });
  }));

router.delete('/:id/licenses/:licId', requireAdmin, wrap(async (req, res) => {
  const db = req.db;
  const cand = await resolveCandidate(req, res);
  if (!cand) return;

  const licId = parseInt(req.params.licId, 10);
  const result = await db.query('DELETE FROM employee_licenses WHERE id = $1 AND candidate_id = $2', [licId, cand.id]);
  if (result.rowCount === 0) return res.status(404).json({ error: 'License not found' });
  res.json({ message: 'License deleted' });
  }));

// ═══════════════════════════════════════════════════════════════════════════════
// SUMMARY — quick overview for profile header
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/:id/summary', wrap(async (req, res) => {
  const db = req.db;
  const cand = await resolveCandidate(req, res);
  if (!cand) return;

  const today = new Date().toISOString().split('T')[0];

  const emergencyCountResult = await db.query('SELECT COUNT(*) AS n FROM emergency_contacts WHERE candidate_id = $1', [cand.id]);
  const emergencyCount = parseInt(emergencyCountResult.rows[0].n, 10);

  const assetCountResult = await db.query("SELECT COUNT(*) AS n FROM employee_assets WHERE candidate_id = $1 AND status = 'on_loan'", [cand.id]);
  const assetCount = parseInt(assetCountResult.rows[0].n, 10);

  const benefitCountResult = await db.query('SELECT COUNT(*) AS n FROM employee_benefits WHERE candidate_id = $1', [cand.id]);
  const benefitCount = parseInt(benefitCountResult.rows[0].n, 10);

  const reviewCountResult = await db.query('SELECT COUNT(*) AS n FROM performance_reviews WHERE candidate_id = $1', [cand.id]);
  const reviewCount = parseInt(reviewCountResult.rows[0].n, 10);

  const trainingCountResult = await db.query('SELECT COUNT(*) AS n FROM training_records WHERE candidate_id = $1', [cand.id]);
  const trainingCount = parseInt(trainingCountResult.rows[0].n, 10);

  const expiringLicensesResult = await db.query(
    "SELECT COUNT(*) AS n FROM employee_licenses WHERE candidate_id = $1 AND expiry_date IS NOT NULL AND expiry_date <= (CURRENT_DATE + (reminder_days_before || ' days')::interval)",
    [cand.id]
  );
  const expiringLicenses = parseInt(expiringLicensesResult.rows[0].n, 10);

  const expiredLicensesResult = await db.query(
    "SELECT COUNT(*) AS n FROM employee_licenses WHERE candidate_id = $1 AND expiry_date < CURRENT_DATE",
    [cand.id]
  );
  const expiredLicenses = parseInt(expiredLicensesResult.rows[0].n, 10);

  const latestHistoryResult = await db.query('SELECT * FROM employment_history WHERE candidate_id = $1 ORDER BY start_date DESC LIMIT 1', [cand.id]);
  const latestHistory = latestHistoryResult.rows[0];

  const hasBankAccountResult = await db.query('SELECT id FROM bank_accounts WHERE candidate_id = $1 LIMIT 1', [cand.id]);
  const hasBankAccount = !!hasBankAccountResult.rows[0];

  res.json({
    has_emergency_contact: emergencyCount > 0,
    emergency_contact_count: emergencyCount,
    assets_on_loan: assetCount,
    benefit_count: benefitCount,
    review_count: reviewCount,
    training_count: trainingCount,
    expiring_licenses: expiringLicenses,
    expired_licenses: expiredLicenses,
    latest_position: latestHistory ? latestHistory.position_title : null,
    has_bank_account: hasBankAccount,
    warnings: [
      ...(emergencyCount === 0 ? ['No emergency contact on file'] : []),
      ...(expiredLicenses > 0  ? [`${expiredLicenses} expired licence(s)`] : []),
      ...(expiringLicenses > 0 ? [`${expiringLicenses} licence(s) expiring soon`] : []),
    ],
  });
  }));

// ═══════════════════════════════════════════════════════════════════════════════
// HISTORY — audit trail for all profile section changes
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/:id/history', wrap(async (req, res) => {
  const db = req.db;
  const cand = await resolveCandidate(req, res);
  if (!cand) return;

  const limit  = Math.min(parseInt(req.query.limit, 10)  || 100, 500);
  const offset = parseInt(req.query.offset, 10) || 0;
  const table  = req.query.table || null; // optional filter by section

  const params = [cand.id, limit, offset];
  const tableFilter = table ? `AND al.table_name = $4` : '';
  if (table) params.push(table);

  // Query audit_logs; fall back gracefully if the column names differ
  const result = await db.query(`
    SELECT
      al.id,
      al.table_name,
      al.action,
      al.record_id,
      al.changed_by,
      al.changed_at,
      al.old_data,
      al.new_data,
      u.name  AS changed_by_name,
      u.email AS changed_by_email
    FROM audit_logs al
    LEFT JOIN users u ON u.id = al.changed_by
    WHERE al.row_id::text = $1::text
      ${tableFilter}
    ORDER BY al.changed_at DESC
    LIMIT $2 OFFSET $3
  `, params).catch(() =>
    // If audit_logs doesn't have row_id col, try record_id fallback
    db.query(`
      SELECT
        al.id,
        al.table_name,
        al.action,
        al.record_id,
        al.changed_by,
        al.changed_at,
        al.old_data,
        al.new_data,
        u.name  AS changed_by_name,
        u.email AS changed_by_email
      FROM audit_logs al
      LEFT JOIN users u ON u.id = al.changed_by
      WHERE al.record_id::text = $1::text
        ${tableFilter}
      ORDER BY al.changed_at DESC
      LIMIT $2 OFFSET $3
    `, params)
  );

  res.json(result.rows);
}));

module.exports = router;
