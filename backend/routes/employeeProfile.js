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

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Resolve candidate — admins can access any, candidates can only access their own */
function resolveCandidate(req, res) {
  const db = req.db;
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: 'Invalid employee id' }); return null; }

  const cand = db.prepare('SELECT * FROM candidates WHERE id = ? AND deleted_at IS NULL').get(id);
  if (!cand) { res.status(404).json({ error: 'Employee not found' }); return null; }

  // Candidates can only see their own profile
  if (req.user.role === 'candidate') {
    const self = db.prepare('SELECT * FROM candidates WHERE user_id = ?').get(req.user.id);
    if (!self || self.id !== id) { res.status(403).json({ error: 'Forbidden' }); return null; }
  }

  return cand;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 1. CONTACT (extended)
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/:id/contact', (req, res) => {
  const db = req.db;
  const cand = resolveCandidate(req, res);
  if (!cand) return;

  const ext = db.prepare('SELECT * FROM employee_contact_ext WHERE candidate_id = ?').get(cand.id) || {};
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
  });
});

router.put('/:id/contact', requireAdmin, (req, res) => {
  const db = req.db;
  const cand = resolveCandidate(req, res);
  if (!cand) return;

  const { name, phone, alt_phone, personal_email, home_street, home_city, home_state, home_postcode, home_country } = req.body;

  // Update core candidate fields
  if (name || phone !== undefined) {
    db.prepare('UPDATE candidates SET name = COALESCE(?, name), phone = COALESCE(?, phone) WHERE id = ?')
      .run(name || null, phone !== undefined ? phone : null, cand.id);
  }

  // Upsert extended contact
  const existing = db.prepare('SELECT id FROM employee_contact_ext WHERE candidate_id = ?').get(cand.id);
  if (existing) {
    db.prepare(`
      UPDATE employee_contact_ext SET
        alt_phone = ?, personal_email = ?,
        home_street = ?, home_city = ?, home_state = ?, home_postcode = ?, home_country = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE candidate_id = ?
    `).run(alt_phone || null, personal_email || null, home_street || null, home_city || null, home_state || null, home_postcode || null, home_country || null, cand.id);
  } else {
    db.prepare(`
      INSERT INTO employee_contact_ext (candidate_id, alt_phone, personal_email, home_street, home_city, home_state, home_postcode, home_country)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(cand.id, alt_phone || null, personal_email || null, home_street || null, home_city || null, home_state || null, home_postcode || null, home_country || null);
  }

  res.json({ message: 'Contact information updated' });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. EMERGENCY CONTACTS
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/:id/emergency-contacts', (req, res) => {
  const db = req.db;
  const cand = resolveCandidate(req, res);
  if (!cand) return;
  res.json(db.prepare('SELECT * FROM emergency_contacts WHERE candidate_id = ? ORDER BY id').all(cand.id));
});

router.post('/:id/emergency-contacts', requireAdmin, (req, res) => {
  const db = req.db;
  const cand = resolveCandidate(req, res);
  if (!cand) return;

  const { name, relationship, phone1, phone2 } = req.body;
  if (!name || !phone1) return res.status(400).json({ error: 'name and phone1 are required' });

  const result = db.prepare(
    'INSERT INTO emergency_contacts (candidate_id, name, relationship, phone1, phone2) VALUES (?, ?, ?, ?, ?)'
  ).run(cand.id, name, relationship || null, phone1, phone2 || null);

  res.status(201).json({ id: result.lastInsertRowid, message: 'Emergency contact added' });
});

router.put('/:id/emergency-contacts/:ecId', requireAdmin, (req, res) => {
  const db = req.db;
  const cand = resolveCandidate(req, res);
  if (!cand) return;

  const ecId = parseInt(req.params.ecId, 10);
  const ec = db.prepare('SELECT * FROM emergency_contacts WHERE id = ? AND candidate_id = ?').get(ecId, cand.id);
  if (!ec) return res.status(404).json({ error: 'Emergency contact not found' });

  const { name, relationship, phone1, phone2 } = req.body;
  db.prepare(`
    UPDATE emergency_contacts SET
      name = COALESCE(?, name), relationship = COALESCE(?, relationship),
      phone1 = COALESCE(?, phone1), phone2 = COALESCE(?, phone2),
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(name || null, relationship || null, phone1 || null, phone2 || null, ecId);

  res.json({ message: 'Emergency contact updated' });
});

router.delete('/:id/emergency-contacts/:ecId', requireAdmin, (req, res) => {
  const db = req.db;
  const cand = resolveCandidate(req, res);
  if (!cand) return;

  const ecId = parseInt(req.params.ecId, 10);
  const result = db.prepare('DELETE FROM emergency_contacts WHERE id = ? AND candidate_id = ?').run(ecId, cand.id);
  if (!result.changes) return res.status(404).json({ error: 'Emergency contact not found' });
  res.json({ message: 'Emergency contact deleted' });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. EMPLOYMENT HISTORY
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/:id/employment-history', (req, res) => {
  const db = req.db;
  const cand = resolveCandidate(req, res);
  if (!cand) return;
  res.json(db.prepare('SELECT * FROM employment_history WHERE candidate_id = ? ORDER BY start_date DESC').all(cand.id));
});

router.post('/:id/employment-history', requireAdmin, (req, res) => {
  const db = req.db;
  const cand = resolveCandidate(req, res);
  if (!cand) return;

  const { position_title, start_date, end_date, remuneration, currency, frequency, notes } = req.body;
  if (!position_title || !start_date) return res.status(400).json({ error: 'position_title and start_date are required' });

  const result = db.prepare(`
    INSERT INTO employment_history (candidate_id, position_title, start_date, end_date, remuneration, currency, frequency, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(cand.id, position_title, start_date, end_date || null, remuneration || null, currency || 'USD', frequency || 'annual', notes || null);

  res.status(201).json({ id: result.lastInsertRowid, message: 'Employment record added' });
});

router.put('/:id/employment-history/:ehId', requireAdmin, (req, res) => {
  const db = req.db;
  const cand = resolveCandidate(req, res);
  if (!cand) return;

  const ehId = parseInt(req.params.ehId, 10);
  const row = db.prepare('SELECT id FROM employment_history WHERE id = ? AND candidate_id = ?').get(ehId, cand.id);
  if (!row) return res.status(404).json({ error: 'Employment record not found' });

  const { position_title, start_date, end_date, remuneration, currency, frequency, notes } = req.body;
  db.prepare(`
    UPDATE employment_history SET
      position_title = COALESCE(?, position_title), start_date = COALESCE(?, start_date),
      end_date = ?, remuneration = ?, currency = COALESCE(?, currency),
      frequency = COALESCE(?, frequency), notes = ?,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(position_title || null, start_date || null, end_date || null, remuneration || null, currency || null, frequency || null, notes || null, ehId);

  res.json({ message: 'Employment record updated' });
});

router.delete('/:id/employment-history/:ehId', requireAdmin, (req, res) => {
  const db = req.db;
  const cand = resolveCandidate(req, res);
  if (!cand) return;

  const ehId = parseInt(req.params.ehId, 10);
  const result = db.prepare('DELETE FROM employment_history WHERE id = ? AND candidate_id = ?').run(ehId, cand.id);
  if (!result.changes) return res.status(404).json({ error: 'Employment record not found' });
  res.json({ message: 'Employment record deleted' });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. BANK ACCOUNTS
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/:id/bank-accounts', requireAdmin, (req, res) => {
  const db = req.db;
  const cand = resolveCandidate(req, res);
  if (!cand) return;

  const accounts = db.prepare('SELECT * FROM bank_accounts WHERE candidate_id = ? ORDER BY is_primary DESC, id').all(cand.id);
  // Mask account number: show only last 4 digits
  const masked = accounts.map(a => ({
    ...a,
    account_number: a.account_number ? '••••' + a.account_number.slice(-4) : '',
    _has_routing: !!a.routing_number,
    _has_swift: !!a.swift_code,
  }));
  res.json(masked);
});

router.post('/:id/bank-accounts', requireAdmin, (req, res) => {
  const db = req.db;
  const cand = resolveCandidate(req, res);
  if (!cand) return;

  const { account_name, bank_name, account_number, routing_number, swift_code, country, is_primary } = req.body;
  if (!account_name || !bank_name || !account_number) {
    return res.status(400).json({ error: 'account_name, bank_name, and account_number are required' });
  }

  // If setting as primary, clear other primaries
  if (is_primary) {
    db.prepare('UPDATE bank_accounts SET is_primary = 0 WHERE candidate_id = ?').run(cand.id);
  }

  const result = db.prepare(`
    INSERT INTO bank_accounts (candidate_id, account_name, bank_name, account_number, routing_number, swift_code, country, is_primary)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(cand.id, account_name, bank_name, account_number, routing_number || null, swift_code || null, country || 'US', is_primary ? 1 : 0);

  res.status(201).json({ id: result.lastInsertRowid, message: 'Bank account added' });
});

router.put('/:id/bank-accounts/:baId', requireAdmin, (req, res) => {
  const db = req.db;
  const cand = resolveCandidate(req, res);
  if (!cand) return;

  const baId = parseInt(req.params.baId, 10);
  const row = db.prepare('SELECT id FROM bank_accounts WHERE id = ? AND candidate_id = ?').get(baId, cand.id);
  if (!row) return res.status(404).json({ error: 'Bank account not found' });

  const { account_name, bank_name, account_number, routing_number, swift_code, country, is_primary } = req.body;

  if (is_primary) {
    db.prepare('UPDATE bank_accounts SET is_primary = 0 WHERE candidate_id = ?').run(cand.id);
  }

  db.prepare(`
    UPDATE bank_accounts SET
      account_name = COALESCE(?, account_name), bank_name = COALESCE(?, bank_name),
      account_number = COALESCE(?, account_number), routing_number = ?,
      swift_code = ?, country = COALESCE(?, country), is_primary = COALESCE(?, is_primary),
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(account_name || null, bank_name || null, account_number || null, routing_number || null, swift_code || null, country || null, is_primary !== undefined ? (is_primary ? 1 : 0) : null, baId);

  res.json({ message: 'Bank account updated' });
});

router.delete('/:id/bank-accounts/:baId', requireAdmin, (req, res) => {
  const db = req.db;
  const cand = resolveCandidate(req, res);
  if (!cand) return;

  const baId = parseInt(req.params.baId, 10);
  const result = db.prepare('DELETE FROM bank_accounts WHERE id = ? AND candidate_id = ?').run(baId, cand.id);
  if (!result.changes) return res.status(404).json({ error: 'Bank account not found' });
  res.json({ message: 'Bank account deleted' });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. LEAVE BALANCES
// ═══════════════════════════════════════════════════════════════════════════════

const LEAVE_TYPES = ['vacation', 'sick', 'personal', 'public_holiday', 'other'];

router.get('/:id/leave-balances', (req, res) => {
  const db = req.db;
  const cand = resolveCandidate(req, res);
  if (!cand) return;

  const year = parseInt(req.query.year, 10) || new Date().getFullYear();
  const rows = db.prepare('SELECT * FROM leave_balances WHERE candidate_id = ? AND year = ?').all(cand.id, year);

  // Also pull absence records for usage cross-reference
  const absences = db.prepare(
    "SELECT type, start_date, end_date, status FROM absences WHERE candidate_id = ? AND status = 'approved' AND strftime('%Y', start_date) = ?"
  ).all(cand.id, String(year));

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
});

router.put('/:id/leave-balances', requireAdmin, (req, res) => {
  const db = req.db;
  const cand = resolveCandidate(req, res);
  if (!cand) return;

  const { leave_type, year, entitlement_days, carry_over_days } = req.body;
  if (!leave_type || !LEAVE_TYPES.includes(leave_type)) {
    return res.status(400).json({ error: `leave_type must be one of: ${LEAVE_TYPES.join(', ')}` });
  }
  const yr = year || new Date().getFullYear();

  db.prepare(`
    INSERT INTO leave_balances (candidate_id, leave_type, year, entitlement_days, carry_over_days)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(candidate_id, leave_type, year) DO UPDATE SET
      entitlement_days = excluded.entitlement_days,
      carry_over_days  = excluded.carry_over_days,
      updated_at       = CURRENT_TIMESTAMP
  `).run(cand.id, leave_type, yr, entitlement_days || 0, carry_over_days || 0);

  res.json({ message: 'Leave balance updated' });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 6. ASSETS ON LOAN
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/:id/assets', (req, res) => {
  const db = req.db;
  const cand = resolveCandidate(req, res);
  if (!cand) return;
  res.json(db.prepare('SELECT * FROM employee_assets WHERE candidate_id = ? ORDER BY checkout_date DESC').all(cand.id));
});

router.post('/:id/assets', requireAdmin, (req, res) => {
  const db = req.db;
  const cand = resolveCandidate(req, res);
  if (!cand) return;

  const { serial_number, description, category, checkout_date, checkin_date, status, photo_url, notes } = req.body;
  if (!description || !checkout_date) return res.status(400).json({ error: 'description and checkout_date are required' });

  const result = db.prepare(`
    INSERT INTO employee_assets (candidate_id, serial_number, description, category, checkout_date, checkin_date, status, photo_url, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(cand.id, serial_number || null, description, category || 'other', checkout_date, checkin_date || null, status || 'on_loan', photo_url || null, notes || null);

  res.status(201).json({ id: result.lastInsertRowid, message: 'Asset recorded' });
});

router.put('/:id/assets/:asId', requireAdmin, (req, res) => {
  const db = req.db;
  const cand = resolveCandidate(req, res);
  if (!cand) return;

  const asId = parseInt(req.params.asId, 10);
  const row = db.prepare('SELECT id FROM employee_assets WHERE id = ? AND candidate_id = ?').get(asId, cand.id);
  if (!row) return res.status(404).json({ error: 'Asset not found' });

  const { serial_number, description, category, checkout_date, checkin_date, status, photo_url, notes } = req.body;
  db.prepare(`
    UPDATE employee_assets SET
      serial_number = COALESCE(?, serial_number), description = COALESCE(?, description),
      category = COALESCE(?, category), checkout_date = COALESCE(?, checkout_date),
      checkin_date = ?, status = COALESCE(?, status), photo_url = ?, notes = ?,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(serial_number || null, description || null, category || null, checkout_date || null, checkin_date || null, status || null, photo_url || null, notes || null, asId);

  res.json({ message: 'Asset updated' });
});

router.delete('/:id/assets/:asId', requireAdmin, (req, res) => {
  const db = req.db;
  const cand = resolveCandidate(req, res);
  if (!cand) return;

  const asId = parseInt(req.params.asId, 10);
  const result = db.prepare('DELETE FROM employee_assets WHERE id = ? AND candidate_id = ?').run(asId, cand.id);
  if (!result.changes) return res.status(404).json({ error: 'Asset not found' });
  res.json({ message: 'Asset deleted' });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 7. BENEFITS
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/:id/benefits', (req, res) => {
  const db = req.db;
  const cand = resolveCandidate(req, res);
  if (!cand) return;
  res.json(db.prepare('SELECT * FROM employee_benefits WHERE candidate_id = ? ORDER BY id').all(cand.id));
});

router.post('/:id/benefits', requireAdmin, (req, res) => {
  const db = req.db;
  const cand = resolveCandidate(req, res);
  if (!cand) return;

  const { benefit_type, provider, value, currency, access_details, notes, effective_date, end_date } = req.body;
  if (!benefit_type) return res.status(400).json({ error: 'benefit_type is required' });

  const result = db.prepare(`
    INSERT INTO employee_benefits (candidate_id, benefit_type, provider, value, currency, access_details, notes, effective_date, end_date)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(cand.id, benefit_type, provider || null, value || null, currency || 'USD', access_details || null, notes || null, effective_date || null, end_date || null);

  res.status(201).json({ id: result.lastInsertRowid, message: 'Benefit added' });
});

router.put('/:id/benefits/:bId', requireAdmin, (req, res) => {
  const db = req.db;
  const cand = resolveCandidate(req, res);
  if (!cand) return;

  const bId = parseInt(req.params.bId, 10);
  const row = db.prepare('SELECT id FROM employee_benefits WHERE id = ? AND candidate_id = ?').get(bId, cand.id);
  if (!row) return res.status(404).json({ error: 'Benefit not found' });

  const { benefit_type, provider, value, currency, access_details, notes, effective_date, end_date } = req.body;
  db.prepare(`
    UPDATE employee_benefits SET
      benefit_type = COALESCE(?, benefit_type), provider = ?,
      value = ?, currency = COALESCE(?, currency), access_details = ?, notes = ?,
      effective_date = ?, end_date = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(benefit_type || null, provider || null, value || null, currency || null, access_details || null, notes || null, effective_date || null, end_date || null, bId);

  res.json({ message: 'Benefit updated' });
});

router.delete('/:id/benefits/:bId', requireAdmin, (req, res) => {
  const db = req.db;
  const cand = resolveCandidate(req, res);
  if (!cand) return;

  const bId = parseInt(req.params.bId, 10);
  const result = db.prepare('DELETE FROM employee_benefits WHERE id = ? AND candidate_id = ?').run(bId, cand.id);
  if (!result.changes) return res.status(404).json({ error: 'Benefit not found' });
  res.json({ message: 'Benefit deleted' });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 8. PERFORMANCE REVIEWS
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/:id/performance-reviews', (req, res) => {
  const db = req.db;
  const cand = resolveCandidate(req, res);
  if (!cand) return;
  res.json(db.prepare('SELECT * FROM performance_reviews WHERE candidate_id = ? ORDER BY review_date DESC').all(cand.id));
});

router.post('/:id/performance-reviews', requireAdmin, (req, res) => {
  const db = req.db;
  const cand = resolveCandidate(req, res);
  if (!cand) return;

  const { review_date, reviewer_name, overall_score, evaluation, next_steps } = req.body;
  if (!review_date) return res.status(400).json({ error: 'review_date is required' });
  if (overall_score && (overall_score < 1 || overall_score > 5)) {
    return res.status(400).json({ error: 'overall_score must be between 1 and 5' });
  }

  const result = db.prepare(`
    INSERT INTO performance_reviews (candidate_id, review_date, reviewer_id, reviewer_name, overall_score, evaluation, next_steps)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(cand.id, review_date, req.user.id, reviewer_name || req.user.name || req.user.email, overall_score || null, evaluation || null, next_steps || null);

  res.status(201).json({ id: result.lastInsertRowid, message: 'Performance review added' });
});

router.put('/:id/performance-reviews/:prId', requireAdmin, (req, res) => {
  const db = req.db;
  const cand = resolveCandidate(req, res);
  if (!cand) return;

  const prId = parseInt(req.params.prId, 10);
  const row = db.prepare('SELECT id FROM performance_reviews WHERE id = ? AND candidate_id = ?').get(prId, cand.id);
  if (!row) return res.status(404).json({ error: 'Review not found' });

  const { review_date, reviewer_name, overall_score, evaluation, next_steps } = req.body;
  if (overall_score && (overall_score < 1 || overall_score > 5)) {
    return res.status(400).json({ error: 'overall_score must be between 1 and 5' });
  }

  db.prepare(`
    UPDATE performance_reviews SET
      review_date = COALESCE(?, review_date), reviewer_name = COALESCE(?, reviewer_name),
      overall_score = ?, evaluation = ?, next_steps = ?,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(review_date || null, reviewer_name || null, overall_score || null, evaluation || null, next_steps || null, prId);

  res.json({ message: 'Review updated' });
});

router.delete('/:id/performance-reviews/:prId', requireAdmin, (req, res) => {
  const db = req.db;
  const cand = resolveCandidate(req, res);
  if (!cand) return;

  const prId = parseInt(req.params.prId, 10);
  const result = db.prepare('DELETE FROM performance_reviews WHERE id = ? AND candidate_id = ?').run(prId, cand.id);
  if (!result.changes) return res.status(404).json({ error: 'Review not found' });
  res.json({ message: 'Review deleted' });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 9. TRAINING RECORDS
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/:id/training', (req, res) => {
  const db = req.db;
  const cand = resolveCandidate(req, res);
  if (!cand) return;
  res.json(db.prepare('SELECT * FROM training_records WHERE candidate_id = ? ORDER BY training_date DESC').all(cand.id));
});

router.post('/:id/training', requireAdmin, (req, res) => {
  const db = req.db;
  const cand = resolveCandidate(req, res);
  if (!cand) return;

  const { training_date, name, content, results, certificate_url } = req.body;
  if (!training_date || !name) return res.status(400).json({ error: 'training_date and name are required' });

  const result = db.prepare(`
    INSERT INTO training_records (candidate_id, training_date, name, content, results, certificate_url)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(cand.id, training_date, name, content || null, results || null, certificate_url || null);

  res.status(201).json({ id: result.lastInsertRowid, message: 'Training record added' });
});

router.put('/:id/training/:trId', requireAdmin, (req, res) => {
  const db = req.db;
  const cand = resolveCandidate(req, res);
  if (!cand) return;

  const trId = parseInt(req.params.trId, 10);
  const row = db.prepare('SELECT id FROM training_records WHERE id = ? AND candidate_id = ?').get(trId, cand.id);
  if (!row) return res.status(404).json({ error: 'Training record not found' });

  const { training_date, name, content, results, certificate_url } = req.body;
  db.prepare(`
    UPDATE training_records SET
      training_date = COALESCE(?, training_date), name = COALESCE(?, name),
      content = ?, results = ?, certificate_url = ?,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(training_date || null, name || null, content || null, results || null, certificate_url || null, trId);

  res.json({ message: 'Training record updated' });
});

router.delete('/:id/training/:trId', requireAdmin, (req, res) => {
  const db = req.db;
  const cand = resolveCandidate(req, res);
  if (!cand) return;

  const trId = parseInt(req.params.trId, 10);
  const result = db.prepare('DELETE FROM training_records WHERE id = ? AND candidate_id = ?').run(trId, cand.id);
  if (!result.changes) return res.status(404).json({ error: 'Training record not found' });
  res.json({ message: 'Training record deleted' });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 10. LICENCES, PERMITS & INSURANCE
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/:id/licenses', (req, res) => {
  const db = req.db;
  const cand = resolveCandidate(req, res);
  if (!cand) return;

  const today = new Date().toISOString().split('T')[0];
  const licenses = db.prepare('SELECT * FROM employee_licenses WHERE candidate_id = ? ORDER BY expiry_date ASC').all(cand.id);

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
});

router.post('/:id/licenses', requireAdmin, (req, res) => {
  const db = req.db;
  const cand = resolveCandidate(req, res);
  if (!cand) return;

  const { document_type, document_url, issue_date, expiry_date, reminder_days_before, notes } = req.body;
  if (!document_type) return res.status(400).json({ error: 'document_type is required' });

  // Auto-determine status
  const today = new Date().toISOString().split('T')[0];
  let status = 'valid';
  if (expiry_date && expiry_date < today) status = 'expired';

  const result = db.prepare(`
    INSERT INTO employee_licenses (candidate_id, document_type, document_url, issue_date, expiry_date, reminder_days_before, status, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(cand.id, document_type, document_url || null, issue_date || null, expiry_date || null, reminder_days_before || 30, status, notes || null);

  res.status(201).json({ id: result.lastInsertRowid, message: 'License record added' });
});

router.put('/:id/licenses/:licId', requireAdmin, (req, res) => {
  const db = req.db;
  const cand = resolveCandidate(req, res);
  if (!cand) return;

  const licId = parseInt(req.params.licId, 10);
  const row = db.prepare('SELECT id FROM employee_licenses WHERE id = ? AND candidate_id = ?').get(licId, cand.id);
  if (!row) return res.status(404).json({ error: 'License not found' });

  const { document_type, document_url, issue_date, expiry_date, reminder_days_before, status, notes } = req.body;

  const today = new Date().toISOString().split('T')[0];
  let computedStatus = status;
  if (!computedStatus && expiry_date) {
    computedStatus = expiry_date < today ? 'expired' : 'valid';
  }

  db.prepare(`
    UPDATE employee_licenses SET
      document_type = COALESCE(?, document_type), document_url = ?,
      issue_date = ?, expiry_date = ?,
      reminder_days_before = COALESCE(?, reminder_days_before),
      status = COALESCE(?, status), notes = ?,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(document_type || null, document_url || null, issue_date || null, expiry_date || null, reminder_days_before || null, computedStatus || null, notes || null, licId);

  res.json({ message: 'License updated' });
});

router.delete('/:id/licenses/:licId', requireAdmin, (req, res) => {
  const db = req.db;
  const cand = resolveCandidate(req, res);
  if (!cand) return;

  const licId = parseInt(req.params.licId, 10);
  const result = db.prepare('DELETE FROM employee_licenses WHERE id = ? AND candidate_id = ?').run(licId, cand.id);
  if (!result.changes) return res.status(404).json({ error: 'License not found' });
  res.json({ message: 'License deleted' });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SUMMARY — quick overview for profile header
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/:id/summary', (req, res) => {
  const db = req.db;
  const cand = resolveCandidate(req, res);
  if (!cand) return;

  const today = new Date().toISOString().split('T')[0];

  const emergencyCount  = db.prepare('SELECT COUNT(*) AS n FROM emergency_contacts WHERE candidate_id = ?').get(cand.id).n;
  const assetCount      = db.prepare("SELECT COUNT(*) AS n FROM employee_assets WHERE candidate_id = ? AND status = 'on_loan'").get(cand.id).n;
  const benefitCount    = db.prepare('SELECT COUNT(*) AS n FROM employee_benefits WHERE candidate_id = ?').get(cand.id).n;
  const reviewCount     = db.prepare('SELECT COUNT(*) AS n FROM performance_reviews WHERE candidate_id = ?').get(cand.id).n;
  const trainingCount   = db.prepare('SELECT COUNT(*) AS n FROM training_records WHERE candidate_id = ?').get(cand.id).n;
  const expiringLicenses = db.prepare(
    "SELECT COUNT(*) AS n FROM employee_licenses WHERE candidate_id = ? AND expiry_date IS NOT NULL AND expiry_date <= date(?, '+' || reminder_days_before || ' days')"
  ).get(cand.id, today).n;
  const expiredLicenses = db.prepare(
    "SELECT COUNT(*) AS n FROM employee_licenses WHERE candidate_id = ? AND expiry_date < ?"
  ).get(cand.id, today).n;
  const latestHistory = db.prepare('SELECT * FROM employment_history WHERE candidate_id = ? ORDER BY start_date DESC LIMIT 1').get(cand.id);
  const hasBankAccount = !!db.prepare('SELECT id FROM bank_accounts WHERE candidate_id = ? LIMIT 1').get(cand.id);

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
});

module.exports = router;
